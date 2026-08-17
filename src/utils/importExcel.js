// ─────────────────────────────────────────────────────────────────────────────
// src/utils/importExcel.js
// Contraparte de exportExcel.js: en vez de descargar datos A un .xlsx, lee
// datos DESDE un .xlsx que el usuario elige. Usa el mismo paquete "xlsx"
// (SheetJS) que ya está instalado para exportar — no agrega una dependencia
// nueva.
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";

/**
 * Lee un archivo .xlsx/.xls y devuelve las filas de su PRIMERA hoja como un
 * array de objetos, usando la fila 1 como encabezados (las llaves del
 * objeto son exactamente el texto de cada columna).
 *
 * `defval: ""` es importante: sin esto, una celda vacía en Excel no genera
 * la llave en el objeto (queda `undefined`), lo que complica validar "¿el
 * usuario dejó esto vacío?" vs "esta columna no existe". Con defval, una
 * celda vacía siempre llega como `""`.
 *
 * @param {File} file
 * @returns {Promise<Array<Object>>}
 */
export async function readExcelRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

/**
 * Genera y descarga una plantilla .xlsx: la fila de encabezados exactos que
 * espera el importador, más una o más filas de ejemplo ya llenas (para que
 * el usuario vea el formato esperado en cada columna, no solo el nombre).
 *
 * @param {string[]}        headers      Encabezados EXACTOS, en el orden en que deben ir
 * @param {Array<Object>}   exampleRows  Filas de ejemplo — mismas llaves que `headers`
 * @param {string}          filename     Nombre del archivo SIN extensión
 */
export function downloadExcelTemplate(headers, exampleRows, filename) {
  const ws = XLSX.utils.json_to_sheet(exampleRows, { header: headers });
  ws["!cols"] = headers.map(h => ({ wch: Math.max(String(h).length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
