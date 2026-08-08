// ─────────────────────────────────────────────────────────────────────────────
// src/components/RolePanel.jsx
//
// Botón "Panel" junto a la insignia de rol en el header. Al abrirse muestra:
//   • "Mis Datos" → info del usuario logueado (todos)
//   • "Equipo"     → registrar empleados y editar sus PERMISOS GRANULARES
//                    (solo el Dueño, ver canManage)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from "react";
import {
  LayoutPanelLeft, X, UserPlus, Users, Mail, Lock, User as UserIcon,
  Crown, Shield, RefreshCw, AlertCircle, CheckCircle,
  Power, PowerOff, ChevronDown, Settings2, Save, Receipt, Building2,
  Package, BarChart2, Warehouse, Truck, Sliders, Zap, Globe,
} from "lucide-react";
import { PERMISSION_GROUPS, defaultPermissions, getEffectivePermissions } from "../config/permissions";
import { COUNTRIES, getCountryConfig } from "../config/countryConfig";
import { logAndGetErrorMessage } from "../utils/errors";

// Iconos por grupo de permisos (solo visual, permissions.js se queda sin JSX)
const GROUP_ICONS = {
  inventario:   <Package size={12} />,
  movimientos:  <BarChart2 size={12} />,
  almacen:      <Warehouse size={12} />,
  proveedores:  <Truck size={12} />,
  sistema:      <Sliders size={12} />,
};

// Plantillas rápidas de acceso — para no tener que marcar cada casilla a mano
// cada vez que se registra un empleado con un rol típico.
const ACCESS_PRESETS = [
  { id: "vendedor",   label: "🛒 Vendedor",    keys: ["ver_inventario", "registrar_ventas"] },
  { id: "almacenero", label: "🏬 Almacenero",  keys: ["ver_inventario", "ver_almacen", "gestionar_almacen"] },
  { id: "proveedores",label: "🚚 Proveedores", keys: ["ver_inventario", "ver_proveedores", "gestionar_proveedores"] },
  { id: "completo",   label: "👑 Acceso total",keys: null }, // null = todos los permisos
  { id: "basico",     label: "↺ Básico",       keys: [] },   // vacío = solo los default
];
function applyPreset(preset) {
  if (preset.keys === null) {
    const all = {};
    PERMISSION_GROUPS.forEach(g => g.permissions.forEach(p => { all[p.key] = true; }));
    return all;
  }
  if (preset.keys.length === 0) return defaultPermissions();
  const obj = {};
  PERMISSION_GROUPS.forEach(g => g.permissions.forEach(p => { obj[p.key] = preset.keys.includes(p.key); }));
  return obj;
}

