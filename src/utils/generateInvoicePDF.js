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

// ── Paleta (coherente con la UI: acentos emerald sobre base slate) ──
const COLOR = {
  brand: [4, 120, 87],       // emerald-700 — franja superior y acentos fuertes
  brandLight: [5, 150, 105], // emerald-600 — encabezado de tabla
  brandTint: [236, 253, 245],// emerald-50  — fondos suaves
  ink: [30, 41, 59],         // slate-800   — texto principal
  sub: [100, 116, 139],      // slate-500   — texto secundario
  faint: [148, 163, 184],    // slate-400   — texto terciario / pie
  line: [226, 232, 240],     // slate-200   — líneas y bordes
  rowAlt: [248, 250, 252],   // slate-50    — filas alternas
  white: [255, 255, 255],
};

function fmtMoney(n, symbol = "S/") {
  return `${symbol} ${Number(n || 0).toFixed(2)}`;
}

function setFill(pdf, c) { pdf.setFillColor(c[0], c[1], c[2]); }
function setDraw(pdf, c) { pdf.setDrawColor(c[0], c[1], c[2]); }
function setText(pdf, c) { pdf.setTextColor(c[0], c[1], c[2]); }

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
 * @param {string} [params.currencySymbol] Símbolo de moneda ("S/" o "$") — según el país de la empresa
 * @returns {boolean} true si se generó y descargó correctamente
 */
