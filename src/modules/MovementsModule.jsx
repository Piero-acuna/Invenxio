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
import { recordSale, getNextInvoiceNumber } from "../services/firestoreService";
import { generateInvoicePDF } from "../utils/generateInvoicePDF";
import { logAndGetErrorMessage } from "../utils/errors";
import { useCollection } from "../hooks/useCollection";
import { StatusBadge, Spinner } from "../components/shared/StatusUI";
import TransactionHistory from "../components/TransactionHistory";
import { BarcodeScanner } from "../components/BarcodeUI";
import { useAuth } from "../contexts/AuthContext";
import { formatMoney } from "../utils/currency";
import { getSellablePresentations, findPresentationByCode } from "../utils/packaging";

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 2 — MOVEMENTS
// ══════════════════════════════════════════════════════════════════════════════
const MovementsModule = ({
  companyId, userName, canPurchase, canSell, canViewFinance, billing,
  products, loadingProducts: loadingP, warehouseMovements, supplierSales,
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

  // BUG QUE ESTO CORRIGE: el carrito guarda una "foto" de cada producto al
  // agregarlo (precio, nombre, stock). Si alguien cambia el precio de ese
  // producto (otro empleado, otra pestaña) MIENTRAS sigue en el carrito de
  // una venta que todavía no se cobra, el carrito se quedaba mostrando el
  // precio VIEJO — el cobro real nunca corría riesgo (record_sale siempre
  // recalcula el precio actual server-side, nunca confía en lo que manda
  // el carrito), pero el cajero podía ver un total distinto al que
  // finalmente se registraba. `products` es una prop en vivo (suscripción
  // en tiempo real desde InventorySystem.jsx), así que acá se mantiene
  // cada ítem del carrito sincronizado con los datos actuales mientras
  // siga en él — y si un producto se agotó o se borró mientras tanto, se
  // ajusta la cantidad o se lo saca del carrito en vez de dejarlo con
  // datos que ya no existen.
  useEffect(() => {
    setCart(prev => {
      let changed = false;
      const next = prev
        .filter(item => {
          const stillExists = products.some(p => p.id === item.id);
          if (!stillExists) changed = true;
          return stillExists;
        })
        .map(item => {
          const live = products.find(p => p.id === item.id);
          const liveStock = live.stock || 0;
          // La presentación vendida puede haber cambiado de precio, o
          // incluso haber sido borrada (se editó el producto mientras
          // seguía en el carrito) — se re-resuelve contra las
          // presentaciones vendibles ACTUALES; si ya no existe, se cae a
          // la presentación base ("Unidad") en vez de dejar el ítem con
          // datos que ya no corresponden a nada.
          const livePresentations = getSellablePresentations(live);
          const livePres = livePresentations.find(p => p.id === item.presentationId) || livePresentations[0];
          const liveMultiplier = Number(livePres?.multiplier) || 1;
          const livePrice = Number(livePres?.price) || 0;
          const maxQty = Math.floor(liveStock / liveMultiplier);
          const cappedQty = Math.min(item.qty, maxQty);
          if (
            livePrice !== item.price || liveMultiplier !== item.multiplier || livePres?.id !== item.presentationId ||
            live.name !== item.name || live.description !== item.description || cappedQty !== item.qty
          ) {
            changed = true;
            return {
              ...item, price: livePrice, multiplier: liveMultiplier, presentationId: livePres?.id,
              presentationName: livePres?.name, name: live.name, description: live.description,
              stock: liveStock, qty: cappedQty,
            };
          }
          return item;
        })
        .filter(item => item.qty > 0);
      return changed ? next : prev;
    });
  }, [products]);
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [invoiceMsg,   setInvoiceMsg]   = useState("");
  const [saleError,    setSaleError]    = useState("");
  const [showScanner,  setShowScanner]  = useState(false);
  const [scanFeedback, setScanFeedback] = useState(""); // mensaje tras escanear

  const recentProducts = useMemo(() => products.filter(p => p.stock > 0).slice(0, 6), [products]);
  const sFiltered = sSearch ? products.filter(p =>
    (p.name?.toLowerCase().includes(sSearch.toLowerCase()) || p.barcode?.includes(sSearch) || p.sku?.toLowerCase().includes(sSearch.toLowerCase())) && p.stock > 0
  ) : [];
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);


  // Agrega una PRESENTACIÓN de un producto al carrito (no el producto
  // "pelado") — cada combinación producto+presentación es su propia línea,
  // así "Galleta — Unidad" y "Galleta — Pack" pueden convivir en el mismo
  // carrito. `qty` en el carrito es "cuántas de esa presentación" (ej. 2
  // Packs); el tope real es en unidades base (maxQty = stock / multiplier).
  const addToCart = useCallback((product, presentation) => {
    setSSearch("");
    const multiplier = Number(presentation.multiplier) || 1;
    const maxQty = Math.floor((product.stock || 0) / multiplier);
    setCart(prev => {
      const ex = prev.find(i => i.id === product.id && i.presentationId === presentation.id);
      return ex
        ? prev.map(i => (i === ex ? { ...i, qty: Math.min(i.qty + 1, maxQty) } : i))
        : [...prev, {
            id: product.id, name: product.name, sku: product.sku, description: product.description,
            stock: product.stock || 0,
            presentationId: presentation.id, presentationName: presentation.name, multiplier,
            price: Number(presentation.price) || 0, qty: Math.min(1, maxQty),
          }];
    });
  }, []);

  const handleBarcodeScan = useCallback((code) => {
    setShowScanner(false);
    const found = findPresentationByCode(products, code);
    if (found) {
      const { product, presentation } = found;
      if (product.stock <= 0 || Number(presentation.multiplier) > product.stock) {
        setScanFeedback(`⚠️ "${product.name}" ${presentation.name !== "Unidad" ? `(${presentation.name}) ` : ""}está agotado`);
      } else {
        addToCart(product, presentation);
        setScanFeedback(`✅ "${product.name}"${presentation.name !== "Unidad" ? ` — ${presentation.name}` : ""} agregado al carrito`);
      }
    } else {
      setScanFeedback(`❌ No se encontró producto con código: ${code}`);
    }
    setTimeout(() => setScanFeedback(""), 3500);
  }, [products, addToCart]);

  const handleSale = async () => {
    if (cart.length === 0) return;
    setSSaving(true);
    setInvoiceMsg("");
    setSaleError("");
    try {
      await recordSale(companyId, { cartItems: cart, userName, clientName, paymentMethod });
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
            items: cart.map(i => ({
              name: i.presentationName && i.presentationName !== "Unidad" ? `${i.name} — ${i.presentationName}` : i.name,
              description: i.description || "", qty: i.qty, unitPrice: i.price, total: i.price * i.qty,
            })),
            total: cartTotal,
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
      // recordSale ahora valida el stock real del servidor dentro de la
      // transacción y lanza un Error con un mensaje legible cuando no
      // alcanza el stock o el producto ya no existe — se lo mostramos
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
                  {sFiltered.slice(0, 6).map(p => {
                    const presentations = getSellablePresentations(p);
                    const single = presentations.length === 1 ? presentations[0] : null;
                    return (
                      <div key={p.id}
                        className={`w-full text-left p-3 bg-slate-700/50 border border-slate-600/50 rounded-xl transition-all ${single ? "hover:bg-slate-700 hover:border-amber-500/40 cursor-pointer" : ""}`}
                        {...(single ? { onClick: () => addToCart(p, single) } : {})}>
                        <div className="flex items-center gap-3 group">
                          <div className="w-9 h-9 bg-slate-600 rounded-lg flex items-center justify-center flex-shrink-0"><Package size={15} className="text-slate-400" /></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-200 group-hover:text-amber-400 transition-colors">{p.name}</p>
                            <p className="text-xs text-slate-500 font-mono">{p.sku} · Stock: {p.stock}</p>
                            {p.description && <p className="text-xs text-slate-500 truncate mt-0.5">{p.description}</p>}
                          </div>
                          {single && (
                            <>
                              <div className="text-right mr-2">
                                <p className="text-sm font-bold font-mono text-amber-400">{formatMoney(single.price, currencySymbol)}</p>
                                <StatusBadge status={p.status} />
                              </div>
                              <Plus size={16} className="text-slate-500 group-hover:text-amber-400 flex-shrink-0 transition-colors" />
                            </>
                          )}
                        </div>
                        {!single && (
                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            {presentations.map(pres => {
                              const maxQty = Math.floor((p.stock || 0) / (Number(pres.multiplier) || 1));
                              return (
                                <button key={pres.id} type="button" disabled={maxQty < 1} onClick={() => addToCart(p, pres)}
                                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-amber-500/10 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-600 hover:border-amber-500/40 rounded-lg text-xs font-semibold text-slate-300 hover:text-amber-400 transition-colors flex items-center gap-1.5">
                                  {pres.name} <span className="font-mono text-amber-400">{formatMoney(pres.price, currencySymbol)}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Clock size={11} className="text-amber-400" />Productos disponibles — toca para agregar
                  </p>
                  {loadingP ? <Spinner /> : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {recentProducts.map(p => {
                        const presentations = getSellablePresentations(p);
                        const single = presentations.length === 1 ? presentations[0] : null;
                        return (
                          <div key={p.id}
                            className={`p-3 bg-slate-700/40 border border-slate-600/40 rounded-xl transition-all text-left group ${single ? "hover:bg-slate-700 hover:border-amber-500/40 cursor-pointer" : ""}`}
                            {...(single ? { onClick: () => addToCart(p, single) } : {})}>
                            <div className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center mb-2">
                              <Package size={14} className="text-slate-400 group-hover:text-amber-400 transition-colors" />
                            </div>
                            <p className="text-xs font-semibold text-slate-200 leading-tight line-clamp-2 group-hover:text-amber-400 transition-colors">{p.name}</p>
                            {p.description && <p className="text-[11px] text-slate-500 leading-tight line-clamp-1 mt-0.5">{p.description}</p>}
                            {single ? (
                              <>
                                <p className="text-xs font-bold font-mono text-amber-400 mt-1.5">{formatMoney(single.price, currencySymbol)}</p>
                                <div className="flex items-center justify-between mt-1">
                                  <span className="text-xs text-slate-500 font-mono">x{p.stock}</span>
                                  <Plus size={12} className="text-slate-500 group-hover:text-amber-400 transition-colors" />
                                </div>
                              </>
                            ) : (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {presentations.map(pres => {
                                  const maxQty = Math.floor((p.stock || 0) / (Number(pres.multiplier) || 1));
                                  return (
                                    <button key={pres.id} type="button" disabled={maxQty < 1} onClick={() => addToCart(p, pres)}
                                      className="px-1.5 py-1 bg-slate-800 hover:bg-amber-500/10 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-600 hover:border-amber-500/40 rounded text-[10px] font-semibold text-slate-300 hover:text-amber-400 transition-colors">
                                      {pres.name} <span className="font-mono text-amber-400">{formatMoney(pres.price, currencySymbol)}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
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
                const maxQty = Math.floor((item.stock || 0) / (Number(item.multiplier) || 1));
                const isSameLine = i => i.id === item.id && i.presentationId === item.presentationId;
                return (
                  <div key={`${item.id}:${item.presentationId}`} className="flex items-center gap-2 p-2.5 bg-slate-700/50 rounded-lg border border-slate-600/40">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate">
                        {item.name}
                        {item.presentationName && item.presentationName !== "Unidad" && (
                          <span className="ml-1.5 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded text-[10px] font-semibold align-middle">{item.presentationName}</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 font-mono">{formatMoney(item.price, currencySymbol)} c/u</p>
                      {item.description && <p className="text-[11px] text-slate-500 truncate">{item.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => setCart(prev => prev.map(i => isSameLine(i) ? { ...i, qty: Math.max(1, i.qty - 1) } : i))} className="w-6 h-6 bg-slate-600 hover:bg-slate-500 rounded flex items-center justify-center transition-colors"><Minus size={10} className="text-slate-300" /></button>
                      <span className="text-sm font-mono font-bold text-white w-5 text-center">{item.qty}</span>
                      <button onClick={() => setCart(prev => prev.map(i => isSameLine(i) && i.qty < maxQty ? { ...i, qty: i.qty + 1 } : i))} className="w-6 h-6 bg-slate-600 hover:bg-slate-500 rounded flex items-center justify-center transition-colors"><Plus size={10} className="text-slate-300" /></button>
                      <button onClick={() => setCart(prev => prev.filter(i => !isSameLine(i)))} className="w-6 h-6 text-red-500 hover:bg-red-500/20 rounded flex items-center justify-center transition-colors ml-1"><Trash2 size={10} /></button>
                    </div>
                    <span className="text-xs font-mono text-amber-400 w-16 text-right flex-shrink-0">{formatMoney((item.price || 0) * item.qty, currencySymbol)}</span>
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
    </div>
  );
};

export default MovementsModule;