// ── Insignia de rol reutilizable (solo distingue Dueño / Empleado) ───────────
export const RoleBadge = ({ role }) => {
  const isOwner = role === "owner";
  const Icon = isOwner ? Crown : Shield;
  return (
    <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 ${
      isOwner ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-sky-500/10 border-sky-500/30 text-sky-400"
    } border rounded-lg`}>
      <Icon size={11} />
      <span className="text-xs font-medium">{isOwner ? "Dueño" : "Empleado"}</span>
    </div>
  );
};

// ── Editor de "Permisos de Acceso" reutilizable (alta y edición) ─────────────
function PermissionsEditor({ value, onChange, disabled, showPresets }) {
  const toggle = (key) => {
    if (disabled) return;
    onChange({ ...value, [key]: !value[key] });
  };
  const toggleGroup = (group, allOn) => {
    if (disabled) return;
    const next = { ...value };
    group.permissions.forEach(p => { next[p.key] = allOn; });
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {showPresets && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Zap size={10} />Plantillas rápidas</p>
          <div className="flex flex-wrap gap-1.5">
            {ACCESS_PRESETS.map(preset => (
              <button key={preset.id} type="button" disabled={disabled}
                onClick={() => onChange(applyPreset(preset))}
                className="text-[11px] px-2.5 py-1 rounded-full border border-slate-700 bg-slate-800 text-slate-300 hover:border-amber-500/50 hover:text-amber-400 transition-colors disabled:opacity-50">
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {PERMISSION_GROUPS.map(group => {
        const allOn = group.permissions.every(p => !!value[p.key]);
        return (
        <div key={group.id}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="text-amber-400/70">{GROUP_ICONS[group.id]}</span>{group.label}
            </p>
            <button type="button" disabled={disabled} onClick={() => toggleGroup(group, !allOn)}
              className="text-[10px] text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-50">
              {allOn ? "Quitar todo" : "Activar todo"}
            </button>
          </div>
          <div className="space-y-1.5">
            {group.permissions.map(perm => {
              const checked = !!value[perm.key];
              const danger  = perm.danger;
              return (
                <label
                  key={perm.key}
                  title={perm.help}
                  className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                    danger && checked
                      ? "bg-red-500/10 border-red-500/40"
                      : checked
                      ? "bg-amber-500/5 border-amber-500/20"
                      : "bg-slate-800/40 border-slate-700/60 hover:border-slate-600"
                  } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(perm.key)}
                    className={`mt-0.5 accent-amber-500 ${danger ? "accent-red-500" : ""}`}
                  />
                  <div className="min-w-0">
                    <p className={`text-xs font-medium ${danger && checked ? "text-red-400" : "text-slate-200"}`}>
                      {perm.label}
                      {danger && checked && <span className="ml-1.5 text-[10px] font-bold uppercase">⚠ Riesgoso</span>}
                    </p>
                    {perm.help && <p className="text-[11px] text-slate-500 leading-snug">{perm.help}</p>}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function RolePanel({
  userProfile, companyName, canManage,
  employees, employeesLoading,
  onRegisterEmployee, onChangePermissions, onToggleActive,
  billing, onSaveBilling,
  companyCurrency, onChangeCountry,
}) {
  const [open,     setOpen]     = useState(false);
  const [tab,      setTab]      = useState("perfil"); // "perfil" | "equipo"
  const [showForm, setShowForm] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle() {
    setOpen(o => !o);
    setTab("perfil");
    setShowForm(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
          open ? "bg-amber-500 text-slate-900 border-amber-500" : "bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600"
        }`}
      >
        <LayoutPanelLeft size={13} /> Panel
      </button>

      {open && (
        <div className="absolute left-0 sm:left-auto right-0 mt-2 w-[calc(100vw-1.5rem)] sm:w-[26rem] max-w-[26rem] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex border-b border-slate-800">
            <button onClick={() => setTab("perfil")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${tab === "perfil" ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
              <UserIcon size={13} /> Mis Datos
            </button>
            {canManage && (
              <button onClick={() => setTab("equipo")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${tab === "equipo" ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                <Users size={13} /> Equipo
              </button>
            )}
            {userProfile?.role === "owner" && (
              <button onClick={() => setTab("facturacion")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${tab === "facturacion" ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                <Receipt size={13} /> Facturación
              </button>
            )}
            <button onClick={() => setOpen(false)} className="px-3 text-slate-500 hover:text-slate-300"><X size={14} /></button>
          </div>

          <div className="p-4 max-h-[min(32rem,70vh)] overflow-y-auto">
            {tab === "perfil" && <PerfilTab userProfile={userProfile} companyName={companyName} companyCurrency={companyCurrency} onChangeCountry={onChangeCountry} />}
            {tab === "equipo" && canManage && (
              <EquipoTab
                employees={employees}
                loading={employeesLoading}
                showForm={showForm}
                setShowForm={setShowForm}
                onRegisterEmployee={onRegisterEmployee}
                onChangePermissions={onChangePermissions}
                onToggleActive={onToggleActive}
                currentUid={userProfile?.id}
              />
            )}
            {tab === "facturacion" && userProfile?.role === "owner" && (
              <BillingTab billing={billing} onSave={onSaveBilling} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pestaña: Mis Datos ────────────────────────────────────────────────────────
function PerfilTab({ userProfile, companyName, companyCurrency, onChangeCountry }) {
  if (!userProfile) return null;
  const isOwner = userProfile.role === "owner";
  const perms = getEffectivePermissions(userProfile);
  const activeKeys = Object.entries(perms).filter(([, v]) => v).map(([k]) => k);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-sm font-bold text-slate-900">
          {(userProfile.name || userProfile.email || "?")[0]?.toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{userProfile.name || "Sin nombre"}</p>
          <p className="text-xs text-slate-500">{userProfile.email}</p>
        </div>
      </div>

      <Row label="Rol" value={isOwner ? "Dueño" : "Empleado"} />
      <Row label="Empresa" value={companyName} />
      <Row label="Estado" value={userProfile.active === false ? "Desactivado" : "Activo"} />

      {isOwner && (
        <CurrencySection companyCurrency={companyCurrency} onChangeCountry={onChangeCountry} />
      )}

      {!isOwner && (
        <div className="pt-2 border-t border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Mis permisos activos</p>
          {activeKeys.length === 0 ? (
            <p className="text-xs text-slate-600">Sin permisos asignados todavía.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeKeys.map(k => (
                <span key={k} className="text-[11px] px-2 py-0.5 bg-slate-800 border border-slate-700 rounded-full text-slate-300">
                  {labelFor(k)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sección: Moneda y pasarela de pago (solo Dueño) ──────────────────────────
// Cambiar el país recalcula moneda + pasarela según countryConfig.js. NO
// convierte montos ya guardados (ver el aviso que se muestra abajo) — solo
// cambia el símbolo con el que se muestra todo de ahora en adelante y a qué
// pasarela se le cobra la próxima suscripción.
function CurrencySection({ companyCurrency, onChangeCountry }) {
  const [country,  setCountry]  = useState(companyCurrency?.country || "PE");
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState("");

  // Si companyCurrency cambia desde afuera (ej. otra pestaña del navegador),
  // reflejamos el valor real mientras el Dueño no tenga una edición pendiente.
  useEffect(() => {
    if (!saving) setCountry(companyCurrency?.country || "PE");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCurrency?.country]);

  const preview = getCountryConfig(country);
  const isDirty = country !== (companyCurrency?.country || "PE");

  async function handleSave() {
    setError(""); setSaving(true);
    try {
      await onChangeCountry(country);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(logAndGetErrorMessage(err, "Error al cambiar la moneda:", "No se pudo cambiar la moneda."));
    }
    setSaving(false);
  }

  return (
    <div className="pt-2 border-t border-slate-800 space-y-2">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
        <Globe size={11} /> Moneda y pasarela de pago
      </p>

      <div className="relative">
        <select
          value={country}
          onChange={e => { setCountry(e.target.value); setSaved(false); }}
          className="w-full pl-3 pr-4 py-2 bg-slate-800 border border-slate-700 focus:border-amber-500 rounded-lg text-xs text-slate-200 focus:outline-none transition-colors appearance-none"
        >
          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </div>

      <p className="text-[11px] text-slate-500">
        {preview.paymentGateway === "culqi"
          ? `Se mostrará todo en soles (${preview.currencySymbol}) y se cobrará por Culqi.`
          : `Se mostrará todo en dólares (${preview.currencySymbol}) y se cobrará por Mercado Pago.`}
      </p>

      {isDirty && (
        <div className="flex items-start gap-1.5 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[11px] text-amber-300 leading-snug">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          Esto no convierte los precios que ya tienes guardados — un producto que cuesta "20" hoy va a seguir costando "20", solo cambia el símbolo. Ajusta tus precios manualmente si corresponde.
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />{error}
        </div>
      )}

      {isDirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-1.5 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 disabled:text-slate-500 font-semibold text-xs rounded-lg transition-colors"
        >
          {saving ? <RefreshCw size={13} className="animate-spin" /> : saved ? <CheckCircle size={13} /> : <Save size={13} />}
          {saved ? "Guardado" : "Guardar cambio de moneda"}
        </button>
      )}
    </div>
  );
}

function labelFor(key) {
  for (const g of PERMISSION_GROUPS) {
    const p = g.permissions.find(p => p.key === key);
    if (p) return p.label;
  }
  return key;
}

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-slate-500 uppercase tracking-wider">{label}</span>
    <span className="text-slate-200 font-medium">{value}</span>
  </div>
);

// ── Pestaña: Equipo (registrar empleados + lista con permisos editables) ────
function EquipoTab({
  employees, loading, showForm, setShowForm,
  onRegisterEmployee, onChangePermissions, onToggleActive, currentUid,
}) {
  return (
    <div className="space-y-3">
      {!showForm ? (
        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded-lg transition-colors">
          <UserPlus size={14} /> Registrar Empleado
        </button>
      ) : (
        <EmployeeForm
          onCancel={() => setShowForm(false)}
          onSubmit={async (data) => { await onRegisterEmployee(data); setShowForm(false); }}
        />
      )}

      <div className="pt-2 border-t border-slate-800">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
          {loading ? "Cargando equipo…" : `Equipo (${employees.length})`}
        </p>

        {loading ? (
          <div className="flex justify-center py-4"><RefreshCw size={16} className="animate-spin text-slate-500" /></div>
        ) : (
          <div className="space-y-2">
            {employees.map(emp => (
              <EmployeeRow
                key={emp.uid}
                emp={emp}
                isSelf={emp.uid === currentUid}
                onChangePermissions={onChangePermissions}
                onToggleActive={onToggleActive}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pestaña: Facturación (Datos del Dueño para emitir comprobantes) ─────────
function BillingTab({ billing, onSave }) {
  const [form, setForm] = useState(() => ({
    razonSocial: billing?.razonSocial || "",
    ruc:         billing?.ruc         || "",
    direccion:   billing?.direccion   || "",
    telefono:    billing?.telefono    || "",
    email:       billing?.email       || "",
    serie:       billing?.serie       || "F001",
  }));
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState("");

  // Si llegan datos nuevos desde Firestore (o se cargan por primera vez),
  // refrescamos el formulario solo si el usuario no tiene cambios sin guardar.
  useEffect(() => {
    if (!saving) {
      setForm({
        razonSocial: billing?.razonSocial || "",
        ruc:         billing?.ruc         || "",
        direccion:   billing?.direccion   || "",
        telefono:    billing?.telefono    || "",
        email:       billing?.email       || "",
        serie:       billing?.serie       || "F001",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billing]);

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setError("");
    if (!form.razonSocial.trim()) {
      setError("La razón social / nombre del negocio es obligatoria.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(logAndGetErrorMessage(err, "Error al guardar datos de facturación:", "No se pudo guardar."));
    }
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-2.5 bg-sky-500/10 border border-sky-500/30 rounded-lg text-[11px] text-sky-300 leading-snug">
        <Building2 size={13} className="flex-shrink-0 mt-0.5" />
        Estos datos aparecen en los comprobantes (PDF) que se generan al registrar una venta o al marcar una compra a proveedor como "Entregado". Son comprobantes de uso interno, no facturas electrónicas SUNAT.
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />{error}
        </div>
      )}

      <FieldMini label="Razón Social / Nombre del negocio *" value={form.razonSocial} onChange={v => set("razonSocial", v)} placeholder="Ej: Invenxio E.I.R.L." />
      <div className="grid grid-cols-2 gap-2">
        <FieldMini label="RUC / DNI" value={form.ruc} onChange={v => set("ruc", v)} placeholder="20123456789" />
        <FieldMini label="Serie comprobante" value={form.serie} onChange={v => set("serie", v.toUpperCase())} placeholder="F001" />
      </div>
      <FieldMini label="Dirección" value={form.direccion} onChange={v => set("direccion", v)} placeholder="Av. Ejemplo 123, Lima" />
      <div className="grid grid-cols-2 gap-2">
        <FieldMini label="Teléfono" value={form.telefono} onChange={v => set("telefono", v)} placeholder="987 654 321" />
        <FieldMini label="Email" value={form.email} onChange={v => set("email", v)} placeholder="contacto@negocio.com" type="email" />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 disabled:text-slate-500 font-semibold text-xs rounded-lg transition-colors"
      >
        {saving ? <RefreshCw size={13} className="animate-spin" /> : saved ? <CheckCircle size={13} /> : <Save size={13} />}
        {saved ? "Guardado" : "Guardar datos de facturación"}
      </button>
    </div>
  );
}

const FieldMini = ({ label, value, onChange, ...props }) => (
  <div>
    <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</label>
    <input
      {...props}
      value={value}
      onChange={e => onChange(e.target.value)}
      autoComplete="off"
      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
    />
  </div>
);

function EmployeeRow({ emp, isSelf, onChangePermissions, onToggleActive }) {
  const isOwner  = emp.role === "owner";
  const isActive = emp.active !== false;
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(() => getEffectivePermissions(emp));
  const [saving,  setSaving]  = useState(false);

  async function handleSave() {
    setSaving(true);
    try { await onChangePermissions(emp.uid, draft); setEditing(false); }
    finally { setSaving(false); }
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 p-2">
        <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-300 flex-shrink-0">
          {(emp.name || emp.email || "?")[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-200 truncate">
            {emp.name || emp.email} {isSelf && <span className="text-slate-500">(tú)</span>}
          </p>
          <p className="text-[11px] text-slate-500 truncate">{emp.email}</p>
        </div>

        {isOwner ? (
          <span className="text-[11px] text-amber-400 font-semibold flex items-center gap-1">
            <Crown size={11} /> Dueño
          </span>
        ) : (
          <>
            <button
              onClick={() => setEditing(e => !e)}
              title="Editar permisos"
              className={`p-1.5 rounded-lg transition-colors ${editing ? "bg-amber-500/20 text-amber-400" : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"}`}
            >
              <Settings2 size={13} />
            </button>
            <button
              title={isActive ? "Desactivar acceso" : "Activar acceso"}
              disabled={isSelf}
              onClick={() => onToggleActive(emp.uid, !isActive)}
              className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isActive ? "text-emerald-400 hover:bg-emerald-500/10" : "text-slate-600 hover:bg-slate-700"}`}
            >
              {isActive ? <Power size={13} /> : <PowerOff size={13} />}
            </button>
            <ChevronDown size={13} className={`text-slate-600 transition-transform ${editing ? "rotate-180" : ""}`} />
          </>
        )}
      </div>

      {!isOwner && editing && (
        <div className="p-3 pt-1 border-t border-slate-700/60 bg-slate-900/40">
          <PermissionsEditor value={draft} onChange={setDraft} showPresets />
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full mt-3 flex items-center justify-center gap-1.5 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 disabled:text-slate-500 font-semibold text-xs rounded-lg transition-colors"
          >
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />} Guardar permisos
          </button>
        </div>
      )}
    </div>
  );
}

// ── Mini formulario de alta de empleado ───────────────────────────────────────
function EmployeeForm({ onSubmit, onCancel }) {
  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [permissions, setPermissions] = useState(() => defaultPermissions());
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [success,     setSuccess]     = useState(false);

  async function handleSubmit() {
    setError("");
    if (!name || !email || password.length < 6) {
      setError(!password || password.length < 6
        ? "La contraseña debe tener al menos 6 caracteres."
        : "Completa nombre y correo.");
      return;
    }
    setLoading(true);
    try {
      await onSubmit({ name, email, password, permissions });
      setSuccess(true);
    } catch (err) {
      setError(logAndGetErrorMessage(err, "Error al registrar empleado:", "No se pudo registrar al empleado."));
    }
    setLoading(false);
  }

  if (success) {
    return (
      <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-400">
        <CheckCircle size={14} /> ¡Empleado registrado! Ya puede iniciar sesión.
      </div>
    );
  }

  return (
    <div className="p-3 bg-slate-800/60 border border-slate-700 rounded-lg space-y-3">
      {error && (
        <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />{error}
        </div>
      )}
      <InputMini icon={<UserIcon size={12} />} placeholder="Nombre del empleado" value={name} onChange={setName} />
      <InputMini icon={<Mail size={12} />} placeholder="correo@empresa.com" value={email} onChange={setEmail} type="email" />
      <InputMini icon={<Lock size={12} />} placeholder="Contraseña temporal" value={password} onChange={setPassword} type="password" />

      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Permisos de Acceso</p>
        <PermissionsEditor value={permissions} onChange={setPermissions} showPresets />
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-2 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg transition-colors">
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 disabled:text-slate-500 font-semibold text-xs rounded-lg transition-colors"
        >
          {loading ? <RefreshCw size={13} className="animate-spin" /> : "Crear cuenta"}
        </button>
      </div>
    </div>
  );
}

const InputMini = ({ icon, value, onChange, ...props }) => (
  <div className="relative">
    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">{icon}</span>
    <input
      {...props}
      value={value}
      onChange={e => onChange(e.target.value)}
      autoComplete="off"
      className="w-full pl-7 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
    />
  </div>
);