export function generateInvoicePDF({
  billing, docType = "VENTA", partyLabel = "Cliente", partyName = "",
  items = [], total = 0, invoiceNumber, note = "", currencySymbol = "S/",
}) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const marginX = 18;
  const contentW = pageW - marginX * 2; // 174
  const rightX = marginX + contentW;    // 192
  let y = 0;

  const serie = (billing?.serie || "F001").toUpperCase();
  const correlativo = String(invoiceNumber || 1).padStart(6, "0");
  const fecha = new Date().toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const isCompra = docType === "PROVEEDOR";

  const addLegalFooter = () => {
    setDraw(pdf, COLOR.line);
    pdf.setLineWidth(0.3);
    pdf.line(marginX, 280, rightX, 280);
    setText(pdf, COLOR.faint);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(
      "Documento de uso interno. No constituye un comprobante de pago electrónico autorizado por SUNAT.",
      marginX, 285
    );
  };

  const paintHeaderBand = () => {
    // Franja superior de marca
    setFill(pdf, COLOR.brand);
    pdf.rect(0, 0, pageW, 4, "F");
  };

  paintHeaderBand();
  y = 16;

  // ── Encabezado: datos del emisor (izquierda) ──
  setText(pdf, COLOR.ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text(billing?.razonSocial || "Mi Empresa", marginX, y);
  y += 6;

  setText(pdf, COLOR.sub);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  if (billing?.ruc) { pdf.text(`RUC/DNI: ${billing.ruc}`, marginX, y); y += 4.8; }
  if (billing?.direccion) {
    const dirLines = pdf.splitTextToSize(billing.direccion, 105);
    pdf.text(dirLines, marginX, y);
    y += 4.8 * dirLines.length;
  }
  const contacto = [billing?.telefono, billing?.email].filter(Boolean).join("   ·   ");
  if (contacto) { pdf.text(contacto, marginX, y); y += 4.8; }

  // ── Caja del comprobante (derecha, estilo "sello") ──
  const boxW = 56, boxX = rightX - boxW, boxY = 14, boxH = 24;
  setDraw(pdf, COLOR.brand);
  pdf.setLineWidth(0.6);
  pdf.roundedRect(boxX, boxY, boxW, boxH, 1.5, 1.5, "S");
  setFill(pdf, COLOR.brand);
  pdf.roundedRect(boxX, boxY, boxW, 7.5, 1.5, 1.5, "F");
  pdf.rect(boxX, boxY + 4, boxW, 3.5, "F"); // cuadra las esquinas inferiores del bloque de título
  setText(pdf, COLOR.white);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text(isCompra ? "COMPROBANTE DE COMPRA" : "COMPROBANTE DE VENTA", boxX + boxW / 2, boxY + 5, { align: "center" });

  setText(pdf, COLOR.ink);
  pdf.setFontSize(13);
  pdf.text(`${serie}-${correlativo}`, boxX + boxW / 2, boxY + 15.5, { align: "center" });
  setText(pdf, COLOR.sub);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(`Fecha de emisión: ${fecha}`, boxX + boxW / 2, boxY + 21, { align: "center" });

  y = Math.max(y, boxY + boxH) + 8;

  // ── Datos del cliente / proveedor ──
  const partyBoxH = 14;
  setFill(pdf, COLOR.brandTint);
  pdf.roundedRect(marginX, y, contentW, partyBoxH, 1.5, 1.5, "F");
  setText(pdf, COLOR.sub);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.text((isCompra ? "PROVEEDOR" : "CLIENTE"), marginX + 4, y + 5.5);
  setText(pdf, COLOR.ink);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10.5);
  pdf.text(partyName || "—", marginX + 4, y + 11);
  y += partyBoxH + 9;

  // ── Tabla de ítems ──
  const colProd = marginX + 3;
  const colQty = marginX + contentW * 0.62;
  const colUnit = marginX + contentW * 0.80;
  const colTotal = rightX - 2;
  const rowH = 7.5;
  const headerH = 8.5;

  const drawTableHeader = () => {
    setFill(pdf, COLOR.brandLight);
    pdf.rect(marginX, y, contentW, headerH, "F");
    setText(pdf, COLOR.white);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text("PRODUCTO", colProd, y + 5.7);
    pdf.text("CANT.", colQty, y + 5.7, { align: "right" });
    pdf.text("P. UNIT.", colUnit, y + 5.7, { align: "right" });
    pdf.text("TOTAL", colTotal, y + 5.7, { align: "right" });
    y += headerH;
  };

  drawTableHeader();

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.7);
  items.forEach((it, i) => {
    if (y > 262) {
      addLegalFooter();
      pdf.addPage();
      paintHeaderBand();
      y = 20;
      drawTableHeader();
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.7);
    }
    if (i % 2 === 1) { setFill(pdf, COLOR.rowAlt); pdf.rect(marginX, y, contentW, rowH, "F"); }
    setText(pdf, COLOR.ink);
    pdf.text(String(it.name || "").slice(0, 48), colProd, y + 5.1);
    setText(pdf, COLOR.sub);
    pdf.text(String(it.qty ?? ""), colQty, y + 5.1, { align: "right" });
    pdf.text(fmtMoney(it.unitPrice, currencySymbol), colUnit, y + 5.1, { align: "right" });
    setText(pdf, COLOR.ink);
    pdf.setFont("helvetica", "bold");
    pdf.text(fmtMoney(it.total, currencySymbol), colTotal, y + 5.1, { align: "right" });
    pdf.setFont("helvetica", "normal");
    y += rowH;
  });

  setDraw(pdf, COLOR.line);
  pdf.setLineWidth(0.3);
  pdf.line(marginX, y, rightX, y);
  y += 8;

  // ── Total destacado ──
  const totalBoxW = 68, totalBoxH = 13;
  const totalBoxX = rightX - totalBoxW;
  if (y + totalBoxH > 272) { addLegalFooter(); pdf.addPage(); paintHeaderBand(); y = 20; }
  setFill(pdf, COLOR.ink);
  pdf.roundedRect(totalBoxX, y, totalBoxW, totalBoxH, 1.5, 1.5, "F");
  setText(pdf, COLOR.white);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.5);
  pdf.text("TOTAL", totalBoxX + 6, y + 8.3);
  pdf.setFontSize(13);
  pdf.text(fmtMoney(total, currencySymbol), rightX - 5, y + 8.6, { align: "right" });
  y += totalBoxH + 10;

  if (note) {
    if (y > 268) { addLegalFooter(); pdf.addPage(); paintHeaderBand(); y = 20; }
    setDraw(pdf, COLOR.line);
    setFill(pdf, COLOR.rowAlt);
    pdf.setLineWidth(0.2);
    const noteLines = pdf.splitTextToSize(note, contentW - 8);
    const noteH = noteLines.length * 4.2 + 6;
    pdf.roundedRect(marginX, y, contentW, noteH, 1.5, 1.5, "FD");
    setText(pdf, COLOR.sub);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.text("NOTA", marginX + 4, y + 5);
    setText(pdf, COLOR.ink);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(8.5);
    pdf.text(noteLines, marginX + 4, y + 9.5);
    y += noteH + 6;
  }

  // ── Pie legal + numeración de página ──
  const pageCount = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    addLegalFooter();
    setText(pdf, COLOR.faint);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(`Página ${p} de ${pageCount}`, rightX, 285, { align: "right" });
  }

  pdf.save(`${isCompra ? "Compra" : "Venta"}_${serie}-${correlativo}.pdf`);
  return true;
}
