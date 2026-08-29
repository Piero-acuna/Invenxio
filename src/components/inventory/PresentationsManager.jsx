// ─────────────────────────────────────────────────────────────────────────────
// src/components/inventory/PresentationsManager.jsx
//
// CRUD de product_presentations para UN producto — se monta dentro del panel
// de detalle de un producto en InventoryModule.jsx (ver integración al pie
// de este archivo). Un mismo `factor` resuelve tanto kits (Pack x6, Caja
// x10 packs) como granel (Kilogramo, Saco 35kg) — ver el comentario grande
// en 0019_kits_bulk_presentations.sql para el porqué de ese diseño.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Package2, Plus, Pencil, Trash2, Loader2, Star, ShoppingBag } from "lucide-react";
import { addPresentation, updatePresentation, deletePresentation } from "../../services/firestoreService";
import { logAndGetErrorMessage } from "../../utils/errors";
import { formatMoney } from "../../utils/currency";

const EMPTY_FORM = { name: "", barcode: "", factor: "1", price: "", isDefaultSale: false, isPurchaseOnly: false };

function PresentationsManager({ companyId, product, presentations, canEdit, canDelete, currencySymbol }) {
  const items = presentations.filter((p) => p.productId === product.id);
  const isPeso = product.unitType === "peso";

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  }
  function openEdit(pres) {
    setEditingId(pres.id);
    setForm({
      name: pres.name || "",
      barcode: pres.barcode || "",
      factor: String(pres.factor ?? "1"),
      price: String(pres.price ?? ""),
      isDefaultSale: !!pres.isDefaultSale,
      isPurchaseOnly: !!pres.isPurchaseOnly,
    });
    setError("");
    setShowForm(true);
  }

  async function handleSave() {
    const factor = Number(form.factor);
    const price = Number(form.price) || 0;
    if (!form.name.trim()) { setError("Ponle un nombre a la presentación."); return; }
    if (!factor || factor <= 0) {
      setError(isPeso
        ? 'El factor debe ser mayor a 0 (ej: "Kilogramo" = 1, "Saco 35kg" = 35).'
        : 'El factor debe ser mayor a 0 (ej: "Pack x6" = 6, "Caja x10 packs" = 60).');
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        barcode: form.barcode.trim() || null,
        factor,
        price,
        isDefaultSale: form.isDefaultSale,
        isPurchaseOnly: form.isPurchaseOnly,
      };
      if (editingId) await updatePresentation(companyId, editingId, payload);
      else await addPresentation(companyId, product.id, payload);
      setShowForm(false);
    } catch (err) {
      setError(logAndGetErrorMessage(err, "Error al guardar la presentación:", "No se pudo guardar. Intenta de nuevo."));
    }
    setSaving(false);
  }

  async function handleDelete(pres) {
    if (!window.confirm(`¿Eliminar la presentación "${pres.name}"? Las ventas ya registradas con ella no se ven afectadas.`)) return;
    setDeletingId(pres.id);
    try {
      await deletePresentation(companyId, pres.id);
    } catch (err) {
      setError(logAndGetErrorMessage(err, "Error al eliminar:", "No se pudo eliminar. Intenta de nuevo."));
    }
    setDeletingId(null);
  }

  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Package2 size={14} className="text-amber-400" />Presentaciones de Venta
        </h4>
        {canEdit && !showForm && (
          <button onClick={openNew}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-lg text-[11px] font-semibold transition-colors">
            <Plus size={12} />Nueva
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-500 mb-3">
        {isPeso
          ? 'Cada presentación dice a cuántos KG del stock base equivale (ej: "Kilogramo" = 1, "Saco 35kg" = 35).'
          : 'Cada presentación dice a cuántas unidades base equivale (ej: "Pack x6" = 6, "Caja x10 packs" = 60).'}
      </p>

      {items.length === 0 && !showForm && (
        <p className="text-xs text-slate-500 italic py-2">
          Sin presentaciones propias todavía — se vende solo por la unidad base ({product.baseUnitLabel || (isPeso ? "kg" : "un")}).
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-2 mb-3">
          {items.map((pres) => (
            <div key={pres.id} className={`flex items-center justify-between gap-2 bg-slate-900/40 rounded-lg p-2.5 border ${pres.active ? "border-slate-700/50" : "border-slate-800 opacity-50"}`}>
              <div className="min-w-0">
                <p className="text-sm text-white font-medium flex items-center gap-1.5 truncate">
                  {pres.name}
                  {pres.isDefaultSale && <Star size={11} className="text-amber-400 flex-shrink-0" />}
                  {pres.isPurchaseOnly && <ShoppingBag size={11} className="text-slate-500 flex-shrink-0" title="Solo para ingresar stock" />}
                </p>
                <p className="text-[11px] text-slate-400 font-mono truncate">
                  1 = {pres.factor} {isPeso ? "kg" : "un"} base{pres.barcode ? ` · ${pres.barcode}` : ""} · {formatMoney(pres.price, currencySymbol)}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(pres)} className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors"><Pencil size={13} /></button>
                  {canDelete && (
                    <button onClick={() => handleDelete(pres)} disabled={deletingId === pres.id} className="p-1.5 text-slate-400 hover:text-red-400 transition-colors">
                      {deletingId === pres.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700/50 space-y-2.5">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={isPeso ? 'Nombre — ej: "Kilogramo", "Saco 35kg"' : 'Nombre — ej: "Pack x6", "Caja x10 packs"'}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">Factor ({isPeso ? "kg base" : "unidades base"})</label>
              <input type="number" min="0" step="0.001" value={form.factor} onChange={(e) => setForm((f) => ({ ...f, factor: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">Precio de venta</label>
              <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
          </div>
          <input value={form.barcode} onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
            placeholder="Código de barras propio (opcional)"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
          <div className="flex flex-wrap gap-3 pt-1">
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.isDefaultSale} onChange={(e) => setForm((f) => ({ ...f, isDefaultSale: e.target.checked }))} className="accent-amber-500" />
              Preseleccionada en el POS
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.isPurchaseOnly} onChange={(e) => setForm((f) => ({ ...f, isPurchaseOnly: e.target.checked }))} className="accent-amber-500" />
              Solo para ingresar stock (no se vende)
            </label>
          </div>
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-1.5">
              {saving && <Loader2 size={13} className="animate-spin" />}{editingId ? "Guardar cambios" : "Crear presentación"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PresentationsManager;

// Ya está montado dentro del panel de detalle de producto de
// InventoryModule.jsx, justo antes del bloque "Ajustar Stock" — recibe
// `presentations` como prop desde InventorySystem.jsx (useCollection(companyId,
// "productPresentations")).
