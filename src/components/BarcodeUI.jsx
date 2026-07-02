// ─────────────────────────────────────────────────────────────────────────────
// src/components/BarcodeUI.jsx
// Componentes de UI para códigos de barras: renderizado (BarcodeDisplay) y
// escaneo por cámara (BarcodeScanner).
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
//
// Dependencias npm: jsbarcode, @zxing/browser
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { X, Loader2, ScanBarcode, CameraOff, Download } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import JsBarcode from "jsbarcode";
import { Spinner } from "./shared/StatusUI";

function BarcodeDisplay({ value, height = 80, showDownload = false, productName = "" }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!value || !svgRef.current) return;
    const timer = setTimeout(() => {
      try {
        JsBarcode(svgRef.current, String(value), {
          format:       "CODE128",
          width:        2,
          height:       height,
          displayValue: true,
          fontSize:     12,
          fontOptions:  "bold",
          margin:       10,
          background:   "#ffffff",
          lineColor:    "#111827",
          textMargin:   4,
          font:         "monospace",
        });
      } catch (err) {
        console.warn("Barcode error:", value, err);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [value, height]);

  // Convierte el SVG a PNG y lo descarga
  function handleDownload() {
    if (!svgRef.current) return;
    const svg     = svgRef.current;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas  = document.createElement("canvas");
    const ctx     = canvas.getContext("2d");
    const img     = new Image();
    // Leer dimensiones reales del SVG generado por JsBarcode
    const bbox    = svg.getBoundingClientRect();
    canvas.width  = svg.width?.baseVal?.value  || bbox.width  || 300;
    canvas.height = svg.height?.baseVal?.value || bbox.height || 120;
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const link    = document.createElement("a");
      link.download = `barcode_${productName || value}.png`;
      link.href     = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  }

  if (!value) return null;

  return (
    <div className="flex flex-col items-center bg-white rounded-lg p-3 gap-2">
      <svg ref={svgRef} style={{ width: "100%", maxWidth: 280 }} />
      {showDownload && (
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
        >
          <Download size={12} /> Descargar PNG
        </button>
      )}
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

export { BarcodeDisplay, BarcodeScanner };
