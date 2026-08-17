// ─────────────────────────────────────────────────────────────────────────────
// src/components/ImportExcelModal.jsx
// Modal genérico de "Importar desde Excel": elegir archivo → previsualizar
// fila por fila (✓ lista / ✗ con error) → confirmar → importar una por una,
// mostrando progreso → resumen final. Reutilizable por cualquier módulo — no
// sabe nada de "productos" ni de "almacén"; toda esa lógica se la pasa quien
// lo usa mediante `parseRows` (valida) y `onImportRow` (inserta una fila).
//
// Por qué se importa una fila a la vez (no todo junto con Promise.all): así
// una fila que falla (ej. SKU duplicado) no aborta las demás, y se puede
// mostrar exactamente cuáles pasaron y cuáles no — más claro para el usuario
// que revisa una planilla con decenas de filas.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef } from "react";
import { FileSpreadsheet, Download, Upload, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { readExcelRows, downloadExcelTemplate } from "../utils/importExcel";
import { logAndGetErrorMessage } from "../utils/errors";

/**
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {Function} onFinished        Se llama al cerrar después de importar (para refrescar/avisar afuera)
 * @param {string}   title             Título del modal
 * @param {string}   templateFilename  Nombre del archivo de plantilla (sin extensión)
 * @param {string[]} templateHeaders   Encabezados exactos que debe tener el Excel
 * @param {Array}    templateExample   Fila(s) de ejemplo para la plantilla descargable
 * @param {Function} parseRows         (rawRows: Array<Object>) => Array<{ ok, label, values, error }>
 *                                     Valida TODAS las filas leídas del Excel y devuelve una por una
 *                                     con su resultado — así quien llama controla duplicados,
 *                                     autonumeración de SKU, etc. con el contexto completo.
 * @param {Function} onImportRow       (values) => Promise<void>  Inserta una fila ya validada
 * @param {string}   itemNoun          Sustantivo plural para los mensajes, ej. "productos"
 */
export default function ImportExcelModal({
  open, onClose, onFinished, title, templateFilename, templateHeaders, templateExample,
  parseRows, onImportRow, itemNoun = "filas",
}) {
  const [stage,     setStage]     = useState("pick");    // pick | preview | importing | done
  const [fileName,  setFileName]  = useState("");
  const [rows,      setRows]      = useState([]);        // resultado de parseRows
  const [readError, setReadError] = useState("");
  const [progress,  setProgress]  = useState(0);
  const [results,   setResults]   = useState([]);        // { ...row, importOk, importError } tras importar
  const inputRef = useRef(null);

  if (!open) return null;

  const validRows = rows.filter(r => r.ok);
  const invalidCount = rows.length - validRows.length;

  function reset() {
    setStage("pick"); setFileName(""); setRows([]); setReadError(""); setProgress(0); setResults([]);
  }
  function handleClose() {
    reset();
    onClose();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setReadError("");
    try {
      const rawRows = await readExcelRows(file);
      if (rawRows.length === 0) {
        setReadError("El archivo no tiene filas de datos (¿está vacío, o solo tiene encabezados?).");
        return;
      }
      const parsed = parseRows(rawRows);
      setRows(parsed);
      setStage("preview");
    } catch (err) {
      setReadError(logAndGetErrorMessage(err, "Error al leer el Excel:", "No se pudo leer el archivo. Verifica que sea un .xlsx o .xls válido."));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleImport() {
    setStage("importing");
    setProgress(0);
    const out = [];
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        await onImportRow(row.values);
        out.push({ ...row, importOk: true, importError: null });
      } catch (err) {
        out.push({ ...row, importOk: false, importError: logAndGetErrorMessage(err, `Error al importar "${row.label}":`) });
      }
      setProgress(i + 1);
    }
    setResults(out);
    setStage("done");
  }

  const importedOk = results.filter(r => r.importOk).length;
  const importedFail = results.filter(r => !r.importOk).length;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-slate-800 flex-shrink-0">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 min-w-0">
            <FileSpreadsheet size={16} className="text-emerald-400 flex-shrink-0" />
            <span className="truncate">{title}</span>
          </h3>
          <button onClick={handleClose} className="p-1 text-slate-500 hover:text-slate-300 flex-shrink-0"><X size={16} /></button>
        </div>

        {/* Body — scrollea internamente si la planilla trae muchas filas */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">

          {stage === "pick" && (
            <>
              <button
                onClick={() => downloadExcelTemplate(templateHeaders, templateExample, templateFilename)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-sm rounded-lg transition-colors"
              >
                <Download size={15} /> Descargar plantilla de ejemplo
              </button>
              <p className="text-xs text-slate-500 leading-relaxed">
                Descarga la plantilla, complétala con tus datos respetando los encabezados de las columnas, y súbela de vuelta acá. Puedes tener cientos de filas — se revisan todas antes de importar nada.
              </p>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-xl py-8 px-4 cursor-pointer transition-colors">
                <Upload size={22} className="text-slate-500" />
                <span className="text-sm text-slate-300 font-medium">Haz clic para elegir tu archivo Excel</span>
                <span className="text-xs text-slate-600">.xlsx o .xls</span>
                <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
              </label>
              {readError && (
                <div className="flex items-start gap-1.5 text-xs text-red-400">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /><span className="min-w-0 break-words">{readError}</span>
                </div>
              )}
            </>
          )}

          {stage === "preview" && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400 truncate max-w-full">📄 {fileName}</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
                  {validRows.length} listas
                </span>
                {invalidCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 font-semibold">
                    {invalidCount} con error
                  </span>
                )}
              </div>

              {/* max-h + overflow-y-auto: mismo patrón usado en el resto de la
                  app para listas largas — no amontona todo en el modal. */}
              <div className="border border-slate-700/60 rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-800">
                  {rows.map((r, i) => (
                    <div key={i} className={`flex items-start gap-2 px-3 py-2 text-xs ${r.ok ? "" : "bg-red-500/5"}`}>
                      {r.ok
                        ? <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                        : <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />}
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${r.ok ? "text-slate-300" : "text-red-300"}`}>Fila {i + 2}: {r.label}</p>
                        {!r.ok && <p className="text-red-400/80 break-words">{r.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={reset}
                  className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold text-sm rounded-lg transition-colors">
                  Elegir otro archivo
                </button>
                <button onClick={handleImport} disabled={validRows.length === 0}
                  className="flex-1 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-bold text-sm rounded-lg transition-colors">
                  Importar {validRows.length} {itemNoun}
                </button>
              </div>
            </>
          )}

          {stage === "importing" && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 size={26} className="animate-spin text-amber-400" />
              <p className="text-sm text-slate-300 font-medium">Importando {progress} de {validRows.length}…</p>
              <div className="w-full max-w-xs h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${(progress / validRows.length) * 100}%` }} />
              </div>
            </div>
          )}

          {stage === "done" && (
            <>
              <div className="flex flex-col items-center text-center gap-2 py-3">
                <CheckCircle2 size={28} className="text-emerald-400" />
                <p className="text-sm font-semibold text-white">
                  Se importaron {importedOk} de {validRows.length} {itemNoun}
                </p>
                {importedFail > 0 && <p className="text-xs text-red-400">{importedFail} fallaron — detalle abajo</p>}
              </div>
              {importedFail > 0 && (
                <div className="border border-slate-700/60 rounded-lg overflow-hidden">
                  <div className="max-h-48 overflow-y-auto divide-y divide-slate-800">
                    {results.filter(r => !r.importOk).map((r, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs bg-red-500/5">
                        <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="font-medium text-red-300 truncate">{r.label}</p>
                          <p className="text-red-400/80 break-words">{r.importError}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => { handleClose(); onFinished?.(); }}
                className="w-full px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm rounded-lg transition-colors">
                Listo
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
