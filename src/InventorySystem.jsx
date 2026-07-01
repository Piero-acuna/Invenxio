// ─────────────────────────────────────────────────────────────────────────────
// src/InventorySystem.jsx  –  Invenxio v4.1
// Cambios: Fix de NaN en edición, eliminar productos y proveedores.
//
// Dependencias npm adicionales:
//   npm install jsbarcode @zxing/browser xlsx
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Search, X, Plus, ShoppingCart, Package, Truck, Star, History,
  ArrowUpCircle, ArrowDownCircle, AlertTriangle, CheckCircle,
  Edit3, BarChart2, Users, TrendingUp, Box, Minus, Trash2,
  Phone, Mail, MapPin, RefreshCw, FileText, Zap, Clock,
  Receipt, BookOpen, Send, Tag, Calendar, LogOut,
  Loader2, ScanBarcode, CameraOff, Save, FileSpreadsheet, FileDown,
} from "lucide-react";
import { useAuth } from "./contexts/AuthContext";
import { exportToExcel } from "./utils/exportExcel";
import {
  subscribeToCollection,
  addProduct, updateProduct, deleteProduct, adjustProductStock,
  addSupplier, updateSupplier, deleteSupplier,
  recordPurchase, recordSale,
  addSupplierSale, updateSupplierSaleStatus,
  subscribeToEmployees, updateUserPermissions, setEmployeeActive,
  subscribeToCompany, updateCompanyBilling, getNextInvoiceNumber,
} from "./services/firestoreService";
import RolePanel, { RoleBadge } from "./components/RolePanel";
import { hasPermission, canSeeTab, TAB_DEFS } from "./config/permissions";
import { generateInvoicePDF } from "./utils/generateInvoicePDF";

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";

import { BrowserMultiFormatReader } from "@zxing/browser"; 
import JsBarcode from "jsbarcode";

// ─── BARCODE HELPERS ─────────────────────────────────────────────────────────

/** Genera un código EAN-13 válido (12 dígitos + dígito de control) */
function generateEAN13() {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const checksum = digits.reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 1 : 3), 0);
  const ctrl = (10 - (checksum % 10)) % 10;
  return [...digits, ctrl].join("");
}

/**
 * Renderiza un EAN-13 como SVG puro (sin dependencias externas).
 * Implementación minimalista de barras EAN-13.
 */
// Genera código simple compatible con CODE128
function generateBarcode() {
  const prefix = "INV";
  const random = Math.floor(Math.random() * 1000000000).toString().padStart(9, "0");
  return `${prefix}${random}`;
}

