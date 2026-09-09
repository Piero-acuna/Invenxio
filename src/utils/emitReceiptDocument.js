// ─────────────────────────────────────────────────────────────────────────────
// src/utils/emitReceiptDocument.js
//
// Punto único de emisión de comprobantes: decide si el comprobante sale
// como PDF A4 (generateInvoicePDF) o como ticket térmico (58mm/80mm, vía
// printThermalReceipt) según la preferencia guardada por el Dueño en
// Panel → Facturación (billing.printFormat).
//
// Se agregó para no tener que repetir el "if" en cada uno de los 3 lugares
// que emiten comprobantes (venta en Movimientos, compra/venta a proveedor
// en Proveedores, reimpresión en Historial) — todos importan esta función
// en vez de generateInvoicePDF directamente.
// ─────────────────────────────────────────────────────────────────────────────
import { generateInvoicePDF } from "./generateInvoicePDF";
import { printThermalReceipt } from "./printThermalReceipt";

// Valores que puede tener billing.printFormat (ver BillingTab en
// RolePanel.jsx). Si no está seteado (empresas ya existentes antes de este
// cambio), se sigue usando el PDF A4 de siempre — nadie pierde su
// comportamiento actual sin elegirlo explícitamente.
const THERMAL_WIDTH_BY_FORMAT = {
  termica_80: "80mm",
  termica_58: "58mm",
};

/**
 * Mismos params que generateInvoicePDF(...) / printThermalReceipt(...).
 * @returns {boolean}
 */
export function emitReceiptDocument(params) {
  const width = THERMAL_WIDTH_BY_FORMAT[params?.billing?.printFormat];
  if (width) return printThermalReceipt({ ...params, width });
  return generateInvoicePDF(params);
}
