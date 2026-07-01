// ─────────────────────────────────────────────────────────────────────────────
// src/utils/generateInvoicePDF.js
//
// Genera un comprobante de venta/compra en PDF, enteramente en el navegador
// y SIN depender de ningún proveedor externo de facturación (todo se arma
// con jsPDF, en el dispositivo del usuario).
//
// IMPORTANTE — alcance legal: este comprobante es un documento INTERNO de
// la empresa (útil como respaldo de la operación frente al cliente o
// proveedor). NO es un comprobante electrónico autorizado por SUNAT
// (boleta/factura electrónica) — para eso se requiere estar registrado
// como emisor electrónico ante SUNAT y usar un sistema homologado. Por eso
// se aclara al pie de cada documento generado.
//
// Requiere el paquete "jspdf". Si no está instalado, correr:
//   npm install jspdf
// ─────────────────────────────────────────────────────────────────────────────
import jsPDF from "jspdf";

function fmtMoney(n) {
  return `S/ ${Number(n || 0).toFixed(2)}`;
}

/**
 * @param {Object} params
 * @param {Object} params.billing        Datos del Dueño: { razonSocial, ruc, direccion, telefono, email, serie }
 * @param {"VENTA"|"PROVEEDOR"} params.docType  Tipo de comprobante
 * @param {string} params.partyLabel     "Cliente" | "Proveedor"
 * @param {string} params.partyName      Nombre del cliente o proveedor
 * @param {Array}  params.items          [{ name, qty, unitPrice, total }]
 * @param {number} params.total          Total general
 * @param {number} params.invoiceNumber  Correlativo numérico
 * @param {string} [params.note]         Nota / observación opcional
 * @returns {boolean} true si se generó y descargó correctamente
 */
export function generateInvoicePDF({
  billing, docType = "VENTA", partyLabel = "Cliente", partyName = "",
  items = [], total = 0, invoiceNumber, note = "",
}) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 18;
  let y = 20;

  const serie = (billing?.serie || "F001").toUpperCase();
  const correlativo = String(invoiceNumber || 1).padStart(6, "0");
  const fecha = new Date().toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });

  // ── Encabezado: datos del emisor (Dueño) ──
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(billing?.razonSocial || "Mi Empresa", marginX, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  y += 6;
  if (billing?.ruc)       { pdf.text(`RUC/DNI: ${billing.ruc}`, marginX, y); y += 5; }
  if (billing?.direccion) { pdf.text(billing.direccion, marginX, y); y += 5; }
  const contacto = [billing?.telefono, billing?.email].filter(Boolean).join("   ·   ");
  if (contacto) { pdf.text(contacto, marginX, y); y += 5; }

  // ── Caja del comprobante (serie-correlativo) ──
  pdf.setDrawColor(180);
  pdf.rect(140, 14, 52, 22);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(docType === "PROVEEDOR" ? "COMPROBANTE DE COMPRA" : "COMPROBANTE DE VENTA", 166, 20, { align: "center" });
  pdf.setFontSize(12);
  pdf.text(`${serie}-${correlativo}`, 166, 27, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(`Fecha: ${fecha}`, 166, 32, { align: "center" });

  y = Math.max(y, 42) + 6;
  pdf.setDrawColor(200);
  pdf.line(marginX, y, 192, y);
  y += 8;

  // ── Datos del cliente / proveedor ──
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text(`${partyLabel}:`, marginX, y);
  pdf.setFont("helvetica", "normal");
  pdf.text(partyName || "—", marginX + 22, y);
  y += 10;

  // ── Tabla de ítems ──
  pdf.setFillColor(245, 245, 245);
  pdf.rect(marginX, y, 174, 7, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.text("Producto", marginX + 2, y + 5);
  pdf.text("Cant.", 130, y + 5, { align: "right" });
  pdf.text("P. Unit.", 158, y + 5, { align: "right" });
  pdf.text("Total", 190, y + 5, { align: "right" });
  y += 7;

  pdf.setFont("helvetica", "normal");
  items.forEach((it, i) => {
    if (y > 265) { pdf.addPage(); y = 20; }
    if (i % 2 === 1) { pdf.setFillColor(250, 250, 250); pdf.rect(marginX, y, 174, 7, "F"); }
    pdf.text(String(it.name || "").slice(0, 45), marginX + 2, y + 5);
    pdf.text(String(it.qty ?? ""), 130, y + 5, { align: "right" });
    pdf.text(fmtMoney(it.unitPrice), 158, y + 5, { align: "right" });
    pdf.text(fmtMoney(it.total), 190, y + 5, { align: "right" });
    y += 7;
  });

  y += 4;
  pdf.setDrawColor(200);
  pdf.line(marginX, y, 192, y);
  y += 8;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("TOTAL:", 158, y, { align: "right" });
  pdf.text(fmtMoney(total), 190, y, { align: "right" });
  y += 12;

  if (note) {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(8.5);
    pdf.text(`Nota: ${note}`, marginX, y);
    y += 8;
  }

  // ── Pie legal ──
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(140);
  pdf.text(
    "Documento de uso interno. No constituye un comprobante de pago electronico autorizado por SUNAT.",
    marginX, 285
  );

  pdf.save(`${docType === "PROVEEDOR" ? "Compra" : "Venta"}_${serie}-${correlativo}.pdf`);
  return true;
}