function BarcodeDisplay({ value, width = 280, height = 80 }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!value || !svgRef.current) return;

    // Pequeño delay para asegurar que el SVG está montado en el DOM
    const timer = setTimeout(() => {
      try {
        JsBarcode(svgRef.current, String(value), {
          format: "CODE128",
          width: 2,
          height: height,
          displayValue: true,
          fontSize: 12,
          fontOptions: "bold",
          margin: 10,
          background: "#ffffff",
          lineColor: "#111827",
          textMargin: 4,
          font: "monospace",
        });
      } catch (err) {
        console.warn("Barcode error:", value, err);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [value, height]);

  if (!value) return null;

  return (
    <div className="flex flex-col items-center bg-white rounded-lg p-3">
      <svg ref={svgRef} style={{ width: "100%", maxWidth: width }} />
    </div>
  );
}

// ─── BARCODE SCANNER COMPONENT ────────────────────────────────────────────────
// La cámara siempre intenta abrirse con getUserMedia.
// Si BarcodeDetector nativo está disponible → detección automática.
// Si no → cámara visible + entrada manual (el usuario apunta y escribe el código).
function BarcodeScanner({ onDetected, onClose }) {
  const videoRef  = useRef(null);
  const readerRef = useRef(null);
  const doneRef   = useRef(false);

  const [camStatus, setCamStatus] = useState("starting");
  const [manual,    setManual]    = useState("");

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    async function start() {
      try {
        if (videoRef.current) {
          videoRef.current.onplay = () => setCamStatus("active");
        }

        await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width:  { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result, err) => {
            if (doneRef.current) return;
            if (result) {
              doneRef.current = true;
              cleanup();
              onDetected(result.getText());
            }
            // err es normal cuando no hay código en el frame — ignorar
          }
        );
      } catch (err) {
        console.error("Scanner error:", err);
        setCamStatus("error");
      }
    }

    function cleanup() {
      try { readerRef.current?.reset(); } catch (_) {}
    }

    start();
    return cleanup;
  }, []); // eslint-disable-line

  const submitManual = () => {
    const code = manual.trim();
    if (!code) return;
    doneRef.current = true;
    try { readerRef.current?.reset(); } catch (_) {}
    onDetected(code);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <ScanBarcode size={18} className="text-amber-400" />
            <h3 className="font-bold text-white text-sm">Escanear Código de Barras</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Viewport */}
        <div className="relative bg-black overflow-hidden" style={{ aspectRatio: "4/3" }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Spinner cargando */}
          {camStatus === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 z-10">
              <Loader2 size={30} className="animate-spin text-amber-400" />
              <p className="text-xs text-slate-400">Iniciando cámara…</p>
            </div>
          )}

          {/* Error cámara */}
          {camStatus === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 z-10">
              <CameraOff size={30} className="text-slate-500" />
              <p className="text-xs text-slate-400 text-center px-4">
                Sin acceso a la cámara.<br />Usa el campo manual.
              </p>
            </div>
          )}

          {/* Marco de escaneo */}
          {camStatus === "active" && (
            <>
              {/* Overlay oscuro con recorte */}
              <div className="absolute inset-0 z-10 pointer-events-none"
                style={{
                  background: `linear-gradient(rgba(0,0,0,0.45) 0%, transparent 25%, transparent 75%, rgba(0,0,0,0.45) 100%),
                               linear-gradient(90deg, rgba(0,0,0,0.45) 0%, transparent 15%, transparent 85%, rgba(0,0,0,0.45) 100%)`
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div className="relative w-64 h-36">
                  {/* Esquinas del marco */}
                  {[
                    ["top-0 left-0",     "border-t-3 border-l-3"],
                    ["top-0 right-0",    "border-t-3 border-r-3"],
                    ["bottom-0 left-0",  "border-b-3 border-l-3"],
                    ["bottom-0 right-0", "border-b-3 border-r-3"],
                  ].map(([pos, cls], i) => (
                    <div key={i} className={`absolute ${pos} w-8 h-8 border-amber-400 ${cls}`}
                      style={{ borderWidth: 3 }} />
                  ))}
                  {/* Línea de escaneo */}
                  <div
                    className="absolute left-3 right-3 h-0.5 bg-amber-400 rounded shadow-lg"
                    style={{
                      boxShadow: "0 0 8px 2px rgba(251,191,36,0.6)",
                      animation: "scanline 1.8s ease-in-out infinite",
                    }}
                  />
                </div>
              </div>

              {/* Badge activo */}
              <div className="absolute bottom-3 left-0 right-0 flex justify-center z-20">
                <span className="flex items-center gap-1.5 text-xs text-white bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Escaneando… apunta al código
                </span>
              </div>
            </>
          )}
        </div>

        {/* Input manual */}
        <div className="p-4 space-y-2">
          <p className="text-xs text-slate-400 text-center">
            {camStatus === "error" ? "Ingresa el código manualmente:" : "O escribe el código:"}
          </p>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={e => setManual(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitManual()}
              placeholder="Ej: 7501234567890"
              autoFocus={camStatus === "error"}
              className="flex-1 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors font-mono tracking-wider"
            />
            <button
              onClick={submitManual}
              disabled={!manual.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-lg text-sm transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      </div>

      {/* CSS para la línea de escaneo */}
      <style>{`
        @keyframes scanline {
          0%, 100% { top: 10%; }
          50% { top: 85%; }
        }
      `}</style>
    </div>
  );
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STOCK_STATUS = ["En Stock", "Stock Bajo", "Agotado"];

// ─── HOOK: colección reactiva ─────────────────────────────────────────────────
function useCollection(companyId, colName, orderField = "createdAt") {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    const unsub = subscribeToCollection(companyId, colName, data => {
      setItems(data);
      setLoading(false);
    }, orderField);
    return unsub;
  }, [companyId, colName, orderField]);
  return [items, loading];
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const cfg = {
    "En Stock":   { bg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle size={11} /> },
    "Stock Bajo": { bg: "bg-amber-500/15 text-amber-400 border-amber-500/30",       icon: <AlertTriangle size={11} /> },
    "Agotado":    { bg: "bg-red-500/15 text-red-400 border-red-500/30",             icon: <X size={11} /> },
    "Entregado":  { bg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle size={11} /> },
    "Pendiente":  { bg: "bg-amber-500/15 text-amber-400 border-amber-500/30",       icon: <Clock size={11} /> },
    "Cancelado":  { bg: "bg-red-500/15 text-red-400 border-red-500/30",             icon: <X size={11} /> },
  }[status] || { bg: "bg-slate-500/15 text-slate-400 border-slate-500/30", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border font-medium ${cfg.bg}`}>
      {cfg.icon}{status}
    </span>
  );
};

const Stars = ({ rating, max = 5 }) => (
  <div className="flex gap-0.5">
    {Array.from({ length: max }).map((_, i) => (
      <Star key={i} size={13} className={i < rating ? "text-amber-400 fill-amber-400" : "text-slate-600"} />
    ))}
  </div>
);

const Spinner = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 size={28} className="animate-spin text-amber-400" />
  </div>
);

// ─── HISTORY TABLE ────────────────────────────────────────────────────────────
const TransactionHistory = ({ transactions: rawTransactions, loading, canViewFinance, canPurchase, canSell, billing, companyId }) => {
  const [search, setSearch] = useState("");
  const [typeF,  setTypeF]  = useState("all");
  const [chartPeriod, setChartPeriod] = useState("monthly"); // "monthly" | "weekly"

  // Solo se procesan/muestran los tipos de transacción que el usuario tiene
  // permitido ver. Un empleado con únicamente "registrar_ventas" nunca debe
  // ver registros de tipo "compra" en el historial (ni en gráficos, ni en
  // totales), aunque existan en la empresa.
  const transactions = useMemo(
    () => rawTransactions.filter(t =>
      (t.type === "compra" && canPurchase) ||
      (t.type === "venta"  && canSell)
    ),
    [rawTransactions, canPurchase, canSell]
  );

  // ── Parsear fecha desde string "DD/MM/YYYY" o timestamp ──────────────────
  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    if (typeof dateStr === "object" && dateStr.toDate) return dateStr.toDate();
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      return new Date(`${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`);
    }
    const d = new Date(dateStr);
    return isNaN(d) ? null : d;
  };

  // ── Datos para gráfico mensual (últimos 6 meses) ──────────────────────────
  const monthlyData = useMemo(() => {
    const months = {};
    const now = new Date();
    // Inicializar últimos 6 meses
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const label = d.toLocaleDateString("es-PE", { month: "short", year: "2-digit" });
      months[key] = { label, ingresos: 0, egresos: 0, ganancia: 0 };
    }
    transactions.forEach(t => {
      const d = parseDate(t.date);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      if (!months[key]) return;
      if (t.type === "venta")  months[key].ingresos += t.total || 0;
      if (t.type === "compra") months[key].egresos  += t.total || 0;
    });
    return Object.values(months).map(m => ({
      ...m,
      ganancia: m.ingresos - m.egresos,
      margen: m.ingresos > 0 ? ((m.ingresos - m.egresos) / m.ingresos * 100) : 0,
    }));
  }, [transactions]);

  // ── Datos para gráfico semanal (últimas 8 semanas) ────────────────────────
  const weeklyData = useMemo(() => {
    const weeks = {};
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - d.getDay() + 1); // lunes
      const key = startOfWeek.toISOString().slice(0,10);
      const label = `${startOfWeek.getDate()}/${startOfWeek.getMonth()+1}`;
      weeks[key] = { label, ingresos: 0, egresos: 0, ganancia: 0, startOfWeek };
    }
    const weekKeys = Object.keys(weeks).sort();
    transactions.forEach(t => {
      const d = parseDate(t.date);
      if (!d) return;
      // Encontrar a qué semana pertenece
      const txMonday = new Date(d);
      txMonday.setDate(d.getDate() - d.getDay() + 1);
      const key = txMonday.toISOString().slice(0,10);
      if (!weeks[key]) return;
      if (t.type === "venta")  weeks[key].ingresos += t.total || 0;
      if (t.type === "compra") weeks[key].egresos  += t.total || 0;
    });
    return weekKeys.map(k => ({
      ...weeks[k],
      ganancia: weeks[k].ingresos - weeks[k].egresos,
      margen: weeks[k].ingresos > 0 ? ((weeks[k].ingresos - weeks[k].egresos) / weeks[k].ingresos * 100) : 0,
    }));
  }, [transactions]);

  const chartData = chartPeriod === "monthly" ? monthlyData : weeklyData;

  // ── Totales globales ──────────────────────────────────────────────────────
  const filtered = useMemo(() =>
    transactions.filter(t => {
      const q = search.toLowerCase();
      return (typeF === "all" || t.type === typeF) &&
        (t.product?.toLowerCase().includes(q) || t.sku?.toLowerCase().includes(q) ||
         (t.supplier || "").toLowerCase().includes(q) || (t.client || "").toLowerCase().includes(q));
    }), [transactions, typeF, search]);

  const totalCompras = transactions.filter(t => t.type === "compra").reduce((s, t) => s + (t.total||0), 0);
  const totalVentas  = transactions.filter(t => t.type === "venta").reduce((s, t) => s + (t.total||0), 0);
  const gananciaBruta = totalVentas - totalCompras;
  const margenGlobal  = totalVentas > 0 ? (gananciaBruta / totalVentas * 100) : 0;

  // ── Exportar a Excel (.xlsx) lo que el usuario ve en pantalla ─────────────
  // Respeta la búsqueda y el filtro de tipo activos, y solo incluye columnas
  // de dinero si el usuario tiene permiso para ver métricas financieras.
  function handleExport() {
    const rows = filtered.map(t => {
      const base = {
        "Tipo":               t.type === "compra" ? "Compra" : "Venta",
        "Fecha":              t.date || "",
        "Producto":           t.product || "",
        "SKU":                t.sku || "",
        "Cantidad":           t.qty ?? "",
      };
      if (canViewFinance) {
        base["Precio Unitario (S/)"] = Number((t.unitCost ?? t.unitPrice ?? 0).toFixed(2));
        base["Total (S/)"]           = Number((t.total ?? 0).toFixed(2));
      }
      base["Proveedor / Cliente"] = t.supplier || t.client || "—";
      return base;
    });
    exportToExcel(rows, "Invenxio_Historial_Movimientos", "Movimientos");
  }

  // Genera (o re-imprime) el comprobante PDF de una transacción individual.
  // Solo disponible si el usuario tiene ver_metricas_financieras (necesitamos
  // montos) y si el Dueño completó sus Datos de Facturación.
  async function handleReprint(t) {
    if (!billing?.razonSocial) {
      alert("Para generar comprobantes, el Dueño debe completar los Datos de Facturación en el Panel → Facturación.");
      return;
    }
    try {
      const invoiceNumber = await getNextInvoiceNumber(companyId);
      const isVenta = t.type === "venta";
      // Una transacción puede tener múltiples ítems (carrito) o uno solo
      const items = t.items?.length
        ? t.items.map(i => ({ name: i.name, qty: i.qty, unitPrice: i.price ?? i.unitPrice, total: (i.price ?? i.unitPrice) * i.qty }))
        : [{ name: t.product || "—", qty: t.qty, unitPrice: t.unitCost ?? t.unitPrice ?? 0, total: t.total ?? 0 }];
      generateInvoicePDF({
        billing,
        docType:     isVenta ? "VENTA" : "PROVEEDOR",
        partyLabel:  isVenta ? "Cliente" : "Proveedor",
        partyName:   t.client || t.supplier || "—",
        items,
        total:       t.total ?? 0,
        invoiceNumber,
        note:        t.note || "",
      });
    } catch (err) {
      console.error("Error al generar comprobante:", err);
    }
  }

  // ── Tooltip personalizado ─────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 shadow-2xl text-xs">
        <p className="text-slate-400 font-medium mb-2">{label}</p>
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-slate-400">{entry.name}:</span>
            <span className="font-bold font-mono" style={{ color: entry.color }}>
              {entry.name === "Margen %" ? `${entry.value.toFixed(1)}%` : `S/ ${entry.value.toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">

      {/* ── KPI Cards ── */}
      {canViewFinance && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Total Ingresos",
              value: `S/ ${totalVentas.toFixed(2)}`,
              sub: `${transactions.filter(t=>t.type==="venta").length} ventas`,
              color: "text-emerald-400",
              bg: "bg-emerald-500/10 border-emerald-500/20",
              icon: <ArrowDownCircle size={18} />,
            },
            {
              label: "Total Egresos",
              value: `S/ ${totalCompras.toFixed(2)}`,
              sub: `${transactions.filter(t=>t.type==="compra").length} compras`,
              color: "text-blue-400",
              bg: "bg-blue-500/10 border-blue-500/20",
              icon: <ArrowUpCircle size={18} />,
            },
            {
              label: "Ganancia Bruta",
              value: `S/ ${gananciaBruta.toFixed(2)}`,
              sub: gananciaBruta >= 0 ? "Positivo ✓" : "Negativo ✗",
              color: gananciaBruta >= 0 ? "text-amber-400" : "text-red-400",
              bg: gananciaBruta >= 0 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20",
              icon: <TrendingUp size={18} />,
            },
            {
              label: "Margen Neto",
              value: `${margenGlobal.toFixed(1)}%`,
              sub: "sobre ventas",
              color: margenGlobal >= 20 ? "text-emerald-400" : margenGlobal >= 0 ? "text-amber-400" : "text-red-400",
              bg: margenGlobal >= 20 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-amber-500/10 border-amber-500/20",
              icon: <BarChart2 size={18} />,
            },
          ].map((s, i) => (
            <div key={i} className={`rounded-xl p-4 border ${s.bg} flex items-center gap-3`}>
              <span className={`${s.color} flex-shrink-0`}>{s.icon}</span>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 mb-0.5">{s.label}</p>
                <p className={`text-base font-bold font-mono ${s.color} truncate`}>{s.value}</p>
                <p className="text-xs text-slate-600">{s.sub}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Gráficos ── */}
      {canViewFinance && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp size={15} className="text-amber-400" />
              Análisis de Rentabilidad
            </h4>
            <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700">
              {[{ id: "monthly", label: "Mensual" }, { id: "weekly", label: "Semanal" }].map(p => (
                <button key={p.id} onClick={() => setChartPeriod(p.id)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${chartPeriod === p.id ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Gráfico 1: Ingresos vs Egresos vs Ganancia (barras) */}
          <div className="mb-6">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Ingresos · Egresos · Ganancia Bruta</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barGap={4} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `S/${v >= 1000 ? (v/1000).toFixed(1)+"k" : v}`} width={52} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8", paddingTop: 12 }} />
                <Bar dataKey="ingresos" name="Ingresos"  fill="#34d399" radius={[4,4,0,0]} />
                <Bar dataKey="egresos"  name="Egresos"   fill="#60a5fa" radius={[4,4,0,0]} />
                <Bar dataKey="ganancia" name="Ganancia"  fill="#fbbf24" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Gráfico 2: Margen % (área) */}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Margen Neto %</p>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="margenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#fbbf24" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `${v.toFixed(0)}%`} width={40} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#fbbf24", strokeWidth: 1, strokeDasharray: "4 4" }} />
                <Area type="monotone" dataKey="margen" name="Margen %"
                  stroke="#fbbf24" strokeWidth={2.5} fill="url(#margenGrad)" dot={{ fill: "#fbbf24", r: 3, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Filtros tabla ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-44">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
            className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
        </div>
        <div className="flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
          {[
            { v: "all",    l: "Todos",   show: true },
            { v: "compra", l: "Compras", show: canPurchase },
            { v: "venta",  l: "Ventas",  show: canSell },
          ].filter(f => f.show).map(f => (
            <button key={f.v} onClick={() => setTypeF(f.v)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${typeF === f.v ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
              {f.l}
            </button>
          ))}
        </div>
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          title="Descargar esta vista como archivo Excel"
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition-colors"
        >
          <FileSpreadsheet size={13} /> Descargar Excel
        </button>
      </div>

      {/* ── Tabla ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-slate-600 text-sm">Sin registros</div>
      ) : (
        <div className="rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800/80 border-b border-slate-700">
                  {(canViewFinance
                    ? ["Tipo","Fecha","Producto / SKU","Cant.","P.Unit.","Total","Proveedor/Cliente",""]
                    : ["Tipo","Fecha","Producto / SKU","Cant.","Proveedor/Cliente",""]
                  ).map((h,i,arr) => (
                    <th key={i} className={`py-2.5 px-3 text-slate-400 font-medium uppercase tracking-wider ${i === arr.length-1 ? "w-8" : i > 2 ? "text-right" : "text-left"} ${h==="Proveedor/Cliente" ? "hidden md:table-cell" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => (
                  <tr key={t.id} className={`border-b border-slate-700/30 hover:bg-slate-800/40 transition-colors ${i%2===0 ? "" : "bg-slate-800/10"}`}>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border ${t.type==="compra" ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"}`}>
                        {t.type==="compra" ? <ArrowUpCircle size={10}/> : <ArrowDownCircle size={10}/>}
                        {t.type==="compra" ? "Compra" : "Venta"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono whitespace-nowrap">{t.date}</td>
                    <td className="py-2.5 px-3">
                      <div className="text-slate-200 font-medium">{t.product}</div>
                      <div className="text-slate-500 font-mono">{t.sku}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-300">{t.qty}</td>
                    {canViewFinance && (
                      <>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-400">S/ {(t.unitCost||t.unitPrice||0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-400">S/ {(t.total||0).toFixed(2)}</td>
                      </>
                    )}
                    <td className="py-2.5 px-3 hidden md:table-cell text-slate-400">{t.supplier||t.client||"—"}</td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => handleReprint(t)}
                        title="Descargar comprobante PDF"
                        className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors"
                      >
                        <FileDown size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 1 — INVENTORY
// ══════════════════════════════════════════════════════════════════════════════
const InventoryModule = ({ companyId, userName, canCreate, canEdit, canDelete, canViewFinance }) => {
  const [products, loadingP] = useCollection(companyId, "products", "name");
  const [suppliers]          = useCollection(companyId, "suppliers", "name");

  const [search,          setSearch]          = useState("");
  const [statusFilter,    setStatusFilter]    = useState("Todos");
  const [selectedProductId, setSelectedProdId] = useState(null);
  const selectedProduct = useMemo(
    () => products.find(p => p.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );
  const [adjustQty,       setAdjustQty]       = useState("");
  const [adjustType,      setAdjustType]      = useState("add");
  const [adjusting,       setAdjusting]       = useState(false);

  // Nuevo producto
  const [showNewProd, setShowNewProd] = useState(false);
  const [newProd,     setNewProd]     = useState({ name: "", sku: "", price: "", cost: "", stock: "", minStock: "", unit: "und", supplier: "", barcode: "" });
  const [saving,      setSaving]      = useState(false);

  // Editar producto
  const [editProd,    setEditProd]    = useState(null);
  const [editForm,    setEditForm]    = useState({});
  const [editSaving,  setEditSaving]  = useState(false);

  const filtered = useMemo(() => products.filter(p => {
    const q = search.toLowerCase();
    return (p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.includes(q)) &&
      (statusFilter === "Todos" || p.status === statusFilter);
  }), [products, search, statusFilter]);

  const openEdit = (p, e) => {
    e.stopPropagation();
    setEditForm({
      name: p.name || "",
      sku: p.sku || "",
      price: p.price ?? "",
      cost: p.cost ?? "",
      stock: p.stock ?? "",
      minStock: p.minStock ?? "",
      unit: p.unit || "und",
      supplier: p.supplier || "",
      barcode: p.barcode || "",
    });
    setEditProd(p);
  };

  const handleAdjust = async () => {
    if (!adjustQty || Number(adjustQty) <= 0) return;
    setAdjusting(true);
    try {
      await adjustProductStock(companyId, selectedProduct.id, { type: adjustType, qty: Number(adjustQty), user: userName });
      setAdjustQty("");
    } catch (err) { console.error(err); }
    setAdjusting(false);
  };

  const handleAddProduct = async () => {
    if (!newProd.name || !newProd.sku) return;
    setSaving(true);
    try {
      const stock    = Number(newProd.stock) || 0;
      const minStock = Number(newProd.minStock) || 0;
      await addProduct(companyId, {
        ...newProd,
        price:    Number(newProd.price) || 0,
        cost:     Number(newProd.cost) || 0,
        stock,
        minStock,
        barcode:  newProd.barcode || generateBarcode(),
        status:   stock === 0 ? "Agotado" : stock <= minStock ? "Stock Bajo" : "En Stock",
        history:  [],
      });
      setShowNewProd(false);
      setNewProd({ name: "", sku: "", price: "", cost: "", stock: "", minStock: "", unit: "und", supplier: "", barcode: "" });
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const handleEditSave = async () => {
    if (!editProd || !editForm.name || !editForm.sku) return;
    setEditSaving(true);
    try {
      const price = parseFloat(editForm.price);
      const cost = parseFloat(editForm.cost);
      const stock = parseInt(editForm.stock, 10);
      const minStock = parseInt(editForm.minStock, 10);

      const finalStock = !isNaN(stock) ? stock : editProd.stock;
      const finalMinStock = !isNaN(minStock) ? minStock : editProd.minStock;
      const finalStatus = finalStock === 0 ? "Agotado" : finalStock <= finalMinStock ? "Stock Bajo" : "En Stock";

      await updateProduct(companyId, editProd.id, {
        name: editForm.name,
        sku: editForm.sku,
        price: !isNaN(price) ? price : editProd.price,
        cost: !isNaN(cost) ? cost : editProd.cost,
        stock: finalStock,
        minStock: finalMinStock,
        unit: editForm.unit,
        supplier: editForm.supplier,
        barcode: editForm.barcode || editProd.barcode || generateBarcode(),
        status: finalStatus,
      });
      setEditProd(null);
    } catch (err) {
      console.error(err);
    }
    setEditSaving(false);
  };

  const handleDeleteProduct = async () => {
    if (!selectedProduct) return;
    if (window.confirm(`¿Estás seguro de que quieres eliminar "${selectedProduct.name}"? Esta acción no se puede deshacer.`)) {
      try {
        await deleteProduct(companyId, selectedProduct.id);
        setSelectedProdId(null);
      } catch (err) {
        console.error("Error deleting product:", err);
        alert("Hubo un error al eliminar el producto.");
      }
    }
  };

  const stats = [
    { label: "Total Productos", value: products.length,                                      icon: <Box size={18} />,           color: "text-blue-400"    },
    { label: "En Stock",        value: products.filter(p => p.status === "En Stock").length,   icon: <CheckCircle size={18} />,   color: "text-emerald-400" },
    { label: "Stock Bajo",      value: products.filter(p => p.status === "Stock Bajo").length, icon: <AlertTriangle size={18} />, color: "text-amber-400"   },
    { label: "Agotados",        value: products.filter(p => p.status === "Agotado").length,    icon: <X size={18} />,             color: "text-red-400"     },
  ];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-center gap-3">
            <span className={`${s.color} bg-slate-700/50 p-2 rounded-lg`}>{s.icon}</span>
            <div>
              <div className="text-2xl font-bold text-white font-mono">{s.value}</div>
              <div className="text-xs text-slate-400">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, SKU o código de barras…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
        </div>
        <div className="flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
          {["Todos", ...STOCK_STATUS].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === s ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
              {s}
            </button>
          ))}
        </div>
        {canCreate && (
          <button onClick={() => setShowNewProd(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm rounded-lg transition-colors">
            <Plus size={15} /> Producto
          </button>
        )}
      </div>

      {/* Table */}
      {loadingP ? <Spinner /> : (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/80">
                  <th className="text-left py-3 px-4 text-xs text-slate-400 uppercase tracking-wider">SKU</th>
                  <th className="text-left py-3 px-4 text-xs text-slate-400 uppercase tracking-wider">Producto</th>
                  <th className="text-left py-3 px-4 text-xs text-slate-400 uppercase tracking-wider hidden md:table-cell">Proveedor</th>
                  <th className="text-right py-3 px-4 text-xs text-slate-400 uppercase tracking-wider">Stock</th>
                  <th className="text-right py-3 px-4 text-xs text-slate-400 uppercase tracking-wider hidden sm:table-cell">Precio</th>
                  <th className="text-center py-3 px-4 text-xs text-slate-400 uppercase tracking-wider">Estado</th>
                  <th className="py-3 px-4 text-xs text-slate-400 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => (
                  <tr key={p.id} onClick={() => setSelectedProdId(p.id)}
                    className={`border-b border-slate-700/30 cursor-pointer hover:bg-slate-700/40 transition-colors group ${idx % 2 === 0 ? "" : "bg-slate-800/20"}`}>
                    <td className="py-3 px-4 font-mono text-xs text-slate-400">{p.sku}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0"><Package size={13} className="text-slate-400" /></div>
                        <span className="text-slate-200 font-medium group-hover:text-amber-400 transition-colors">{p.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell text-xs text-slate-400">{p.supplier || "—"}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold">
                      <span className={p.stock === 0 ? "text-red-400" : p.stock <= p.minStock ? "text-amber-400" : "text-emerald-400"}>{p.stock}</span>
                      <span className="text-slate-600 text-xs"> /{p.unit}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-300 hidden sm:table-cell">S/ {(p.price || 0).toFixed(2)}</td>
                    <td className="py-3 px-4 text-center"><StatusBadge status={p.status} /></td>
                    <td className="py-3 px-4 text-center">
                      {canEdit && (
                        <button onClick={e => openEdit(p, e)}
                          className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors">
                          <Edit3 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-slate-500">No se encontraron productos</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Slide-over detalle ── */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedProdId(null)} />
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-700 flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div>
                <p className="text-xs font-mono text-amber-400">{selectedProduct.sku}</p>
                <h3 className="text-lg font-bold text-white">{selectedProduct.name}</h3>
              </div>
              <button onClick={() => setSelectedProdId(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Barcode */}
              {selectedProduct.barcode && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><ScanBarcode size={11} className="text-amber-400" />Código de Barras</p>
                  <BarcodeDisplay value={selectedProduct.barcode} />
                </div>
              )}
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Stock Actual",  value: selectedProduct.stock,                        mono: true,  color: selectedProduct.stock === 0 ? "text-red-400" : selectedProduct.stock <= selectedProduct.minStock ? "text-amber-400" : "text-emerald-400" },
                  { label: "Stock Mínimo",  value: selectedProduct.minStock,                     mono: true,  color: "text-slate-300" },
                  { label: "Precio Venta",  value: `S/ ${(selectedProduct.price || 0).toFixed(2)}`, mono: true, color: "text-slate-300" },
                  ...(canViewFinance ? [{ label: "Costo", value: `S/ ${(selectedProduct.cost || 0).toFixed(2)}`, mono: true, color: "text-slate-300" }] : []),
                  { label: "Unidad",        value: selectedProduct.unit || "und",                mono: false, color: "text-slate-300" },
                  { label: "Proveedor",     value: selectedProduct.supplier || "—",              mono: false, color: "text-slate-300" },
                ].map((item, i) => (
                  <div key={i} className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/50">
                    <p className="text-xs text-slate-400 mb-1">{item.label}</p>
                    <p className={`font-semibold ${item.mono ? "font-mono" : ""} ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50"><StatusBadge status={selectedProduct.status} /></div>

              {/* Ajustar Stock */}
              {canEdit && (
                <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
                  <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Zap size={14} className="text-amber-400" />Ajustar Stock</h4>
                  <div className="flex gap-2 mb-3">
                    {[{ t: "add", l: "Entrada", icon: <ArrowUpCircle size={13} />, cls: "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" }, { t: "remove", l: "Salida", icon: <ArrowDownCircle size={13} />, cls: "bg-red-500/20 border-red-500/50 text-red-400" }].map(b => (
                      <button key={b.t} onClick={() => setAdjustType(b.t)}
                        className={`flex-1 py-2 text-xs rounded-lg border flex items-center justify-center gap-1.5 transition-colors ${adjustType === b.t ? b.cls : "border-slate-600 text-slate-400 hover:border-slate-500"}`}>
                        {b.icon}{b.l}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="number" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} min="0" placeholder="Cantidad"
                      className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                    <button onClick={handleAdjust} disabled={adjusting}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 font-semibold text-sm rounded-lg transition-colors flex items-center gap-1">
                      {adjusting && <Loader2 size={13} className="animate-spin" />}Aplicar
                    </button>
                  </div>
                </div>
              )}

              {/* Historial */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><History size={14} className="text-amber-400" />Historial</h4>
                <div className="space-y-2">
                  {(selectedProduct.history || []).map((h, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/40 rounded-lg border border-slate-700/30">
                      <div className={`p-1.5 rounded-lg ${h.action.includes("Compra") || h.action.includes("+") ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                        {h.action.includes("Compra") || h.action.includes("+") ? <ArrowUpCircle size={13} /> : <ArrowDownCircle size={13} />}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-slate-300">{h.action} <span className="font-mono text-amber-400">{h.qty}</span></p>
                        <p className="text-xs text-slate-500">{h.date} · {h.user}</p>
                      </div>
                    </div>
                  ))}
                  {!(selectedProduct.history?.length) && <p className="text-xs text-slate-600 text-center py-4">Sin historial</p>}
                </div>
              </div>

              {/* Zona de Peligro */}
              {canDelete && (
                <div className="bg-red-500/10 rounded-xl border border-red-500/20 p-4 mt-5">
                  <h4 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2"><AlertTriangle size={14} />Zona de Peligro</h4>
                  <button
                    onClick={handleDeleteProduct}
                    className="w-full text-center py-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 text-xs font-bold rounded-lg transition-colors"
                  >
                    Eliminar Producto Permanentemente
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo Producto ── */}
      {showNewProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNewProd(false)} />
          <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h3 className="font-bold text-white flex items-center gap-2"><Plus size={16} className="text-amber-400" />Nuevo Producto</h3>
              <button onClick={() => setShowNewProd(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Nombre *",       key: "name",     full: true,  placeholder: "Ej: Laptop Dell XPS", type: "text" },
                  { label: "SKU *",          key: "sku",                   placeholder: "Ej: EL-001",          type: "text" },
                  { label: "Precio venta",   key: "price",                 placeholder: "0.00",                type: "number" },
                  ...(canViewFinance ? [{ label: "Costo", key: "cost", placeholder: "0.00", type: "number" }] : []),
                  { label: "Stock inicial",  key: "stock",                 placeholder: "0",                   type: "number" },
                  { label: "Stock mínimo",   key: "minStock",              placeholder: "0",                   type: "number" },
                  { label: "Unidad",         key: "unit",                  placeholder: "und",                 type: "text" },
                ].map(f => (
                  <div key={f.key} className={f.full ? "col-span-2" : ""}>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">{f.label}</label>
                    <input type={f.type} value={newProd[f.key]} onChange={e => setNewProd(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                ))}
                {/* Proveedor — select del listado */}
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Proveedor</label>
                  <select value={newProd.supplier} onChange={e => setNewProd(p => ({ ...p, supplier: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                    <option value="">Sin proveedor</option>
                    {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                {/* Código de barras */}
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block flex items-center gap-1"><ScanBarcode size={11} />Código de Barras</label>
                  <div className="flex gap-2">
                    <input value={newProd.barcode} onChange={e => setNewProd(p => ({ ...p, barcode: e.target.value }))} placeholder="Se genera automáticamente"
                      className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                    <button onClick={() => setNewProd(p => ({ ...p, barcode: generateBarcode() }))}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap">
                      Generar
                    </button>
                  </div>
                  {newProd.barcode && <div className="mt-2"><BarcodeDisplay value={newProd.barcode} height={50} /></div>}
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowNewProd(false)} className="flex-1 py-2.5 border border-slate-600 text-slate-400 rounded-xl text-sm hover:border-slate-500 transition-colors">Cancelar</button>
                <button onClick={handleAddProduct} disabled={!newProd.name || !newProd.sku || saving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin" />}Guardar Producto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Editar Producto ── */}
      {editProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditProd(null)} />
          <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2"><Edit3 size={16} className="text-amber-400" />Editar Producto</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{editProd.sku}</p>
              </div>
              <button onClick={() => setEditProd(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Nombre *",      key: "name",     full: true, type: "text" },
                  { label: "SKU *",         key: "sku",                  type: "text" },
                  { label: "Precio venta",  key: "price",                type: "number" },
                  ...(canViewFinance ? [{ label: "Costo", key: "cost", type: "number" }] : []),
                  { label: "Stock",         key: "stock",                type: "number" },
                  { label: "Stock mínimo",  key: "minStock",             type: "number" },
                  { label: "Unidad",        key: "unit",                 type: "text" },
                ].map(f => (
                  <div key={f.key} className={f.full ? "col-span-2" : ""}>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">{f.label}</label>
                    <input type={f.type} value={editForm[f.key]} onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                ))}
                {/* Proveedor como SELECT con nombre visible */}
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Proveedor</label>
                  <select value={editForm.supplier} onChange={e => setEditForm(p => ({ ...p, supplier: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                    <option value="">Sin proveedor</option>
                    {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                {/* Código de barras editable */}
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block flex items-center gap-1"><ScanBarcode size={11} />Código de Barras</label>
                  <div className="flex gap-2">
                    <input value={editForm.barcode} onChange={e => setEditForm(p => ({ ...p, barcode: e.target.value }))}
                      className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono focus:outline-none focus:border-amber-500 transition-colors" />
                    <button onClick={() => setEditForm(p => ({ ...p, barcode: generateBarcode() }))}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-xs rounded-lg transition-colors">
                      Generar
                    </button>
                  </div>
                  {editForm.barcode && <div className="mt-2"><BarcodeDisplay value={editForm.barcode} height={50} /></div>}
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setEditProd(null)} className="flex-1 py-2.5 border border-slate-600 text-slate-400 rounded-xl text-sm hover:border-slate-500 transition-colors">Cancelar</button>
                <button onClick={handleEditSave} disabled={!editForm.name || !editForm.sku || editSaving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  {editSaving && <Loader2 size={14} className="animate-spin" />}<Save size={14} />Guardar Cambios
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 2 — MOVEMENTS
// ══════════════════════════════════════════════════════════════════════════════
const MovementsModule = ({ companyId, userName, canPurchase, canSell, canViewFinance, billing }) => {
  const [products,     loadingP] = useCollection(companyId, "products",     "name");
  const [suppliers,    loadingS] = useCollection(companyId, "suppliers",    "name");
  const [transactions, loadingT] = useCollection(companyId, "transactions", "createdAt");

  const innerTabs = [
    canPurchase && { id: "purchase", label: "📦 Registrar Compra" },
    canSell     && { id: "sale",     label: "🛒 Registrar Venta" },
    (canPurchase || canSell) && { id: "history", label: "📋 Historial" },
  ].filter(Boolean);
  const [mvTab, setMvTab] = useState(innerTabs[0]?.id || "history");
  useEffect(() => {
    if (innerTabs.length && !innerTabs.some(t => t.id === mvTab)) setMvTab(innerTabs[0].id);
  }, [canPurchase, canSell]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PURCHASE ──────────────────────────────────────────────────────────────
  const [pSupplier,    setPSupplier]   = useState("");
  const [pSupplierId,  setPSupplierId] = useState("");
  const [pProduct,     setPProduct]    = useState(null);
  const [pSearch,      setPSearch]     = useState("");
  const [pQty,         setPQty]        = useState("");
  const [pCost,        setPCost]       = useState("");
  const [pNote,        setPNote]       = useState("");
  const [pSaving,      setPSaving]     = useState(false);
  const [pSuccess,     setPSuccess]    = useState(false);
  const pFiltered = pSearch && !pProduct ? products.filter(p => p.name?.toLowerCase().includes(pSearch.toLowerCase())) : [];

  const handlePurchase = async () => {
    if (!pSupplier || !pProduct || !pQty || !pCost) return;
    setPSaving(true);
    try {
      await recordPurchase(companyId, {
        supplierId: pSupplierId, supplierName: pSupplier,
        productId: pProduct.id, productName: pProduct.name, sku: pProduct.sku,
        qty: Number(pQty), unitCost: Number(pCost), total: Number(pQty) * Number(pCost),
        note: pNote, userName,
      });
      setPSuccess(true);
      setTimeout(() => { setPSuccess(false); setPProduct(null); setPSearch(""); setPQty(""); setPCost(""); setPSupplier(""); setPSupplierId(""); setPNote(""); }, 2500);
    } catch (err) { console.error(err); }
    setPSaving(false);
  };

  // ── SALE / POS ─────────────────────────────────────────────────────────────
  const [sSearch,      setSSearch]      = useState("");
  const [cart,         setCart]         = useState([]);
  const [sSaving,      setSSaving]      = useState(false);
  const [sSuccess,     setSSuccess]     = useState(false);
  const [clientName,   setClientName]   = useState("");
  const [invoiceMsg,   setInvoiceMsg]   = useState("");
  const [showScanner,  setShowScanner]  = useState(false);
  const [scanFeedback, setScanFeedback] = useState(""); // mensaje tras escanear

  const recentProducts = useMemo(() => products.filter(p => p.stock > 0).slice(0, 6), [products]);
  const sFiltered = sSearch ? products.filter(p =>
    (p.name?.toLowerCase().includes(sSearch.toLowerCase()) || p.barcode?.includes(sSearch) || p.sku?.toLowerCase().includes(sSearch.toLowerCase())) && p.stock > 0
  ) : [];
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const addToCart = useCallback((product) => {
    setSSearch("");
    setCart(prev => {
      const ex = prev.find(i => i.id === product.id);
      return ex
        ? prev.map(i => i.id === product.id ? { ...i, qty: Math.min(i.qty + 1, product.stock) } : i)
        : [...prev, { ...product, qty: 1 }];
    });
  }, []);

  const handleBarcodeScan = useCallback((code) => {
    setShowScanner(false);
    const found = products.find(p => p.barcode === code || p.sku === code);
    if (found) {
      if (found.stock <= 0) {
        setScanFeedback(`⚠️ "${found.name}" está agotado`);
      } else {
        addToCart(found);
        setScanFeedback(`✅ "${found.name}" agregado al carrito`);
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
    try {
      await recordSale(companyId, { cartItems: cart, userName });
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
            items: cart.map(i => ({ name: i.name, qty: i.qty, unitPrice: i.price, total: i.price * i.qty })),
            total: cartTotal,
          });
        } catch (invErr) {
          console.error("Error generando comprobante:", invErr);
          setInvoiceMsg("Venta guardada, pero hubo un error al generar el comprobante PDF.");
        }
      }

      setTimeout(() => { setSSuccess(false); setCart([]); setClientName(""); setInvoiceMsg(""); }, 3500);
    } catch (err) { console.error(err); }
    setSSaving(false);
  };

  return (
    <div className="space-y-5">
      {/* Tabs internos */}
      <div className="flex flex-wrap gap-1 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50 w-fit">
        {innerTabs.map(t => (
          <button key={t.id} onClick={() => setMvTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mvTab === t.id ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PURCHASE ── */}
      {mvTab === "purchase" && (
        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Truck size={16} className="text-amber-400" />Nueva Orden de Compra</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Proveedor *</label>
                <select value={pSupplier} onChange={e => {
                  const sup = suppliers.find(s => s.name === e.target.value);
                  setPSupplier(e.target.value); setPSupplierId(sup?.id || "");
                }} className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                  <option value="">Seleccionar proveedor…</option>
                  {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Producto *</label>
                <div className="relative">
                  <input value={pSearch} onChange={e => { setPSearch(e.target.value); setPProduct(null); }} placeholder="Buscar producto…"
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                  {pProduct && (
                    <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                      <Package size={13} className="text-amber-400" />
                      <span className="text-sm text-amber-400 font-medium">{pProduct.name}</span>
                      <button onClick={() => { setPProduct(null); setPSearch(""); }} className="ml-auto"><X size={13} className="text-slate-500" /></button>
                    </div>
                  )}
                  {pFiltered.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                      {pFiltered.slice(0, 5).map(p => (
                        <button key={p.id} onClick={() => { setPProduct(p); setPSearch(p.name); }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-700 flex justify-between items-center">
                          <span className="text-sm text-slate-200">{p.name}</span>
                          <span className="text-xs font-mono text-amber-400">Stock: {p.stock}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Cantidad *</label>
                  <input type="number" value={pQty} onChange={e => setPQty(e.target.value)} min="1" placeholder="0"
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Costo Unit. *</label>
                  <input type="number" value={pCost} onChange={e => setPCost(e.target.value)} min="0" placeholder="0.00"
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Nota</label>
                <input value={pNote} onChange={e => setPNote(e.target.value)} placeholder="Observaciones…"
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
              </div>
            </div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><FileText size={16} className="text-amber-400" />Resumen</h3>
            <div className="flex-1 space-y-3">
              {[{ l: "Proveedor", v: pSupplier || "—" }, { l: "Producto", v: pProduct?.name || "—" }, { l: "Cantidad", v: pQty ? `${pQty} und` : "—" }, { l: "Costo Unit.", v: pCost ? `S/ ${Number(pCost).toFixed(2)}` : "—" }].map((r, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-slate-700/40">
                  <span className="text-xs text-slate-400">{r.l}</span>
                  <span className="text-sm text-slate-200 font-medium">{r.v}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-3 mt-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3">
                <span className="text-sm font-semibold text-amber-400">Total</span>
                <span className="text-xl font-bold font-mono text-amber-400">S/ {(Number(pQty || 0) * Number(pCost || 0)).toFixed(2)}</span>
              </div>
            </div>
            {pSuccess ? (
              <div className="mt-4 py-3 px-4 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-center text-emerald-400 font-semibold flex items-center justify-center gap-2"><CheckCircle size={16} />¡Guardado en Firebase!</div>
            ) : (
              <button onClick={handlePurchase} disabled={!pSupplier || !pProduct || !pQty || !pCost || pSaving}
                className="mt-4 w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                {pSaving && <Loader2 size={16} className="animate-spin" />}<ArrowUpCircle size={16} />Registrar Compra
              </button>
            )}
          </div>
        </div>
      )}

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
                    <button key={p.id} onClick={() => addToCart(p)}
                      className="w-full text-left p-3 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 hover:border-amber-500/40 rounded-xl transition-all flex items-center gap-3 group">
                      <div className="w-9 h-9 bg-slate-600 rounded-lg flex items-center justify-center flex-shrink-0"><Package size={15} className="text-slate-400" /></div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-200 group-hover:text-amber-400 transition-colors">{p.name}</p>
                        <p className="text-xs text-slate-500 font-mono">{p.sku} · Stock: {p.stock}</p>
                      </div>
                      <div className="text-right mr-2">
                        <p className="text-sm font-bold font-mono text-amber-400">S/ {(p.price || 0).toFixed(2)}</p>
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
                        <button key={p.id} onClick={() => addToCart(p)}
                          className="p-3 bg-slate-700/40 hover:bg-slate-700 border border-slate-600/40 hover:border-amber-500/40 rounded-xl transition-all text-left group">
                          <div className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center mb-2">
                            <Package size={14} className="text-slate-400 group-hover:text-amber-400 transition-colors" />
                          </div>
                          <p className="text-xs font-semibold text-slate-200 leading-tight line-clamp-2 group-hover:text-amber-400 transition-colors">{p.name}</p>
                          <p className="text-xs font-bold font-mono text-amber-400 mt-1.5">S/ {(p.price || 0).toFixed(2)}</p>
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
              {cart.map(item => (
                <div key={item.id} className="flex items-center gap-2 p-2.5 bg-slate-700/50 rounded-lg border border-slate-600/40">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500 font-mono">S/ {(item.price || 0).toFixed(2)} c/u</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setCart(prev => prev.map(i => i.id === item.id ? { ...i, qty: Math.max(1, i.qty - 1) } : i))} className="w-6 h-6 bg-slate-600 hover:bg-slate-500 rounded flex items-center justify-center transition-colors"><Minus size={10} className="text-slate-300" /></button>
                    <span className="text-sm font-mono font-bold text-white w-5 text-center">{item.qty}</span>
                    <button onClick={() => setCart(prev => prev.map(i => i.id === item.id && i.qty < i.stock ? { ...i, qty: i.qty + 1 } : i))} className="w-6 h-6 bg-slate-600 hover:bg-slate-500 rounded flex items-center justify-center transition-colors"><Plus size={10} className="text-slate-300" /></button>
                    <button onClick={() => setCart(prev => prev.filter(i => i.id !== item.id))} className="w-6 h-6 text-red-500 hover:bg-red-500/20 rounded flex items-center justify-center transition-colors ml-1"><Trash2 size={10} /></button>
                  </div>
                  <span className="text-xs font-mono text-amber-400 w-16 text-right flex-shrink-0">S/ {((item.price || 0) * item.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-700">
              <div className="mb-3">
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Cliente (opcional)</label>
                <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Cliente varios"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
              </div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-slate-400 text-sm">Total</span>
                <span className="text-2xl font-bold font-mono text-amber-400">S/ {cartTotal.toFixed(2)}</span>
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
                <button onClick={handleSale} disabled={cart.length === 0 || sSaving}
                  className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                  {sSaving && <Loader2 size={16} className="animate-spin" />}<Zap size={16} />Confirmar Venta y Emitir Comprobante
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY ── */}
      {mvTab === "history" && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-base font-bold text-white mb-5 flex items-center gap-2">
            <BookOpen size={16} className="text-amber-400" />Historial de Transacciones
            <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full font-mono">{transactions.length} registros</span>
          </h3>
          <TransactionHistory transactions={transactions} loading={loadingT} canViewFinance={canViewFinance} canPurchase={canPurchase} canSell={canSell} billing={billing} companyId={companyId} />
        </div>
      )}

      {/* Barcode Scanner Modal */}
      {showScanner && <BarcodeScanner onDetected={handleBarcodeScan} onClose={() => setShowScanner(false)} />}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 3 — SUPPLIERS
// ══════════════════════════════════════════════════════════════════════════════
const SuppliersModule = ({ companyId, userName, canManageSuppliers, canDelete, canViewFinance, billing }) => {
  const [suppliers,     loadingSup] = useCollection(companyId, "suppliers",     "name");
  const [supplierSales, loadingSS]  = useCollection(companyId, "supplierSales", "createdAt");
  const [products]                  = useCollection(companyId, "products",      "name");

  const [supTab,      setSupTab]      = useState("list");
  const [showModal,   setShowModal]   = useState(false);
  const [editSupplier, setEditSupplier] = useState(null); // null = nuevo, objeto = editar
  const [selSupplier, setSelSupplier] = useState(null);
  const EMPTY_FORM = { name: "", ruc: "", contact: "", email: "", phone: "", address: "", reliability: 3, status: "Activo" };
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [saving,      setSaving]      = useState(false);

  const [ssForm,    setSsForm]    = useState({ supplier: "", product: null, productSearch: "", qty: "", unitPrice: "", note: "", status: "Pendiente" });
  const [ssSaving,  setSsSaving]  = useState(false);
  const [ssSuccess, setSsSuccess] = useState(false);
  const ssFiltered = ssForm.productSearch && !ssForm.product ? products.filter(p => p.name?.toLowerCase().includes(ssForm.productSearch.toLowerCase()) && p.stock > 0) : [];

  const [saveError, setSaveError] = useState("");

  const handleSaveSupplier = async () => {
    if (!form.name || !form.contact) return;
    setSaveError("");
    setSaving(true);
    try {
      if (editSupplier) {
        if (!editSupplier.id) throw new Error("ID del proveedor no encontrado");
        await updateSupplier(companyId, editSupplier.id, {
          name:        form.name,
          ruc:         form.ruc,
          contact:     form.contact,
          email:       form.email,
          phone:       form.phone,
          address:     form.address,
          reliability: Number(form.reliability),
          status:      form.status,
        });
      } else {
        await addSupplier(companyId, {
          name:        form.name,
          ruc:         form.ruc,
          contact:     form.contact,
          email:       form.email,
          phone:       form.phone,
          address:     form.address,
          reliability: Number(form.reliability),
          status:      "Activo",
        });
      }
      setForm(EMPTY_FORM);
      setEditSupplier(null);
      setShowModal(false);
    } catch (err) {
      console.error("Error guardando proveedor:", err);
      setSaveError(err?.message || "Error al guardar. Revisa la consola.");
    }
    setSaving(false);
  };

  const handleToggleSupplierStatus = async (e, s) => {
    e.stopPropagation();
    const next = s.status === "Activo" ? "Inactivo" : "Activo";
    try { await updateSupplier(companyId, s.id, { status: next }); }
    catch (err) { console.error("Error cambiando estado:", err); }
  };

  const handleDeleteSupplier = async (supplier) => {
    if (!supplier) return;
    if (window.confirm(`¿Estás seguro de que quieres eliminar al proveedor "${supplier.name}"? Esta acción no se puede deshacer.`)) {
      try {
        await deleteSupplier(companyId, supplier.id);
      } catch (err) {
        console.error("Error deleting supplier:", err);
        alert("Hubo un error al eliminar el proveedor.");
      }
    }
  };

  const handleSupplierSale = async () => {
    if (!ssForm.supplier || !ssForm.product || !ssForm.qty || !ssForm.unitPrice) return;
    setSsSaving(true);
    try {
      await addSupplierSale(companyId, {
        supplier: ssForm.supplier, product: ssForm.product.name,
        qty: Number(ssForm.qty), unitPrice: Number(ssForm.unitPrice),
        total: Number(ssForm.qty) * Number(ssForm.unitPrice),
        status: ssForm.status, note: ssForm.note,
      });
      setSsSuccess(true);
      setTimeout(() => { setSsSuccess(false); setSsForm({ supplier: "", product: null, productSearch: "", qty: "", unitPrice: "", note: "", status: "Pendiente" }); }, 2500);
    } catch (err) { console.error(err); }
    setSsSaving(false);
  };

  const totalSales   = supplierSales.reduce((s, r) => s + r.total, 0);
  const pendingCnt   = supplierSales.filter(r => r.status === "Pendiente").length;
  const deliveredCnt = supplierSales.filter(r => r.status === "Entregado").length;
  const cancelledCnt = supplierSales.filter(r => r.status === "Cancelado").length;

  // ── Marcar como Entregado + emitir comprobante de compra en PDF ───────────
  const [invoiceMsgSupplier, setInvoiceMsgSupplier] = useState("");
  async function handleMarkDelivered(sale) {
    setInvoiceMsgSupplier("");
    try {
      await updateSupplierSaleStatus(companyId, sale.id, "Entregado");

      if (!billing?.razonSocial) {
        setInvoiceMsgSupplier("Venta marcada como entregada, pero no se generó comprobante: completa tus Datos de Facturación en el Panel.");
        setTimeout(() => setInvoiceMsgSupplier(""), 4500);
        return;
      }
      const invoiceNumber = await getNextInvoiceNumber(companyId);
      generateInvoicePDF({
        billing,
        docType: "PROVEEDOR",
        partyLabel: "Proveedor",
        partyName: sale.supplier || "—",
        items: [{ name: sale.product, qty: sale.qty, unitPrice: sale.unitPrice, total: sale.total }],
        total: sale.total,
        note: sale.note || "",
      });
    } catch (err) {
      console.error("Error al marcar entregado / generar comprobante:", err);
      setInvoiceMsgSupplier("Ocurrió un error al generar el comprobante.");
      setTimeout(() => setInvoiceMsgSupplier(""), 4500);
    }
  }

  // ── Exportar ventas a proveedores a Excel (.xlsx) ──────────────────────────
  function handleExportSupplierSales() {
    const rows = supplierSales.map(sale => {
      const base = {
        "Proveedor": sale.supplier || "—",
        "Producto":  sale.product || "",
        "Cantidad":  sale.qty ?? "",
        "Fecha":     sale.date || "",
        "Estado":    sale.status || "",
      };
      if (canViewFinance) {
        base["Precio Unitario (S/)"] = Number((sale.unitPrice ?? 0).toFixed(2));
        base["Total (S/)"]           = Number((sale.total ?? 0).toFixed(2));
      }
      return base;
    });
    exportToExcel(rows, "Invenxio_Ventas_Proveedores", "Ventas a Proveedores");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Proveedores</h2>
          <p className="text-sm text-slate-400">{suppliers.length} registrados</p>
        </div>
        {canManageSuppliers && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm rounded-xl transition-colors shadow-lg shadow-amber-500/20">
            <Plus size={16} /> Nuevo Proveedor
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50 w-fit">
        {[{ id: "list", label: "📋 Proveedores" }, { id: "sales", label: "📤 Ventas a Proveedores" }].map(t => (
          <button key={t.id} onClick={() => setSupTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${supTab === t.id ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {supTab === "list" && (
        loadingSup ? <Spinner /> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.map(s => (
              <div key={s.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col gap-4 hover:border-amber-500/30 transition-colors group">
                <div className="flex items-start justify-between">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 flex items-center justify-center">
                    <Truck size={20} className="text-amber-400" />
                  </div>
                  {canManageSuppliers ? (
                    <button
                      onClick={e => handleToggleSupplierStatus(e, s)}
                      title={s.status === "Activo" ? "Click para desactivar" : "Click para activar"}
                      className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                        s.status === "Activo"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
                          : "bg-slate-700/50 border-slate-600 text-slate-400 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400"
                      }`}
                    >
                      {s.status === "Activo" ? "● Activo" : "○ Inactivo"}
                    </button>
                  ) : (
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border ${s.status === "Activo" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-700/50 border-slate-600 text-slate-400"}`}>
                      {s.status === "Activo" ? "● Activo" : "○ Inactivo"}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-white group-hover:text-amber-400 transition-colors">{s.name}</h3>
                </div>
                <div className="space-y-2 text-xs text-slate-400">
                  <div className="flex items-center gap-2"><Users size={11} /><span>{s.contact}</span></div>
                  <div className="flex items-center gap-2"><Mail size={11} /><span className="truncate">{s.email}</span></div>
                  <div className="flex items-center gap-2"><Phone size={11} /><span>{s.phone}</span></div>
                </div>
                <div className="flex items-center justify-between">
                  <div><p className="text-xs text-slate-500 mb-1">Confiabilidad</p><Stars rating={s.reliability} /></div>
                  <div className="text-right"><p className="text-xs text-slate-500">Órdenes</p><p className="text-sm font-mono font-bold text-slate-300">{s.totalOrders || 0}</p></div>
                </div>
                <div className="flex gap-2 mt-auto pt-2 border-t border-slate-700/50">
                  <button onClick={() => setSelSupplier(s)}
                    className="flex-1 py-2 text-xs font-semibold rounded-lg border border-slate-600 text-slate-400 hover:border-amber-500/50 hover:text-amber-400 transition-colors flex items-center justify-center gap-1">
                    <History size={12} />Ver Historial
                  </button>
                  {canManageSuppliers && (
                    <button onClick={e => {
                      e.stopPropagation();
                      setSaveError("");
                      setEditSupplier(s);
                      setForm({ name: s.name||"", ruc: s.ruc||"", contact: s.contact||"", email: s.email||"", phone: s.phone||"", address: s.address||"", reliability: s.reliability||3, status: s.status||"Activo" });
                      setShowModal(true);
                    }}
                      className="py-2 px-3 text-xs font-semibold rounded-lg border border-transparent text-slate-400 hover:border-amber-500/30 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                      title="Editar proveedor">
                      <Edit3 size={12} />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={e => { e.stopPropagation(); handleDeleteSupplier(s); }}
                      className="py-2 px-3 text-xs font-semibold rounded-lg border border-transparent text-slate-500 hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Eliminar Proveedor">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {suppliers.length === 0 && <div className="col-span-3 text-center py-16 text-slate-600">Sin proveedores registrados</div>}
          </div>
        )
      )}

      {supTab === "sales" && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Ventas", value: supplierSales.length,          color: "text-blue-400",  icon: <Receipt size={16} /> },
              ...(canViewFinance ? [{ label: "Monto Total", value: `S/ ${totalSales.toFixed(2)}`, color: "text-amber-400", icon: <TrendingUp size={16} /> }] : []),
              { label: "Pendientes",   value: pendingCnt,                    color: "text-amber-400", icon: <Clock size={16} /> },
            ].map((s, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-center gap-3">
                <span className={`${s.color} bg-slate-700/50 p-2 rounded-lg`}>{s.icon}</span>
                <div>
                  <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-slate-400">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {canManageSuppliers && (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Send size={16} className="text-amber-400" />Registrar Venta a Proveedor</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Proveedor *</label>
                  <select value={ssForm.supplier} onChange={e => setSsForm(p => ({ ...p, supplier: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                    <option value="">Seleccionar…</option>
                    {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Producto *</label>
                  <div className="relative">
                    <input value={ssForm.productSearch} onChange={e => setSsForm(p => ({ ...p, productSearch: e.target.value, product: null }))} placeholder="Buscar…"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                    {ssForm.product && (
                      <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                        <Package size={13} className="text-amber-400" /><span className="text-sm text-amber-400 font-medium">{ssForm.product.name}</span>
                        <button onClick={() => setSsForm(p => ({ ...p, product: null, productSearch: "" }))} className="ml-auto"><X size={13} className="text-slate-500" /></button>
                      </div>
                    )}
                    {ssFiltered.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                        {ssFiltered.slice(0, 5).map(p => (
                          <button key={p.id} onClick={() => setSsForm(prev => ({ ...prev, product: p, productSearch: p.name, unitPrice: String(p.price || "") }))}
                            className="w-full text-left px-3 py-2 hover:bg-slate-700 flex justify-between items-center">
                            <span className="text-sm text-slate-200">{p.name}</span>
                            <span className="text-xs font-mono text-amber-400">S/ {p.price}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Cantidad *</label>
                    <input type="number" value={ssForm.qty} onChange={e => setSsForm(p => ({ ...p, qty: e.target.value }))} min="1" placeholder="0"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Precio Unit. *</label>
                    <input type="number" value={ssForm.unitPrice} onChange={e => setSsForm(p => ({ ...p, unitPrice: e.target.value }))} min="0" placeholder="0.00"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Estado</label>
                    <select value={ssForm.status} onChange={e => setSsForm(p => ({ ...p, status: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                      {["Pendiente", "Entregado", "Cancelado"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Total</label>
                    <div className="px-3 py-2.5 bg-slate-700/50 border border-amber-500/30 rounded-lg text-sm font-mono font-bold text-amber-400">
                      S/ {(Number(ssForm.qty || 0) * Number(ssForm.unitPrice || 0)).toFixed(2)}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Nota</label>
                  <input value={ssForm.note} onChange={e => setSsForm(p => ({ ...p, note: e.target.value }))} placeholder="Observaciones…"
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                </div>
                {ssSuccess ? (
                  <div className="py-3 px-4 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-center text-emerald-400 font-semibold flex items-center justify-center gap-2"><CheckCircle size={16} />¡Guardado!</div>
                ) : (
                  <button onClick={handleSupplierSale} disabled={!ssForm.supplier || !ssForm.product || !ssForm.qty || !ssForm.unitPrice || ssSaving}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                    {ssSaving && <Loader2 size={16} className="animate-spin" />}<Send size={16} />Registrar Venta
                  </button>
                )}
              </div>
            </div>
            )}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <Receipt size={16} className="text-amber-400" />Ventas Registradas
                <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full font-mono">{supplierSales.length}</span>
              </h3>
              <button
                onClick={handleExportSupplierSales}
                disabled={supplierSales.length === 0}
                title="Descargar como archivo Excel"
                className="flex items-center justify-center gap-1.5 mb-4 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition-colors"
              >
                <FileSpreadsheet size={13} /> Descargar Excel
              </button>
              {invoiceMsgSupplier && (
                <div className="mb-4 py-2 px-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{invoiceMsgSupplier}
                </div>
              )}
              <div className="flex gap-2 mb-4">
                <div className="flex-1 bg-slate-700/40 border border-emerald-500/20 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Entregados</p>
                  <p className="text-base font-bold font-mono text-emerald-400">{deliveredCnt}</p>
                </div>
                <div className="flex-1 bg-slate-700/40 border border-amber-500/20 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Pendientes</p>
                  <p className="text-base font-bold font-mono text-amber-400">{pendingCnt}</p>
                </div>
                <div className="flex-1 bg-slate-700/40 border border-red-500/20 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Cancelados</p>
                  <p className="text-base font-bold font-mono text-red-400">{cancelledCnt}</p>
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto max-h-80">
                {loadingSS ? <Spinner /> : supplierSales.length === 0 ? (
                  <div className="text-center py-10 text-slate-600 text-sm">Sin ventas registradas</div>
                ) : supplierSales.map(sale => (
                  <div key={sale.id} className="p-3 bg-slate-700/40 border border-slate-700/50 rounded-xl hover:border-amber-500/20 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-200 truncate">{sale.product}</p>
                        <p className="text-xs text-slate-400">{sale.supplier}</p>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <StatusBadge status={sale.status} />
                        {canManageSuppliers && sale.status === "Pendiente" && (
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleMarkDelivered(sale)}
                              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Marcar entregado</button>
                            <span className="text-slate-600">·</span>
                            <button onClick={() => updateSupplierSaleStatus(companyId, sale.id, "Cancelado")}
                              className="text-xs text-red-400 hover:text-red-300 transition-colors">Cancelar</button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3 text-slate-500">
                        <span className="flex items-center gap-1"><Calendar size={10} />{sale.date}</span>
                        <span className="flex items-center gap-1"><Tag size={10} />x{sale.qty}{canViewFinance ? ` · S/${sale.unitPrice}` : ""}</span>
                      </div>
                      {canViewFinance && <span className="font-bold font-mono text-amber-400">S/ {(sale.total || 0).toFixed(2)}</span>}
                    </div>
                    {sale.note && <p className="text-xs text-slate-500 mt-1 italic">{sale.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Supplier detail modal */}
      {selSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelSupplier(null)} />
          <div className="relative z-10 w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div><h3 className="font-bold text-white">{selSupplier.name}</h3><p className="text-xs text-slate-400">Perfil del proveedor</p></div>
              <button onClick={() => setSelSupplier(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Órdenes", value: selSupplier.totalOrders || 0 },
                  ...(canViewFinance ? [{ label: "Total Gastado", value: `S/ ${(selSupplier.totalSpent || 0).toLocaleString()}` }] : []),
                  { label: "Última Orden", value: selSupplier.lastOrder || "—" },
                ].map((s, i) => (
                  <div key={i} className="bg-slate-800 rounded-xl p-3 text-center border border-slate-700/50">
                    <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                    <p className="text-sm font-bold font-mono text-amber-400">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {[{ icon: <Users size={12} />, value: selSupplier.contact }, { icon: <Mail size={12} />, value: selSupplier.email }, { icon: <Phone size={12} />, value: selSupplier.phone }, { icon: <MapPin size={12} />, value: selSupplier.address }, ...(selSupplier.ruc ? [{ icon: <FileText size={12} />, value: `RUC/DNI: ${selSupplier.ruc}` }] : [])].map((row, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-slate-300"><span className="text-amber-400 mt-0.5 flex-shrink-0">{row.icon}</span>{row.value || "—"}</div>
                ))}
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-800 rounded-xl border border-slate-700/50">
                <span className="text-xs text-slate-400">Confiabilidad</span>
                <Stars rating={selSupplier.reliability || 0} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Supplier Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowModal(false); setEditSupplier(null); setForm(EMPTY_FORM); setSaveError(""); }} />
          <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h3 className="font-bold text-white flex items-center gap-2">
                {editSupplier ? <Edit3 size={16} className="text-amber-400" /> : <Plus size={16} className="text-amber-400" />}
                {editSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}
              </h3>
              <button onClick={() => { setShowModal(false); setEditSupplier(null); setForm(EMPTY_FORM); setSaveError(""); }} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">

              {/* Error visible */}
              {saveError && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  {saveError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Nombre empresa *", key: "name",    placeholder: "TechPro SA",         full: true },
                  { label: "RUC / DNI",        key: "ruc",     placeholder: "20123456789"                     },
                  { label: "Contacto *",        key: "contact", placeholder: "Juan García"                    },
                  { label: "Email",             key: "email",   placeholder: "correo@empresa.com"             },
                  { label: "Teléfono",          key: "phone",   placeholder: "+51 999 000 111"                },
                  { label: "Dirección",         key: "address", placeholder: "Av. Lima 123",       full: true },
                ].map(f => (
                  <div key={f.key} className={f.full ? "col-span-2" : ""}>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">{f.label}</label>
                    <input value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                ))}

                {/* Toggle Activo/Inactivo — solo visible al editar */}
                {editSupplier && (
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Estado</label>
                    <div className="flex gap-2">
                      {["Activo", "Inactivo"].map(st => (
                        <button key={st} type="button"
                          onClick={() => setForm(p => ({ ...p, status: st }))}
                          className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                            form.status === st
                              ? st === "Activo"
                                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                                : "bg-red-500/20 border-red-500/50 text-red-400"
                              : "bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600"
                          }`}>
                          {st === "Activo" ? "● Activo" : "○ Inactivo"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="col-span-2">
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Confiabilidad ({form.reliability}/5)</label>
                  <input type="range" min="1" max="5" value={form.reliability} onChange={e => setForm(p => ({ ...p, reliability: Number(e.target.value) }))} className="w-full accent-amber-500" />
                  <div className="mt-1"><Stars rating={Number(form.reliability)} /></div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowModal(false); setEditSupplier(null); setForm(EMPTY_FORM); setSaveError(""); }} className="flex-1 py-2.5 border border-slate-600 text-slate-400 rounded-xl text-sm hover:border-slate-500 transition-colors">Cancelar</button>
                <button onClick={handleSaveSupplier} disabled={!form.name || !form.contact || saving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin" />}{editSupplier ? "Guardar cambios" : "Registrar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ROOT — Invenxio
// ══════════════════════════════════════════════════════════════════════════════
export default function InventoryApp() {
  const { currentUser, userProfile, companyName, logout, registerEmployee } = useAuth();
  const companyId = userProfile?.companyId;
  const userName  = userProfile?.name || currentUser?.email || "Usuario";
  const isOwner   = userProfile?.role === "owner";
  const canManage = isOwner; // solo el Dueño registra/gestiona empleados

  // ── Permisos del usuario actual: definen qué pestañas y botones ve ────────
  const visibleTabs = ["inventory", "movements", "suppliers"]
    .filter(id => canSeeTab(userProfile, id))
    .map(id => ({ id, ...TAB_DEFS[id] }));

  const perms = {
    verInventario:        hasPermission(userProfile, "ver_inventario"),
    crearProductos:       hasPermission(userProfile, "crear_productos"),
    editarProductos:      hasPermission(userProfile, "editar_productos"),
    registrarVentas:      hasPermission(userProfile, "registrar_ventas"),
    registrarCompras:     hasPermission(userProfile, "registrar_compras"),
    verProveedores:       hasPermission(userProfile, "ver_proveedores"),
    gestionarProveedores: hasPermission(userProfile, "gestionar_proveedores"),
    verMetricas:          hasPermission(userProfile, "ver_metricas_financieras"),
    eliminarRegistros:    hasPermission(userProfile, "eliminar_registros"),
  };

  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.id || "inventory");
  // Si cambian los permisos (o el usuario) y la pestaña activa ya no está
  // permitida, saltamos a la primera pestaña que sí puede ver.
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some(t => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [userProfile, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Equipo de la empresa (solo se carga si el usuario puede gestionarlo) ──
  const [employees,        setEmployees]        = useState([]);
  const [employeesLoading, setEmployeesLoading]  = useState(true);
  useEffect(() => {
    if (!companyId || !canManage) { setEmployeesLoading(false); return; }
    const unsub = subscribeToEmployees(companyId, (items) => {
      setEmployees(items);
      setEmployeesLoading(false);
    });
    return unsub;
  }, [companyId, canManage]);

  async function handleRegisterEmployee({ name, email, password, permissions }) {
    await registerEmployee(email, password, name, permissions);
  }
  async function handleChangePermissions(uid, permissions) {
    await updateUserPermissions(uid, permissions);
  }
  async function handleToggleActive(uid, active) {
    await setEmployeeActive(uid, active);
  }

  // ── Datos de Facturación de la empresa (Razón Social, RUC, etc.) ──────────
  const [billing, setBilling] = useState(null);
  useEffect(() => {
    if (!companyId) return;
    const unsub = subscribeToCompany(companyId, (company) => {
      setBilling(company?.billing || null);
    });
    return unsub;
  }, [companyId]);

  async function handleSaveBilling(data) {
    await updateCompanyBilling(companyId, data);
  }

  const [products] = useCollection(companyId, "products", "name");
  const lowStock   = products.filter(p => p.status !== "En Stock").length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'IBM Plex Sans','DM Sans',system-ui,sans-serif" }}>
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              {/* Logo Invenxio */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shadow-md shadow-amber-500/30">
                  <Box size={16} className="text-slate-900" />
                </div>
                <div>
                  <span className="font-extrabold text-white text-base tracking-tight">Inven</span>
                  <span className="font-extrabold text-amber-400 text-base tracking-tight">xio</span>
                  <span className="text-xs text-slate-600 ml-1.5 font-mono">v1</span>
                </div>
              </div>
              {/* Insignia de rol (Dueño / Empleado) */}
              <RoleBadge role={userProfile?.role} />
              {/* Botón Panel: Mis Datos + (si corresponde) gestión de equipo */}
              <RolePanel
                userProfile={userProfile}
                companyName={companyName}
                canManage={canManage}
                employees={employees}
                employeesLoading={employeesLoading}
                onRegisterEmployee={handleRegisterEmployee}
                onChangePermissions={handleChangePermissions}
                onToggleActive={handleToggleActive}
                billing={billing}
                onSaveBilling={handleSaveBilling}
              />
            </div>
            <div className="flex items-center gap-3">
              {lowStock > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-lg">
                  <AlertTriangle size={12} />{lowStock} alertas
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-xs font-bold text-slate-900">
                  {userName[0]?.toUpperCase()}
                </div>
                <span className="text-xs text-slate-400 hidden sm:block">{userName}</span>
              </div>
              <button onClick={logout} title="Cerrar sesión"
                className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        {visibleTabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 gap-2">
            <AlertTriangle size={28} className="text-amber-400" />
            <p className="text-sm">Tu cuenta no tiene permisos asignados todavía.</p>
            <p className="text-xs text-slate-600">Pídele al Dueño que te asigne acceso desde el Panel.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 bg-slate-800/50 p-1.5 rounded-2xl border border-slate-700/50 mb-6 w-fit">
              {visibleTabs.map(tab => {
                const icon = tab.id === "inventory" ? <Package size={16} />
                  : tab.id === "movements" ? <BarChart2 size={16} />
                  : <Truck size={16} />;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === tab.id ? "bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/25" : "text-slate-400 hover:text-slate-200"}`}>
                    {icon}{tab.label}
                  </button>
                );
              })}
            </div>

            {!companyId ? (
              <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-amber-400" /></div>
            ) : (
              <>
                {activeTab === "inventory" && (
                  <InventoryModule companyId={companyId} userName={userName}
                    canCreate={perms.crearProductos} canEdit={perms.editarProductos}
                    canDelete={perms.eliminarRegistros} canViewFinance={perms.verMetricas} />
                )}
                {activeTab === "movements" && (
                  <MovementsModule companyId={companyId} userName={userName}
                    canPurchase={perms.registrarCompras} canSell={perms.registrarVentas}
                    canViewFinance={perms.verMetricas} billing={billing} />
                )}
                {activeTab === "suppliers" && (
                  <SuppliersModule companyId={companyId} userName={userName}
                    canManageSuppliers={perms.gestionarProveedores} canDelete={perms.eliminarRegistros}
                    canViewFinance={perms.verMetricas} billing={billing} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
