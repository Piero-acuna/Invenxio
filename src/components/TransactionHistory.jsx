// ─────────────────────────────────────────────────────────────────────────────
// src/components/TransactionHistory.jsx
// Historial general (ventas, compras, movimientos de almacén y ventas a
// proveedores) con filtros, gráficos y exportación a Excel.
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo } from "react";
import {
  Search, ArrowUpCircle, ArrowDownCircle, BarChart2, TrendingUp,
  FileSpreadsheet, FileDown,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { getNextInvoiceNumber } from "../services/firestoreService";
import { exportToExcel } from "../utils/exportExcel";
import { generateInvoicePDF } from "../utils/generateInvoicePDF";
import { Spinner } from "./shared/StatusUI";

// ─── HISTORY TABLE ────────────────────────────────────────────────────────────
const TransactionHistory = ({ transactions: rawTransactions, warehouseMovements = [], supplierSales = [], loading, canViewFinance, canPurchase, canSell, billing, companyId }) => {
  const [search, setSearch] = useState("");
  const [sourceF, setSourceF] = useState("all"); // "all" | "inventario" | "almacen" | "proveedores"
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

  // ── Historial unificado: Inventario + Almacén + Proveedores ──────────────
  // Se arma a partir de 3 colecciones distintas, evitando mostrar el mismo
  // evento dos veces: una compra a proveedor ya aparece en "transactions"
  // (con su costo), así que no se repite el movimiento de almacén que generó;
  // lo mismo con una venta a proveedor y su salida de almacén asociada.
  const SOURCE_LABEL = { Inventario: "📦 Inventario", "Almacén": "🏬 Almacén", Proveedores: "🚚 Proveedores" };
  const TYPE_LABEL = {
    venta: "Venta", compra: "Compra", venta_proveedor: "Venta a Proveedor",
    entrada: "Entrada", salida: "Salida", traslado: "Traslado", envio_inventario: "Envío a Tienda",
  };
  const unifiedHistory = useMemo(() => {
    const items = [];

    rawTransactions.forEach(t => {
      if (t.type === "venta"  && !canSell) return;
      if (t.type === "compra" && !canPurchase) return;
      items.push({
        id: `tx-${t.id}`,
        source: t.type === "compra" && t.target === "almacen" ? "Proveedores" : "Inventario",
        type: t.type,
        date: t.date, time: t.time || "",
        product: t.product, sku: t.sku, qty: t.qty, unit: t.packName || "",
        amount: t.total ?? null,
        party: t.supplier || t.client || "—",
        note: t.note || "",
        raw: t,
      });
    });

    if (canPurchase || canSell) {
      supplierSales.forEach(s => {
        items.push({
          id: `ss-${s.id}`,
          source: "Proveedores",
          type: "venta_proveedor",
          date: s.date, time: s.time || "",
          product: s.product, sku: s.sku, qty: s.qty, unit: s.packName || "",
          amount: s.total ?? null,
          party: s.supplier || "—",
          note: s.status === "Cancelado" ? `Cancelada${s.note ? " · " + s.note : ""}` : (s.note || ""),
          status: s.status,
          raw: s,
        });
      });

      warehouseMovements.forEach(m => {
        const reason = m.reason || "";
        if (m.type === "entrada" && reason.startsWith("Compra a proveedor")) return; // ya está como "compra"
        if (m.type === "salida"  && reason.startsWith("Venta a proveedor"))  return; // ya está como "venta_proveedor"
        items.push({
          id: `wm-${m.id}`,
          source: "Almacén",
          type: m.type,
          date: m.date, time: m.time || "",
          product: m.productName, sku: m.sku, qty: m.qty, unit: m.packName || "",
          amount: null,
          party: m.type === "traslado" ? `${m.fromLocationName || "?"} → ${m.toLocationName || "?"}`
               : m.type === "envio_inventario" ? `🏪 ${m.storeProductName || "Tienda"}`
               : (m.toLocationName || m.fromLocationName || "—"),
          note: m.reason || "",
          raw: m,
        });
      });
    }

    return items.sort((a, b) => {
      const ta = a.raw?.createdAt?.toDate ? a.raw.createdAt.toDate().getTime() : new Date(a.date || "1970-01-01").getTime();
      const tb = b.raw?.createdAt?.toDate ? b.raw.createdAt.toDate().getTime() : new Date(b.date || "1970-01-01").getTime();
      return tb - ta;
    });
  }, [rawTransactions, warehouseMovements, supplierSales, canPurchase, canSell]);


  const filtered = useMemo(() =>
    unifiedHistory.filter(t => {
      const q = search.toLowerCase();
      const sourceKey = t.source === "Inventario" ? "inventario" : t.source === "Almacén" ? "almacen" : "proveedores";
      return (sourceF === "all" || sourceF === sourceKey) &&
        (t.product?.toLowerCase().includes(q) || t.sku?.toLowerCase().includes(q) ||
         (t.party || "").toLowerCase().includes(q));
    }), [unifiedHistory, sourceF, search]);

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
        "Fuente":             t.source,
        "Tipo":               TYPE_LABEL[t.type] || t.type,
        "Fecha":              t.date || "",
        "Hora":               t.time || "",
        "Producto":           t.product || "",
        "SKU":                t.sku || "",
        "Cantidad":           t.qty ?? "",
      };
      if (canViewFinance && t.amount != null) {
        base["Total (S/)"] = Number(t.amount.toFixed(2));
      }
      base["Proveedor / Cliente / Detalle"] = t.party || "—";
      base["Nota"] = t.note || "";
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
      const raw = t.raw || t;
      const isVenta = t.type === "venta";
      const isVentaProveedor = t.type === "venta_proveedor";
      // Una transacción puede tener múltiples ítems (carrito) o uno solo
      const items = raw.items?.length
        ? raw.items.map(i => ({ name: i.name, qty: i.qty, unitPrice: i.price ?? i.unitPrice, total: (i.price ?? i.unitPrice) * i.qty }))
        : [{ name: t.product || "—", qty: t.qty, unitPrice: raw.unitCost ?? raw.unitPrice ?? 0, total: t.amount ?? 0 }];
      generateInvoicePDF({
        billing,
        docType:     isVenta ? "VENTA" : "PROVEEDOR",
        partyLabel:  isVenta ? "Cliente" : "Proveedor",
        partyName:   t.party || "—",
        items,
        total:       t.amount ?? 0,
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          {[
            {
              label: "Total Ingresos",
              value: `S/ ${totalVentas.toFixed(2)}`,
              sub: `${transactions.filter(t=>t.type==="venta").length} ventas`,
              color: "text-emerald-400",
              bg: "bg-emerald-500/10 border-emerald-500/20",
              icon: <ArrowDownCircle size={16} />,
            },
            {
              label: "Total Egresos",
              value: `S/ ${totalCompras.toFixed(2)}`,
              sub: `${transactions.filter(t=>t.type==="compra").length} compras`,
              color: "text-blue-400",
              bg: "bg-blue-500/10 border-blue-500/20",
              icon: <ArrowUpCircle size={16} />,
            },
            {
              label: "Ganancia Bruta",
              value: `S/ ${gananciaBruta.toFixed(2)}`,
              sub: gananciaBruta >= 0 ? "Positivo ✓" : "Negativo ✗",
              color: gananciaBruta >= 0 ? "text-amber-400" : "text-red-400",
              bg: gananciaBruta >= 0 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20",
              icon: <TrendingUp size={16} />,
            },
            {
              label: "Margen Neto",
              value: `${margenGlobal.toFixed(1)}%`,
              sub: "sobre ventas",
              color: margenGlobal >= 20 ? "text-emerald-400" : margenGlobal >= 0 ? "text-amber-400" : "text-red-400",
              bg: margenGlobal >= 20 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-amber-500/10 border-amber-500/20",
              icon: <BarChart2 size={16} />,
            },
          ].map((s, i) => (
            <div key={i} className={`rounded-xl p-3 sm:p-4 border ${s.bg} flex items-center gap-2 sm:gap-3`}>
              <span className={`${s.color} flex-shrink-0`}>{s.icon}</span>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 mb-0.5 truncate">{s.label}</p>
                <p className={`text-sm sm:text-base font-bold font-mono ${s.color} truncate`}>{s.value}</p>
                <p className="text-xs text-slate-600 truncate">{s.sub}</p>
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
        <div className="flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 overflow-x-auto">
          {[
            { v: "all",         l: "Todos" },
            { v: "inventario",  l: "📦 Inventario" },
            { v: "almacen",     l: "🏬 Almacén" },
            { v: "proveedores", l: "🚚 Proveedores" },
          ].map(f => (
            <button key={f.v} onClick={() => setSourceF(f.v)}
              className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${sourceF === f.v ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
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
                    ? ["Fuente","Tipo","Fecha","Producto / SKU","Cant.","Total","Detalle",""]
                    : ["Fuente","Tipo","Fecha","Producto / SKU","Cant.","Detalle",""]
                  ).map((h,i,arr) => (
                    <th key={i} className={`py-2.5 px-3 text-slate-400 font-medium uppercase tracking-wider ${i === arr.length-1 ? "w-8" : i > 3 ? "text-right" : "text-left"} ${h==="Detalle" ? "hidden md:table-cell" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => {
                  const TYPE_STYLE = {
                    venta:             "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                    compra:            "bg-blue-500/15 text-blue-400 border-blue-500/30",
                    venta_proveedor:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
                    entrada:           "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                    salida:            "bg-red-500/15 text-red-400 border-red-500/30",
                    traslado:          "bg-sky-500/15 text-sky-400 border-sky-500/30",
                    envio_inventario:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
                  };
                  const canReprint = (t.type === "venta" || t.type === "compra" || t.type === "venta_proveedor") && t.amount != null && canViewFinance;
                  return (
                    <tr key={t.id} className={`border-b border-slate-700/30 hover:bg-slate-800/40 transition-colors ${i%2===0 ? "" : "bg-slate-800/10"}`}>
                      <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{SOURCE_LABEL[t.source]}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border whitespace-nowrap ${TYPE_STYLE[t.type] || "bg-slate-700 text-slate-300 border-slate-600"}`}>
                          {TYPE_LABEL[t.type] || t.type}
                        </span>
                        {t.status === "Cancelado" && <span className="ml-1.5 text-[10px] text-red-400">(Cancelada)</span>}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono whitespace-nowrap">{t.date}{t.time ? <span className="text-slate-600"> · {t.time}</span> : ""}</td>
                      <td className="py-2.5 px-3">
                        <div className="text-slate-200 font-medium">{t.product}</div>
                        <div className="text-slate-500 font-mono">{t.sku}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-300">{t.qty}{t.unit ? <span className="text-slate-500 font-normal"> {t.unit}</span> : ""}</td>
                      {canViewFinance && (
                        <td className={`py-2.5 px-3 text-right font-mono font-bold ${t.amount == null ? "text-slate-600" : t.type === "compra" ? "text-red-400" : "text-emerald-400"}`}>
                          {t.amount != null ? `${t.type === "compra" ? "-" : "+"} S/ ${t.amount.toFixed(2)}` : "—"}
                        </td>
                      )}
                      <td className="py-2.5 px-3 hidden md:table-cell text-slate-400">{t.party}</td>
                      <td className="py-2.5 px-3 text-center">
                        {canReprint && (
                          <button
                            onClick={() => handleReprint(t)}
                            title="Descargar comprobante PDF"
                            className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <FileDown size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionHistory;
