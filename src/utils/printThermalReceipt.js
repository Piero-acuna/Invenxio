// ─────────────────────────────────────────────────────────────────────────────
// src/utils/printThermalReceipt.js
//
// Imprime un comprobante de venta/compra en una impresora térmica de ticket
// (58mm u 80mm de rollo), usando el diálogo de impresión NATIVO del
// navegador — sin ESC/POS, sin drivers propios y sin ninguna librería
// nueva. Funciona con cualquier impresora que el sistema operativo (o una
// app puente como RawBT en Android) reconozca como una impresora normal:
// el navegador simplemente manda a imprimir un documento HTML angosto y
// con alto "auto" (como un rollo continuo), y quien resuelve el driver de
// la impresora física es el sistema operativo, no esta app.
//
// Comparte la misma forma de parámetros que generateInvoicePDF.js a
// propósito, para que ambos se puedan usar indistintamente sin tocar el
// resto del código — ver emitReceiptDocument.js, que elige uno u otro según
// la preferencia guardada en billing.printFormat (Panel → Facturación).
//
// IMPORTANTE — mismo alcance legal que generateInvoicePDF.js: este ticket
// es un documento INTERNO de la empresa, no un comprobante electrónico
// autorizado por SUNAT.
// ─────────────────────────────────────────────────────────────────────────────

function fmtMoney(n, symbol = "S/") {
  return `${symbol} ${Number(n || 0).toFixed(2)}`;
}

// Evita que un nombre de producto, nota u observación con caracteres como
// <, >, & o comillas rompa el HTML del ticket.
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * @param {Object} params
 * @param {Object} params.billing        Datos del Dueño: { razonSocial, ruc, direccion, telefono, email, serie }
 * @param {"VENTA"|"PROVEEDOR"} [params.docType]  Heredado — usar operationType cuando se pueda.
 * @param {"compra"|"venta"} [params.operationType]
 * @param {string} [params.date]         Fecha real de la operación ("YYYY-MM-DD"); si no se pasa, usa hoy.
 * @param {string} [params.partyLabel]   "Cliente" | "Proveedor"
 * @param {string} [params.partyName]
 * @param {Array}  params.items          [{ name, description, qty, unitPrice, total }]
 * @param {number} params.total
 * @param {number} [params.invoiceNumber]
 * @param {string} [params.note]
 * @param {string} [params.currencySymbol]
 * @param {string} [params.paymentMethod]
 * @param {"58mm"|"80mm"} [params.width] Ancho del rollo térmico. Default "80mm".
 * @returns {boolean} true si se disparó el diálogo de impresión.
 */
export function printThermalReceipt({
  billing, docType = "VENTA", partyLabel = "Cliente", partyName = "",
  items = [], total = 0, invoiceNumber, note = "", currencySymbol = "S/",
  paymentMethod, operationType, date, width = "80mm",
}) {
  const serie = (billing?.serie || "F001").toUpperCase();
  const correlativo = String(invoiceNumber || 1).padStart(6, "0");
  const opDate = date ? new Date(`${date}T12:00:00`) : new Date(); // mediodía: evita que un huso horario negativo la corra un día atrás
  const fecha = opDate.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const isCompra = operationType ? operationType === "compra" : docType === "PROVEEDOR";
  const isVenta = !isCompra;

  const widthMm = width === "58mm" ? 58 : 80;
  const fontSize = width === "58mm" ? 10 : 11.5;

  const itemsHtml = items.length
    ? items.map((it) => `
      <div class="item">
        <div class="item-name">${esc(it.name)}</div>
        ${it.description ? `<div class="item-desc">${esc(it.description)}</div>` : ""}
        <div class="row">
          <span>${esc(it.qty ?? "")} x ${fmtMoney(it.unitPrice, currencySymbol)}</span>
          <span class="bold">${fmtMoney(it.total, currencySymbol)}</span>
        </div>
      </div>
    `).join("")
    : `<div class="center muted">Sin ítems</div>`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Comprobante</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${widthMm}mm;
    padding: 3mm 3mm 8mm;
    font-family: "Courier New", Courier, monospace;
    font-size: ${fontSize}px;
    line-height: 1.4;
    color: #000;
  }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .big { font-size: ${fontSize + 3}px; }
  .muted { font-size: ${fontSize - 1.5}px; }
  .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .item { margin-bottom: 1.5mm; }
  .item-name { font-weight: 700; word-break: break-word; }
  .item-desc { font-size: ${fontSize - 1.5}px; }
  .total-row { display: flex; justify-content: space-between; align-items: baseline; }
  .foot { text-align: center; margin-top: 2mm; }
</style>
</head>
<body>
  <div class="center bold big">${esc(billing?.razonSocial || "Mi Empresa")}</div>
  ${billing?.ruc ? `<div class="center">RUC/DNI: ${esc(billing.ruc)}</div>` : ""}
  ${billing?.direccion ? `<div class="center">${esc(billing.direccion)}</div>` : ""}
  ${(billing?.telefono || billing?.email) ? `<div class="center muted">${[billing?.telefono, billing?.email].filter(Boolean).map(esc).join(" · ")}</div>` : ""}

  <div class="sep"></div>

  <div class="center bold">${isCompra ? "COMPROBANTE DE COMPRA" : "COMPROBANTE DE VENTA"}</div>
  <div class="center bold big">${serie}-${correlativo}</div>
  <div class="center muted">Fecha: ${fecha}</div>

  <div class="sep"></div>

  <div class="bold">${isCompra ? "PROVEEDOR" : "CLIENTE"}:</div>
  <div>${esc(partyName || "—")}</div>
  ${(!isCompra && paymentMethod) ? `<div class="row"><span class="muted">Método de pago:</span><span class="bold">${esc(paymentMethod)}</span></div>` : ""}

  <div class="sep"></div>

  ${itemsHtml}

  <div class="sep"></div>

  <div class="total-row">
    <span class="bold big">TOTAL</span>
    <span class="bold big">${fmtMoney(total, currencySymbol)}</span>
  </div>

  ${note ? `<div class="sep"></div><div class="muted"><span class="bold">Nota:</span> ${esc(note)}</div>` : ""}

  <div class="sep"></div>

  <div class="foot muted">
    Documento de uso interno. No constituye un comprobante de pago<br/>
    electrónico autorizado por SUNAT.
  </div>
  ${isVenta ? `<div class="foot bold">¡Gracias por su compra!</div>` : ""}

  <script>
    window.onload = function () {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>`;

  // Se imprime desde un <iframe> oculto en vez de window.open(): un popup
  // nuevo puede ser bloqueado por el navegador, mientras que un iframe
  // dentro de la misma página no cuenta como pop-up y no requiere permiso.
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  // Se espera un poco antes de quitar el iframe: si se saca apenas se
  // dispara el evento, algunos navegadores (Chrome en particular) cancelan
  // el diálogo de impresión que recién se abrió.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    setTimeout(() => { iframe.remove(); }, 1000);
  };

  iframe.onload = () => {
    try {
      // "afterprint" (soportado en Chrome/Edge/Firefox) avisa cuando el
      // usuario cierra el diálogo de impresión — ahí sí es seguro limpiar.
      iframe.contentWindow?.addEventListener?.("afterprint", cleanup);
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (err) {
      console.error("Error al imprimir comprobante térmico:", err);
      cleanup();
    }
  };

  iframe.srcdoc = html;
  // Red de seguridad por si "afterprint" nunca llega (ej. el usuario
  // cancela sin que el navegador dispare el evento).
  setTimeout(cleanup, 6000);

  return true;
}
