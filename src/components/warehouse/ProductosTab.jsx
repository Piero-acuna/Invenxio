// ─────────────────────────────────────────────────────────────────────────────
// src/components/warehouse/ProductosTab.jsx
// Pestaña "📦 Mis Productos" (catálogo propio del almacén). Aquí se EDITA lo
// que ya existe (nombre, empaque, precio, stock) y se gestiona — pero ya NO
// se crean productos nuevos desde acá: eso ahora vive solo en Inventario
// (InventoryModule.jsx → "Nuevo Producto" → "También enviarlo a Almacén"),
// para que el catálogo de tienda sea siempre la única fuente de verdad de
// qué productos existen. El stock siempre se cuenta en EMPAQUES completos
// (cajas), nunca en unidades sueltas. Extraído de WarehouseModule.jsx al
// separar el monolito.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import {
  X, Edit3, Trash2, Search, RefreshCw, CheckCircle, MapPin, Boxes, Plus, Info,
} from "lucide-react";
import { updateWarehouseProduct, deleteWarehouseProduct } from "../../services/firestoreService";
import { logAndGetErrorMessage } from "../../utils/errors";
import { EmptyState } from "../shared/StatusUI";
import AddStockModal from "./AddStockModal";
import { useAuth } from "../../contexts/AuthContext";
import { formatMoney } from "../../utils/currency";

