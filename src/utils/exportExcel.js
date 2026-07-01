// ─────────────────────────────────────────────────────────────────────────────
// src/utils/exportExcel.js
//
// Exporta arreglos de objetos a un archivo .xlsx descargable, usando SheetJS
// (paquete "xlsx"). Genera el archivo enteramente en el navegador — no pasa
// por ningún servidor — y respeta las columnas/datos que se le entreguen
// (es responsabilidad de quien llama filtrar antes según permisos).
//
// Requiere el paquete "xlsx" (SheetJS). Si no está instalado, correr:
//   npm install xlsx
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";

/**
 * @param {Array<Object>} rows      Filas ya formateadas como { "Encabezado": valor, ... }
 * @param {string}        filename  Nombre del archivo SIN extensión (se agrega .xlsx)
 * @param {string}        sheetName Nombre de la hoja dentro del Excel (máx. 31 caracteres)
 */
export function exportToExcel(rows, filename, sheetName = "Datos") {
  if (!rows || rows.length === 0) return;

  const ws = XLSX.utils.json_to_sheet(rows);

  // Autoajustar el ancho de columnas según el contenido más largo de cada una.
  const colWidths = Object.keys(rows[0]).map((key) => {
    const maxLen = rows.reduce(
      (max, row) => Math.max(max, String(row[key] ?? "").length),
      key.length
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${today}.xlsx`);
}
