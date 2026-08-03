// ─────────────────────────────────────────────────────────────────────────────
// src/components/warehouse/MovimientoTab.jsx
// Pestaña "🔁 Registrar Movimiento". Solo quedan dos tipos: Traslado (mover
// entre ubicaciones del almacén) y Enviar a Tienda (descontar del almacén y
// sumar a un producto de tienda). El ingreso de stock nuevo al almacén ya NO
// se hace aquí — se hace desde "Mis Productos" (al crear el producto o con
// el botón "Agregar Stock"). Extraído de WarehouseModule.jsx al separar el
// monolito por componentes.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import {
  Warehouse, X, Package, Search, RefreshCw, CheckCircle, AlertTriangle, Store,
} from "lucide-react";
import { addWarehouseMovement, sendWarehouseToInventory } from "../../services/firestoreService";
import { TYPE_CFG, SELECTABLE_MOVEMENT_TYPES } from "./constants";

export default function MovimientoTab({ locations, warehouseProducts, storeProducts, companyId, userName, stockByProduct }) {
  const EMPTY = {
    type: "traslado", productSearch: "", product: null,
    qty: "", reason: "", fromLocationId: "", toLocationId: "",
    // Destino en "Enviar a Tienda" — producto de la TIENDA que recibe el stock
    storeProductSearch: "", storeProduct: null,
  };
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState("");

  const isEnvio = form.type === "envio_inventario";
  const packName = form.product?.packName || "empaque";
  const packQty  = Number(form.product?.packQty) || 1;

  // Buscador de producto — SIEMPRE contra el catálogo propio del almacén,
  // nunca contra el catálogo de la tienda.
  const filtered = form.productSearch && !form.product
    ? warehouseProducts.filter(p => p.name?.toLowerCase().includes(form.productSearch.toLowerCase()) || p.sku?.toLowerCase().includes(form.productSearch.toLowerCase()))
    : [];

  // Buscador del producto de TIENDA destino — solo aplica en "Enviar a Tienda"
  const storeFiltered = isEnvio && form.storeProductSearch && !form.storeProduct
    ? storeProducts.filter(p => p.name?.toLowerCase().includes(form.storeProductSearch.toLowerCase()) || p.sku?.toLowerCase().includes(form.storeProductSearch.toLowerCase()))
    : [];

  // El almacén siempre se mueve en EMPAQUES completos (cajas). "qty" es la
  // cantidad de empaques que se descuentan del origen. En "Enviar a Tienda"
  // eso se convierte a unidades reales para sumarlas al stock de la tienda,
  // ya que la tienda vende por unidad.
  const packCount = Number(form.qty) || 0;
  const unitQty   = packCount * packQty;

  const fromStock = form.product && form.fromLocationId
    ? (stockByProduct[form.product.id] || []).find(s => s.locationId === form.fromLocationId)
    : null;

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit() {
    setError("");
    if (!form.product) return setError("Selecciona un producto de almacén.");
    if (!packCount || packCount <= 0) return setError(`Ingresa la cantidad de ${packName} a mover.`);
    if (!form.fromLocationId) return setError("Selecciona la ubicación de origen.");
    if (form.type === "traslado" && !form.toLocationId) return setError("Selecciona la ubicación de destino.");
    if (form.type === "traslado" && form.fromLocationId === form.toLocationId) return setError("Origen y destino deben ser distintos.");
    if (fromStock && packCount > fromStock.qty) return setError(`Solo hay ${fromStock.qty} ${packName} disponibles en esa ubicación.`);
    if (isEnvio && !form.storeProduct) return setError("Selecciona a qué producto de la tienda se envía.");

    setSaving(true);
    try {
      const fromLoc = locations.find(l => l.id === form.fromLocationId);
      const toLoc   = locations.find(l => l.id === form.toLocationId);

      if (isEnvio) {
        await sendWarehouseToInventory(companyId, {
          warehouseProductId:   form.product.id,
          warehouseProductName: form.product.name,
          sku:                  form.product.sku || "",
          locationId:           form.fromLocationId,
          locationName:         fromLoc?.name || "",
          packCount, packName,
          unitQty,
          storeProductId:       form.storeProduct.id,
          storeProductName:     form.storeProduct.name,
          reason:               form.reason,
          userName,
        });
      } else {
        await addWarehouseMovement(companyId, {
          type:             "traslado",
          productId:        form.product.id,
          productName:      form.product.name,
          sku:              form.product.sku || "",
          qty:              packCount,
          fromLocationId:   form.fromLocationId,
          fromLocationName: fromLoc?.name || null,
          toLocationId:     form.toLocationId,
          toLocationName:   toLoc?.name   || null,
          reason:           form.reason,
          userName,
          packName: form.product.packName, packQty: form.product.packQty,
        });
      }
      setSuccess(true);
      setTimeout(() => { setSuccess(false); setForm(EMPTY); }, 2500);
    } catch (e) {
      setError(e?.message || "Error al registrar el movimiento.");
    }
    setSaving(false);
  }

  const typeInfo = TYPE_CFG[form.type];

  return (
    <div className="max-w-lg">
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Warehouse size={15} className="text-amber-400" /> Registrar Movimiento de Almacén
        </h3>

        {success && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-400">
            <CheckCircle size={16} /> ¡Movimiento registrado!
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{error}
          </div>
        )}

        {!success && (<>
          {/* Tipo */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Tipo de movimiento</label>
            <div className="grid grid-cols-2 gap-2">
              {SELECTABLE_MOVEMENT_TYPES.map(t => (
                <button key={t.id} onClick={() => setF("type", t.id)}
                  className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl border transition-all ${form.type === t.id ? `${t.bg} ${t.color}` : "border-slate-700 text-slate-500 hover:border-slate-600"}`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
            {isEnvio && (
              <p className="text-[11px] text-amber-400/80 mt-1.5">Descuenta del almacén y suma stock a un producto que ya existe en la tienda.</p>
            )}
          </div>

          {/* Producto — SIEMPRE del catálogo propio de almacén */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Producto de almacén *</label>
            <div className="relative">
              <input value={form.productSearch}
                onChange={e => setF("productSearch", e.target.value) || setF("product", null)}
                placeholder="Buscar por nombre o SKU…"
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
              {form.product && (
                <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                  <Package size={13} className="text-amber-400 flex-shrink-0" />
                  <span className="text-sm text-amber-400 font-medium truncate">{form.product.name}</span>
                  <span className="text-xs font-mono text-slate-500 ml-1">{form.product.sku}</span>
                  <button onClick={() => { setF("product", null); setF("productSearch", ""); }} className="ml-auto"><X size={13} className="text-slate-500" /></button>
                </div>
              )}
              {filtered.length > 0 && !form.product && (
                <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                  {filtered.slice(0, 6).map(p => {
                    const totalQty = (stockByProduct[p.id] || []).reduce((s, i) => s + (i.qty || 0), 0);
                    return (
                      <button key={p.id} onClick={() => {
                        setF("product", p); setF("productSearch", p.name);
                        if (isEnvio) {
                          // Ayuda a que el nombre coincida con el de Inventario:
                          // precargamos la búsqueda de tienda con el mismo
                          // nombre, y si hay una coincidencia exacta la
                          // seleccionamos de una vez.
                          const exact = storeProducts.find(sp => sp.name?.trim().toLowerCase() === p.name?.trim().toLowerCase());
                          setF("storeProductSearch", p.name);
                          setF("storeProduct", exact || null);
                        }
                      }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-700 flex items-center justify-between gap-2 border-b border-slate-700/50 last:border-0">
                        <div>
                          <p className="text-sm text-slate-200">{p.name}</p>
                          <p className="text-xs font-mono text-slate-500">{p.sku}</p>
                        </div>
                    <span className="text-xs font-mono text-amber-400 flex-shrink-0">Stock: {totalQty} {p.packName}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {form.productSearch && !form.product && filtered.length === 0 && (
                <p className="text-[11px] text-slate-500 mt-1.5">Sin resultados. Crea el producto primero en "Mis Productos".</p>
              )}
            </div>
          </div>

          {/* Ubicación origen — ambos tipos restantes salen de una ubicación */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Ubicación origen *</label>
            <select value={form.fromLocationId} onChange={e => setF("fromLocationId", e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
              <option value="">Seleccionar…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ""}</option>)}
            </select>
            {fromStock && <p className="text-xs text-slate-500 mt-1">Disponible: <span className="font-mono text-amber-400 font-bold">{fromStock.qty} {packName}</span></p>}
          </div>

          {/* Ubicación destino — solo Traslado */}
          {form.type === "traslado" && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Ubicación destino *</label>
              <select value={form.toLocationId} onChange={e => setF("toLocationId", e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                <option value="">Seleccionar…</option>
                {locations.filter(l => l.id !== form.fromLocationId).map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ""}</option>)}
              </select>
            </div>
          )}

          {/* Producto de TIENDA destino — solo en "Enviar a Tienda" */}
          {isEnvio && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1.5">
                <Store size={11} className="text-amber-400" /> ¿A qué producto de la tienda se suma? *
              </label>
              <div className="relative">
                <input value={form.storeProductSearch}
                  onChange={e => setF("storeProductSearch", e.target.value) || setF("storeProduct", null)}
                  placeholder="Buscar producto de tienda por nombre o SKU…"
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                {form.storeProduct && (
                  <div className="mt-2 space-y-1">
                    <div className="p-2 bg-sky-500/10 border border-sky-500/30 rounded-lg flex items-center gap-2">
                      <Store size={13} className="text-sky-400 flex-shrink-0" />
                      <span className="text-sm text-sky-300 font-medium truncate">{form.storeProduct.name}</span>
                      <span className="text-xs font-mono text-slate-500 ml-1">{form.storeProduct.sku}</span>
                      <span className="text-xs font-mono text-slate-500 ml-auto">Stock tienda: {form.storeProduct.stock ?? 0}</span>
                      <button onClick={() => { setF("storeProduct", null); setF("storeProductSearch", ""); }}><X size={13} className="text-slate-500" /></button>
                    </div>
                    {form.storeProduct.name?.trim().toLowerCase() !== form.product?.name?.trim().toLowerCase() && (
                      <p className="text-[11px] text-amber-400 flex items-center gap-1"><AlertTriangle size={11}/> El nombre no coincide exactamente con "{form.product?.name}". Verifica que sea el producto correcto.</p>
                    )}
                  </div>
                )}
                {storeFiltered.length > 0 && !form.storeProduct && (
                  <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                    {storeFiltered.slice(0, 6).map(p => {
                      const isMatch = p.name?.trim().toLowerCase() === form.product?.name?.trim().toLowerCase();
                      return (
                        <button key={p.id} onClick={() => { setF("storeProduct", p); setF("storeProductSearch", p.name); }}
                          className={`w-full text-left px-3 py-2.5 hover:bg-slate-700 flex items-center justify-between gap-2 border-b border-slate-700/50 last:border-0 ${isMatch ? "bg-emerald-500/10" : ""}`}>
                          <div>
                            <p className="text-sm text-slate-200">{p.name} {isMatch && <span className="text-emerald-400 text-[10px]">✓ coincide</span>}</p>
                            <p className="text-xs font-mono text-slate-500">{p.sku}</p>
                          </div>
                          <span className="text-xs font-mono text-sky-400 flex-shrink-0">Stock: {p.stock ?? 0}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {form.storeProductSearch && !form.storeProduct && storeFiltered.length === 0 && (
                  <p className="text-[11px] text-slate-500 mt-1.5">Sin resultados. El producto debe existir primero en Inventario.</p>
                )}
              </div>
            </div>
          )}

          {/* Cantidad — siempre en empaques (cajas), tanto para Traslado como
              para Enviar a Tienda (en este último se convierte a unidades
              reales para la tienda, ver preview abajo). */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1 block">
                Cantidad de {packName} {form.product ? `(${packQty} und c/u)` : ""} *
              </label>
              <input type="number" min="1" value={form.qty} onChange={e => setF("qty", e.target.value)} placeholder="Ej: 3"
                className="w-full px-3 py-2.5 bg-slate-900 border border-amber-500/30 rounded-lg text-sm text-amber-300 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Motivo</label>
              <input value={form.reason} onChange={e => setF("reason", e.target.value)} placeholder={isEnvio ? "Ej: Reposición semanal de tienda" : "Ej: Reordenar almacén"}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
          </div>

          {/* Preview de conversión caja → unidades en "Enviar a Tienda" */}
          {isEnvio && packCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
              <span>📦</span>
              <span><strong>{packCount}</strong> {packName} × <strong>{packQty}</strong> und = se suman <strong className="text-amber-400">{unitQty}</strong> unidades al stock de la tienda</span>
            </div>
          )}

          <button onClick={handleSubmit}
            disabled={saving || !form.product || (isEnvio && !form.storeProduct) || packCount <= 0}
            className={`w-full py-3 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 ${saving ? "bg-slate-700 text-slate-500" : `${typeInfo.bg} ${typeInfo.color} border hover:opacity-90`}`}>
            {saving ? <RefreshCw size={15} className="animate-spin" /> : typeInfo.icon}
            Registrar {typeInfo.label}
          </button>
        </>)}
      </div>
    </div>
  );
}