export default function ProductosTab({ warehouseProducts, stockByProduct, locations, userName, companyId }) {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
  const EMPTY_FORM = { name: "", sku: "", description: "", packName: "", packQty: "", unitPrice: "" };
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [search,   setSearch]   = useState("");
  const [stockFor, setStockFor] = useState(null); // producto para el que se abrió "Agregar Stock"

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function openEdit(p) {
    setEditItem(p);
    setForm({ ...EMPTY_FORM, name: p.name || "", sku: p.sku || "", description: p.description || "", packName: p.packName || "", packQty: p.packQty ?? "", unitPrice: p.unitPrice ?? "" });
    setError(""); setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim())              { setError("El nombre es obligatorio."); return; }
    if (!form.packName.trim())          { setError("Indica la unidad de empaque (ej: Caja, Paquete)."); return; }
    if (!form.packQty || Number(form.packQty) <= 0) { setError("Indica cuántas unidades trae cada empaque."); return; }
    setError(""); setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        description: form.description.trim(),
        packName: form.packName.trim(),
        packQty: Number(form.packQty),
        unitPrice: form.unitPrice ? Number(form.unitPrice) : null,
      };
      await updateWarehouseProduct(companyId, editItem.id, payload);
      setShowForm(false); setEditItem(null); setForm(EMPTY_FORM);
    } catch (e) { setError(logAndGetErrorMessage(e, "Error al guardar producto de almacén:", "Error al guardar el producto.")); }
    setSaving(false);
  }

  async function handleDelete(p) {
    const hasStock = (stockByProduct[p.id] || []).some(s => s.qty > 0);
    if (hasStock) { alert("No puedes eliminar un producto con stock registrado en alguna ubicación. Trasládalo o envíalo a la tienda primero."); return; }
    if (!confirm(`¿Eliminar "${p.name}" del catálogo de almacén?`)) return;
    try { await deleteWarehouseProduct(companyId, p.id); } catch (e) { alert(logAndGetErrorMessage(e, "Error al eliminar producto de almacén:", "No se pudo eliminar el producto.")); }
  }

  const filtered = warehouseProducts.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl text-xs text-sky-300">
        <Info size={14} className="flex-shrink-0 mt-0.5" />
        <span>
          Los productos nuevos se crean desde <strong>Inventario → Nuevo Producto → "También enviarlo a Almacén"</strong>, eligiendo a qué ubicación va. Acá puedes editar los que ya existen, agregarles más stock, o revisar dónde está guardado cada uno.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-36">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
            className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
        </div>
      </div>

      {showForm && editItem && (
        <div className="p-4 bg-slate-800/60 border border-slate-700 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-white">Editar producto</p>
            <button onClick={() => { setShowForm(false); setEditItem(null); }} className="text-slate-500 hover:text-slate-300"><X size={15}/></button>
          </div>
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre *</label>
              <input value={form.name} onChange={e => setF("name", e.target.value)} placeholder="Ej: Gaseosa Cola 500ml"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Código</label>
              <input value={form.sku} onChange={e => setF("sku", e.target.value)} placeholder="Opcional"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Unidad por empaque *</label>
              <input value={form.packName} onChange={e => setF("packName", e.target.value)} placeholder="Ej: Caja"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Unidades por empaque *</label>
              <input type="number" min="1" value={form.packQty} onChange={e => setF("packQty", e.target.value)} placeholder="Ej: 24"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Precio de cada uno ({currencySymbol})</label>
              <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={e => setF("unitPrice", e.target.value)} placeholder="0.00"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
              <p className="text-[10px] text-slate-600 mb-1">Se muestra en Compra/Venta a Proveedor y en el comprobante</p>
              <textarea value={form.description} onChange={e => setF("description", e.target.value)} placeholder="Ej: Presentación de 500ml, vidrio retornable…" rows={2}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors resize-none"/>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowForm(false); setEditItem(null); }} className="flex-1 py-2 text-xs border border-slate-700 text-slate-400 rounded-lg hover:border-slate-600 transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 text-xs bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 disabled:text-slate-500 font-semibold rounded-lg transition-colors flex items-center justify-center gap-1">
              {saving ? <RefreshCw size={12} className="animate-spin"/> : <CheckCircle size={12}/>}
              Guardar cambios
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={<Boxes size={28}/>} msg={warehouseProducts.length === 0 ? "Aún no hay productos enviados al almacén." : "Sin resultados para tu búsqueda."} sub={warehouseProducts.length === 0 ? "Créalos desde Inventario → Nuevo Producto → \"También enviarlo a Almacén\"." : ""} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(p => {
            const locs = (stockByProduct[p.id] || []).filter(s => s.qty > 0);
            const totalPacks = locs.reduce((s, i) => s + (i.qty || 0), 0);
            return (
              <div key={p.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{p.name}</p>
                    {p.sku && <p className="text-[10px] font-mono text-slate-500">{p.sku}</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(p)} className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors"><Edit3 size={12}/></button>
                    <button onClick={() => handleDelete(p)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={12}/></button>
                  </div>
                </div>
                <p className="text-[11px] text-amber-400/80">📦 {p.packName} × {p.packQty} und{Number(p.unitPrice) > 0 ? ` · ${formatMoney(p.unitPrice, currencySymbol)} c/u` : ""}</p>
                {p.description && <p className="text-[11px] text-slate-500 line-clamp-2">{p.description}</p>}

                {/* Ubicación, nombre y cantidad por ubicación */}
                <div className="border-t border-slate-700/50 pt-2 space-y-1">
                  {locs.length === 0 ? (
                    <p className="text-[11px] text-slate-600 italic">Sin stock en ninguna ubicación</p>
                  ) : locs.map(l => (
                    <div key={l.id} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 flex items-center gap-1"><MapPin size={10} className="text-amber-400"/>{l.locationName}</span>
                      <span className="font-mono font-bold text-amber-400">{l.qty} {p.packName}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-slate-700/50 pt-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Total</span>
                  <span className="font-mono font-bold text-amber-400">{totalPacks} {p.packName}</span>
                </div>
                <button onClick={() => setStockFor(p)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg transition-colors">
                  <Plus size={11}/> Agregar Stock
                </button>
              </div>
            );
          })}
        </div>
      )}

      {stockFor && (
        <AddStockModal product={stockFor} locations={locations} companyId={companyId} userName={userName} onClose={() => setStockFor(null)} />
      )}
    </div>
  );
}
