// ─────────────────────────────────────────────────────────────────────────────
// src/modules/MovementsModule.jsx
// Módulo 2 — Movimientos: punto de venta (POS) con carrito, escaneo de
// código de barras, emisión de comprobante PDF, e Historial general.
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search, Plus, ShoppingCart, Package, AlertTriangle, CheckCircle,
  Minus, Trash2, Zap, Clock, BookOpen, Loader2, ScanBarcode,
} from "lucide-react";
import { recordSaleV2, getNextInvoiceNumber } from "../services/firestoreService";
import { generateInvoicePDF } from "../utils/generateInvoicePDF";
import { logAndGetErrorMessage } from "../utils/errors";
import { useCollection } from "../hooks/useCollection";
import { StatusBadge, Spinner } from "../components/shared/StatusUI";
import TransactionHistory from "../components/TransactionHistory";
import { BarcodeScanner } from "../components/BarcodeUI";
import PresentationPicker from "../components/pos/PresentationPicker";
import { useAuth } from "../contexts/AuthContext";
import { formatMoney } from "../utils/currency";

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 2 — MOVEMENTS
// ══════════════════════════════════════════════════════════════════════════════
const MovementsModule = ({
  companyId, userName, canPurchase, canSell, canViewFinance, billing,
  products, loadingProducts: loadingP, warehouseMovements, supplierSales,
  presentations = [],
}) => {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
  // "products", "warehouseMovements" y "supplierSales" YA NO se suscriben
  // acá — llegan como prop desde InventorySystem.jsx (compartidas también
  // con Dashboard/Inventario/Almacén/Proveedores), en vez de que este
  // módulo abra 3 suscripciones independientes a exactamente los mismos
  // datos.
  // "transactions" sí se queda con su propia suscripción acá, aparte —
  // limit=500 porque solo alimenta la lista/gráfico de "reciente" del
  // Historial (TransactionHistory.jsx agrupa por período — últimos N días/
  // semanas), nunca un total histórico completo, así que no hace falta
  // descargar la tabla entera cada vez.
  // OJO: DashboardModule.jsx SÍ necesita el histórico COMPLETO de
  // "transactions" para su ranking de "más vendidos" (histórico, todas las
  // ventas) — por eso su propio useCollection("transactions") se dejó
  // deliberadamente SIN límite y por separado; no se puede compartir una
  // sola copia entre los dos sin romper a uno de los dos.
  const [transactions, loadingT] = useCollection(companyId, "transactions", "createdAt", 500);

  // BUG QUE ESTO CORRIGE: los ajustes MANUALES de stock (botón "+/-" en la
  // ficha de un producto en Inventario — mercadería dañada/vencida/perdida,
  // o una corrección de conteo) se guardan en `product_history`, no en
  // `transactions` — así que nunca aparecían en "Historial general" ni se
  // contaban en "Total Egresos" (ver TransactionHistory.jsx). `product_history`
  // solo guarda `product_id` (no el nombre ni el costo del producto), así
  // que acá se resuelve contra `products` (ya cargado arriba) antes de
  // pasarlo al Historial.
  const [productHistory, loadingPH] = useCollection(companyId, "productHistory", "createdAt", 500);
  const productAdjustments = useMemo(() => {
    const byId = {};
    products.forEach(p => { byId[p.id] = p; });
    return productHistory
      .filter(h => h.action === "Ajuste +" || h.action === "Ajuste -")
      .map(h => {
        const prod = byId[h.productId];
        return {
          ...h,
          productName: prod?.name || "Producto eliminado",
          sku: prod?.sku || "",
          // Costo ACTUAL del producto × cantidad — es una aproximación (no
          // se guarda el costo histórico exacto de cada ajuste), pero es lo
          // más cercano disponible para reflejar el valor de la merma.
          amount: h.action === "Ajuste -" ? Number(h.qty || 0) * Number(prod?.cost || 0) : null,
        };
      });
  }, [productHistory, products]);

  const innerTabs = [
    canSell     && { id: "sale",     label: "🛒 Registrar Venta" },
    (canPurchase || canSell) && { id: "history", label: "📋 Historial" },
  ].filter(Boolean);
  const [mvTab, setMvTab] = useState(innerTabs[0]?.id || "history");
  useEffect(() => {
    if (innerTabs.length && !innerTabs.some(t => t.id === mvTab)) setMvTab(innerTabs[0].id);
  }, [canPurchase, canSell]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SALE / POS ─────────────────────────────────────────────────────────────
  const [sSearch,      setSSearch]      = useState("");
  const [cart,         setCart]         = useState([]);
  const [sSaving,      setSSaving]      = useState(false);
  const [sSuccess,     setSSuccess]     = useState(false);
  const [clientName,   setClientName]   = useState("");

  // BUG QUE ESTO CORRIGE: el carrito guarda una "foto" de cada línea al
  // agregarla (precio y stock del producto/presentación). Si alguien
  // cambia el precio de una presentación (otro empleado, otra pestaña)
  // MIENTRAS sigue en el carrito de una venta que todavía no se cobra, el
  // carrito se quedaba mostrando el precio VIEJO — el cobro real nunca
  // corría riesgo (record_sale_v2 siempre relee el precio actual
  // server-side, nunca confía en lo que manda el carrito), pero el cajero
  // podía ver un total distinto al que finalmente se registraba. `products`
  // y `presentations` son props en vivo (suscripción en tiempo real desde
  // InventorySystem.jsx), así que acá se mantiene cada línea del carrito
  // sincronizada con los datos actuales mientras siga en él.
  useEffect(() => {
    setCart((prev) => {
      let changed = false;
      const next = prev
        .filter((item) => {
          const stillExists = products.some((p) => p.id === item.productId);
          if (!stillExists) changed = true;
          return stillExists;
        })
        .map((item) => {
          const live = products.find((p) => p.id === item.productId);
          const livePres = presentations.find((pr) => pr.id === item.presentationId);
          const liveStock = live.stock || 0;
          const livePrice = livePres ? Number(livePres.price) || 0 : item.price;
          let value = item.value;
          // El tope de stock del lado del cliente es solo una guía visual
          // (evita que el cajero arme un carrito obviamente imposible) —
          // record_sale_v2 vuelve a validar el stock real, bloqueado,
          // dentro de la misma transacción que descuenta.
          if (item.mode === "qty" && item.unitType !== "peso") {
            const maxUnits = Math.floor(liveStock / item.factor) || 0;
            if (value > maxUnits) { value = maxUnits; changed = true; }
          }
          if (liveStock !== item.stock || livePrice !== item.price || value !== item.value) changed = true;
          return { ...item, stock: liveStock, price: livePrice, value };
        })
        .filter((item) => item.value > 0);
      return changed ? next : prev;
    });
  }, [products, presentations]);
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [invoiceMsg,   setInvoiceMsg]   = useState("");
  const [saleError,    setSaleError]    = useState("");
  const [showScanner,  setShowScanner]  = useState(false);
  const [scanFeedback, setScanFeedback] = useState(""); // mensaje tras escanear
  const [pickerProduct, setPickerProduct] = useState(null); // producto abierto en el selector de presentación

  const recentProducts = useMemo(() => products.filter(p => p.stock > 0).slice(0, 6), [products]);
  const sFiltered = sSearch ? products.filter(p =>
    (p.name?.toLowerCase().includes(sSearch.toLowerCase()) || p.barcode?.includes(sSearch) || p.sku?.toLowerCase().includes(sSearch.toLowerCase())) && p.stock > 0
  ) : [];
  const cartTotal = cart.reduce((s, i) => s + (i.mode === "amount" ? i.value : i.price * i.value), 0);

  // Presentaciones vendibles (activas, no "solo compra") de un producto —
  // ver 0019_kits_bulk_presentations.sql / PresentationsManager.jsx.
  const getEligiblePresentations = useCallback(
    (product) => presentations.filter((pr) => pr.productId === product.id && pr.active !== false && !pr.isPurchaseOnly),
    [presentations]
  );

  const addToCart = useCallback((product, presentation, mode = "qty", value = 1) => {
    setSSearch("");
    setCart((prev) => {
      const cartId = `${presentation.id}:${mode}`;
      const ex = prev.find((i) => i.cartId === cartId);
      if (ex) {
        return prev.map((i) => (i.cartId === cartId ? { ...i, value: i.value + value } : i));
      }
      return [
        ...prev,
        {
          cartId,
          presentationId: presentation.id,
          productId: product.id,
          productName: product.name,
          presentationName: presentation.name,
          unitType: product.unitType || "unidad",
          factor: Number(presentation.factor) || 1,
          price: Number(presentation.price) || 0,
          mode,
          value,
          stock: product.stock || 0,
        },
      ];
    });
  }, []);

  // Punto de entrada único al tocar/buscar un producto en el POS: si tiene
  // una sola presentación y NO es a granel, se agrega directo (1 click = 1
  // unidad, igual que antes — cero fricción extra para el caso simple). Si
  // tiene varias presentaciones o es a granel (unit_type='peso'), siempre
  // se abre el selector — nunca se asume una cantidad para algo que se
  // vende por peso.
  const handleProductClick = useCallback((product) => {
    const opts = getEligiblePresentations(product);
    if (opts.length === 0) {
      setScanFeedback(`⚠️ "${product.name}" no tiene una presentación de venta configurada — agrégala desde Inventario.`);
      setTimeout(() => setScanFeedback(""), 4000);
      return;
    }
    if (product.unitType !== "peso" && opts.length === 1) {
      addToCart(product, opts[0], "qty", 1);
      return;
    }
    setPickerProduct(product);
  }, [getEligiblePresentations, addToCart]);

  const handleBarcodeScan = useCallback((code) => {
    setShowScanner(false);

    // 1) ¿El código es el de una PRESENTACIÓN (el pack/caja suele traer su
    //    propio EAN, distinto al de la unidad suelta)? Si es así, se agrega
    //    ESA presentación exacta directo, sin pasar por el selector.
    const presMatch = presentations.find((pr) => pr.barcode && pr.barcode === code);
    if (presMatch) {
      const product = products.find((p) => p.id === presMatch.productId);
      if (!product) {
        setScanFeedback(`❌ El producto de esta presentación ya no existe.`);
      } else if (product.stock < presMatch.factor) {
        setScanFeedback(`⚠️ "${product.name}" no tiene stock suficiente para "${presMatch.name}"`);
      } else {
        addToCart(product, presMatch, "qty", 1);
        setScanFeedback(`✅ "${product.name}" (${presMatch.name}) agregado al carrito`);
      }
      setTimeout(() => setScanFeedback(""), 3500);
      return;
    }

    // 2) Código del producto base (unidad suelta) — comportamiento de siempre.
    const found = products.find((p) => p.barcode === code || p.sku === code);
    if (found) {
      if (found.stock <= 0) {
        setScanFeedback(`⚠️ "${found.name}" está agotado`);
      } else {
        handleProductClick(found);
        setScanFeedback(`✅ "${found.name}" agregado al carrito`);
      }
    } else {
      setScanFeedback(`❌ No se encontró producto con código: ${code}`);
    }
    setTimeout(() => setScanFeedback(""), 3500);
  }, [products, presentations, addToCart, handleProductClick]);

  const handleSale = async () => {
    if (cart.length === 0) return;
    setSSaving(true);
    setInvoiceMsg("");
    setSaleError("");
    try {
      const result = await recordSaleV2(companyId, {
        cartItems: cart.map((i) => ({ presentationId: i.presentationId, mode: i.mode, value: i.value })),
        userName, clientName, paymentMethod,
      });
      setSSuccess(true);

      // ── Emitir comprobante de venta en PDF (sin terceros) ──
      if (!billing?.razonSocial) {
        setInvoiceMsg("Venta guardada, pero no se generó comprobante: completa tus Datos de Facturación en el Panel.");
      } else {
        try {
          const invoiceNumber = await getNextInvoiceNumber(companyId);
          generateInvoicePDF({
            billing,
            docType: "VENTA",
            partyLabel: "Cliente",
            partyName: clientName.trim() || "Cliente varios",
            // Se arma con los valores REALES que devolvió record_sale_v2
            // (result.items), no con la estimación del carrito en
            // pantalla — así el comprobante siempre coincide con lo que
            // quedó grabado (ej: el peso exacto en una venta por monto).
            // result.items[i] corresponde 1-a-1 con cart[i]: la RPC
            // procesa el carrito en el mismo orden en que se envía.
            items: result.items.map((i, idx) => ({
              name: `${cart[idx].productName} — ${i.presentationName}`,
              description: "",
              qty: i.qtyPresentation,
              unitPrice: i.unitPrice,
              total: i.lineTotal,
            })),
            total: result.total,
            paymentMethod,
            currencySymbol,
          });
        } catch (invErr) {
          console.error("Error generando comprobante:", invErr);
          setInvoiceMsg("Venta guardada, pero hubo un error al generar el comprobante PDF.");
        }
      }

      setTimeout(() => { setSSuccess(false); setCart([]); setClientName(""); setPaymentMethod("Efectivo"); setInvoiceMsg(""); }, 3500);
    } catch (err) {
      // record_sale_v2 valida el stock real del servidor dentro de la
      // transacción y lanza un Error con un mensaje legible cuando no
      // alcanza el stock o la presentación ya no existe — se lo mostramos
      // directamente al cajero en vez de dejarlo solo en consola.
      setSaleError(logAndGetErrorMessage(err, "Error al registrar la venta:", "No se pudo registrar la venta. Intenta de nuevo."));
    }
    setSSaving(false);
  };

  return (
    <div className="space-y-5">
      {/* Tabs internos */}
      <div className="flex flex-wrap gap-1 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50 w-full sm:w-fit">
        {innerTabs.map(t => (
          <button key={t.id} onClick={() => setMvTab(t.id)}
            className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${mvTab === t.id ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SALE / POS ── */}
      {mvTab === "sale" && (
        <div className="grid md:grid-cols-5 gap-5">
          <div className="md:col-span-3 space-y-4">
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Search size={16} className="text-amber-400" />Buscar Producto</h3>
                {/* Botón escanear */}
                <button onClick={() => setShowScanner(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-lg text-xs font-semibold transition-colors">
                  <ScanBarcode size={14} /> Escanear
                </button>
              </div>

              {/* Feedback de escaneo */}
              {scanFeedback && (
                <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium border ${scanFeedback.startsWith("✅") ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : scanFeedback.startsWith("⚠️") ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
                  {scanFeedback}
                </div>
              )}

              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={sSearch} onChange={e => setSSearch(e.target.value)} placeholder="Nombre, SKU o código de barras…"
                  className="w-full pl-9 pr-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
              </div>

              {sSearch ? (
                <div className="mt-3 space-y-2">
                  {sFiltered.length === 0 && <p className="text-slate-500 text-sm text-center py-4">Sin resultados</p>}
                  {sFiltered.slice(0, 6).map(p => (
                    <button key={p.id} onClick={() => handleProductClick(p)}
                      className="w-full text-left p-3 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 hover:border-amber-500/40 rounded-xl transition-all flex items-center gap-3 group">
                      <div className="w-9 h-9 bg-slate-600 rounded-lg flex items-center justify-center flex-shrink-0"><Package size={15} className="text-slate-400" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 group-hover:text-amber-400 transition-colors">{p.name}</p>
                        <p className="text-xs text-slate-500 font-mono">{p.sku} · Stock: {p.stock}</p>
                        {p.description && <p className="text-xs text-slate-500 truncate mt-0.5">{p.description}</p>}
                      </div>
                      <div className="text-right mr-2">
                        <p className="text-sm font-bold font-mono text-amber-400">{formatMoney(p.price, currencySymbol)}</p>
                        <StatusBadge status={p.status} />
                      </div>
                      <Plus size={16} className="text-slate-500 group-hover:text-amber-400 flex-shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Clock size={11} className="text-amber-400" />Productos disponibles — toca para agregar
                  </p>
                  {loadingP ? <Spinner /> : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {recentProducts.map(p => (
                        <button key={p.id} onClick={() => handleProductClick(p)}
                          className="p-3 bg-slate-700/40 hover:bg-slate-700 border border-slate-600/40 hover:border-amber-500/40 rounded-xl transition-all text-left group">
                          <div className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center mb-2">
                            <Package size={14} className="text-slate-400 group-hover:text-amber-400 transition-colors" />
                          </div>
                          <p className="text-xs font-semibold text-slate-200 leading-tight line-clamp-2 group-hover:text-amber-400 transition-colors">{p.name}</p>
                          {p.description && <p className="text-[11px] text-slate-500 leading-tight line-clamp-1 mt-0.5">{p.description}</p>}
                          <p className="text-xs font-bold font-mono text-amber-400 mt-1.5">{formatMoney(p.price, currencySymbol)}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-slate-500 font-mono">x{p.stock}</span>
                            <Plus size={12} className="text-slate-500 group-hover:text-amber-400 transition-colors" />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Cart */}
          <div className="md:col-span-2 bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <ShoppingCart size={16} className="text-amber-400" />Lista de Venta
              {cart.length > 0 && <span className="ml-auto text-xs bg-amber-500 text-slate-900 font-bold px-2 py-0.5 rounded-full">{cart.length}</span>}
            </h3>
            <div className="flex-1 space-y-2 overflow-y-auto max-h-72">
              {cart.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-8 text-slate-600">
                  <ShoppingCart size={28} className="mb-2 opacity-30" />
                  <p className="text-xs text-center">Busca, toca o escanea productos</p>
                </div>
              )}
              {cart.map(item => {
                const isPeso = item.unitType === "peso";
                const isAmount = item.mode === "amount";
                const lineTotal = isAmount ? item.value : item.price * item.value;
                return (
                  <div key={item.cartId} className="flex items-center gap-2 p-2.5 bg-slate-700/50 rounded-lg border border-slate-600/40">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate">{item.productName}</p>
                      <p className="text-xs text-slate-500 font-mono truncate">
                        {item.presentationName} · {formatMoney(item.price, currencySymbol)}{isPeso ? "/kg" : " c/u"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isPeso || isAmount ? (
                        <input type="number" min="0" step={isAmount ? "0.01" : "0.001"} value={item.value}
                          onChange={e => setCart(prev => prev.map(i => i.cartId === item.cartId ? { ...i, value: Math.max(0, Number(e.target.value)) } : i))}
                          className="w-16 px-1.5 py-1 bg-slate-600 border border-slate-500 rounded text-xs font-mono text-white text-center focus:outline-none focus:border-amber-500" />
                      ) : (
                        <>
                          <button onClick={() => setCart(prev => prev.map(i => i.cartId === item.cartId ? { ...i, value: Math.max(1, i.value - 1) } : i))} className="w-6 h-6 bg-slate-600 hover:bg-slate-500 rounded flex items-center justify-center transition-colors"><Minus size={10} className="text-slate-300" /></button>
                          <span className="text-sm font-mono font-bold text-white w-5 text-center">{item.value}</span>
                          <button onClick={() => setCart(prev => prev.map(i => i.cartId === item.cartId && (i.value + 1) * i.factor <= i.stock ? { ...i, value: i.value + 1 } : i))} className="w-6 h-6 bg-slate-600 hover:bg-slate-500 rounded flex items-center justify-center transition-colors"><Plus size={10} className="text-slate-300" /></button>
                        </>
                      )}
                      <button onClick={() => setCart(prev => prev.filter(i => i.cartId !== item.cartId))} className="w-6 h-6 text-red-500 hover:bg-red-500/20 rounded flex items-center justify-center transition-colors ml-1"><Trash2 size={10} /></button>
                    </div>
                    <span className="text-xs font-mono text-amber-400 w-16 text-right flex-shrink-0">{formatMoney(lineTotal, currencySymbol)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-700">
              <div className="mb-3">
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Cliente (opcional)</label>
                <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Cliente varios"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
              </div>
              <div className="mb-3">
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Método de pago</label>
                {/* flex-wrap: en pantallas angostas los 4 botones pasan a 2
                    filas de 2 en vez de desbordar o achicarse demasiado. */}
                <div className="flex flex-wrap gap-1.5">
                  {["Efectivo", "Yape", "Transferencia"].map(m => (
                    <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        paymentMethod === m
                          ? "bg-amber-500 border-amber-500 text-slate-900"
                          : "bg-slate-700/60 border-slate-600 text-slate-300 hover:border-slate-500"
                      }`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-slate-400 text-sm">Total</span>
                <span className="text-2xl font-bold font-mono text-amber-400">{formatMoney(cartTotal, currencySymbol)}</span>
              </div>
              {sSuccess ? (
                <div className="space-y-2">
                  <div className="py-3 px-4 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-center text-emerald-400 font-semibold flex items-center justify-center gap-2"><CheckCircle size={16} />¡Venta guardada!</div>
                  {invoiceMsg && (
                    <div className="py-2 px-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-start gap-2">
                      <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{invoiceMsg}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {saleError && (
                    <div className="py-2 px-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-start gap-2">
                      <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{saleError}
                    </div>
                  )}
                  <button onClick={handleSale} disabled={cart.length === 0 || sSaving}
                    className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                    {sSaving && <Loader2 size={16} className="animate-spin" />}<Zap size={16} />Confirmar Venta y Emitir Comprobante
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY ── */}
      {mvTab === "history" && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-base font-bold text-white mb-5 flex items-center gap-2">
            <BookOpen size={16} className="text-amber-400" />Historial General
            <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full font-mono">Inventario · Almacén · Proveedores</span>
          </h3>
          <TransactionHistory transactions={transactions} warehouseMovements={warehouseMovements} supplierSales={supplierSales} productAdjustments={productAdjustments} loading={loadingT || loadingPH} canViewFinance={canViewFinance} canPurchase={canPurchase} canSell={canSell} billing={billing} companyId={companyId} />
        </div>
      )}

      {/* Barcode Scanner Modal */}
      {showScanner && <BarcodeScanner onDetected={handleBarcodeScan} onClose={() => setShowScanner(false)} />}

      {/* Selector de presentación (kits/packs/granel) */}
      {pickerProduct && (
        <PresentationPicker
          product={pickerProduct}
          presentations={getEligiblePresentations(pickerProduct)}
          currencySymbol={currencySymbol}
          onConfirm={(presentation, mode, value) => addToCart(pickerProduct, presentation, mode, value)}
          onClose={() => setPickerProduct(null)}
        />
      )}
    </div>
  );
};

export default MovementsModule;
