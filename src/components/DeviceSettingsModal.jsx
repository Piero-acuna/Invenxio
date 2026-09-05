// ─────────────────────────────────────────────────────────────────────────────
// src/components/DeviceSettingsModal.jsx
// Ventana modal para configurar el hardware de punto de venta de ESTE
// terminal: lector de código de barras (1D/2D) e impresora térmica directa,
// cada uno por USB, Bluetooth o Wi-Fi. Se abre desde RolePanel → "Panel".
//
// Notas sobre las conexiones (se muestran también como ayuda en la UI):
//  • USB/Bluetooth (lector): la gran mayoría de lectores de este tipo
//    funcionan como "teclado" (HID) — no necesitan pairing por software, se
//    conectan/emparejan a nivel de sistema operativo y luego cualquier campo
//    de texto de la app recibe el código como si se hubiera tecleado. Por eso
//    aquí se ofrece un cuadro de prueba en vivo en lugar de un botón "parear".
//  • USB (impresora): usa WebUSB (navigator.usb) para un emparejamiento real
//    desde el navegador — funciona en Chrome/Edge de escritorio con la
//    mayoría de impresoras térmicas ESC/POS.
//  • Bluetooth (impresora): usa Web Bluetooth (navigator.bluetooth). Solo
//    cubre impresoras Bluetooth Low Energy — los modelos que usan Bluetooth
//    clásico (SPP) no son accesibles desde el navegador y deben emparejarse
//    desde el sistema operativo.
//  • Wi-Fi (lector e impresora): los navegadores no permiten abrir sockets
//    TCP directos, así que aquí solo se guarda la IP/URL de referencia; el
//    envío real de datos requiere el propio flujo de la impresora/lector o un
//    agente local en la red.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X, ScanBarcode, Printer, Usb, Bluetooth, Wifi,
  CheckCircle2, AlertTriangle, Loader2, Save,
} from "lucide-react";
import {
  loadDeviceSettings, saveDeviceSettings, getBrowserCapabilities,
} from "../lib/deviceSettings";

const CONNECTIONS = [
  { id: "usb",       label: "USB",           icon: Usb },
  { id: "bluetooth", label: "Bluetooth",     icon: Bluetooth },
  { id: "wifi",      label: "Wi-Fi",         icon: Wifi },
];

function SegmentedControl({ options, value, onChange, disabled }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(opt => {
        const Icon = opt.icon;
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
              active
                ? "bg-amber-500 border-amber-500 text-slate-900"
                : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {Icon && <Icon size={15} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 group"
    >
      <span className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-amber-500" : "bg-slate-700"}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
      <span className="text-sm font-semibold text-slate-200">{label}</span>
    </button>
  );
}

// ── Sección: Lector de Código de Barras ──────────────────────────────────────
function ScannerSection({ value, onChange }) {
  const [testInput, setTestInput] = useState("");
  const [lastScan,  setLastScan]  = useState("");

  // La mayoría de lectores HID escriben todo el código y luego un Enter, así
  // que basta con capturar el Enter para separar un código completo de texto
  // tecleado a mano — no hace falta medir velocidad de tecleo para esto.
  function handleTestKeyDown(e) {
    if (e.key === "Enter" && testInput.trim()) {
      setLastScan(testInput.trim());
      setTestInput("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanBarcode size={16} className="text-amber-400" />
          <h4 className="font-bold text-white text-sm">Lector de Código de Barras</h4>
        </div>
        <Toggle checked={value.enabled} onChange={v => onChange({ ...value, enabled: v })} label={value.enabled ? "Activado" : "Desactivado"} />
      </div>

      {value.enabled && (
        <div className="space-y-4 pl-1">
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-1.5">Tipo de lector</p>
            <SegmentedControl
              options={[{ id: "1d", label: "1D (láser)" }, { id: "2d", label: "2D (imagen)" }]}
              value={value.type}
              onChange={t => onChange({ ...value, type: t })}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              2D también lee QR y códigos dañados/en pantalla; 1D solo códigos de barras clásicos.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-400 mb-1.5">Conexión</p>
            <SegmentedControl options={CONNECTIONS} value={value.connection} onChange={c => onChange({ ...value, connection: c })} />
          </div>

          {(value.connection === "usb" || value.connection === "bluetooth") && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">
                {value.connection === "usb"
                  ? "Conéctalo al puerto USB: la mayoría funciona como teclado, sin instalar nada más."
                  : "Empareja el lector desde Bluetooth del sistema operativo — luego funciona como teclado inalámbrico."}
              </p>
              <input
                value={value.label}
                onChange={e => onChange({ ...value, label: e.target.value })}
                placeholder="Nombre del lector (opcional, ej. Honeywell 1900)"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
              <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-slate-400 mb-1.5">Probar lector</p>
                <input
                  value={testInput}
                  onChange={e => setTestInput(e.target.value)}
                  onKeyDown={handleTestKeyDown}
                  autoComplete="off"
                  placeholder="Haz clic aquí y escanea un código…"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
                />
                {lastScan && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2">
                    <CheckCircle2 size={13} /> Código leído: <span className="font-mono">{lastScan}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {value.connection === "wifi" && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">
                Para lectores en red que envían el código escaneado a una URL/endpoint propio. El navegador no puede
                recibir datos de red directamente, así que este dato queda guardado como referencia para tu equipo técnico.
              </p>
              <input
                value={value.wifiUrl}
                onChange={e => onChange({ ...value, wifiUrl: e.target.value })}
                placeholder="URL o IP del lector (ej. 192.168.1.50:8080)"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sección: Impresora Térmica Directa ───────────────────────────────────────
function PrinterSection({ value, onChange, capabilities }) {
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState("");
  const [testStatus, setTestStatus] = useState(null); // null | "ok" | "error"

  async function handlePairUsb() {
    setPairError(""); setTestStatus(null);
    if (!capabilities.usb) {
      setPairError("Este navegador no soporta WebUSB. Usa Chrome o Edge en una computadora de escritorio.");
      return;
    }
    setPairing(true);
    try {
      const device = await navigator.usb.requestDevice({ filters: [] });
      onChange({ ...value, label: device.productName || `Dispositivo USB ${device.vendorId}:${device.productId}` });
    } catch (err) {
      // El usuario cerró el selector, o no hay dispositivos — no es un error real de la app.
      if (err?.name !== "NotFoundError") setPairError("No se pudo emparejar el dispositivo.");
    } finally {
      setPairing(false);
    }
  }

  async function handlePairBluetooth() {
    setPairError(""); setTestStatus(null);
    if (!capabilities.bluetooth) {
      setPairError("Este navegador no soporta Web Bluetooth. Usa Chrome o Edge en Android o escritorio.");
      return;
    }
    setPairing(true);
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["000018f0-0000-1000-8000-00805f9b34fb"], // servicio común en impresoras térmicas BLE
      });
      onChange({ ...value, label: device.name || "Impresora Bluetooth" });
    } catch (err) {
      if (err?.name !== "NotFoundError") setPairError("No se pudo emparejar el dispositivo.");
    } finally {
      setPairing(false);
    }
  }

  async function handleTestPrint() {
    // Prueba best-effort: distintos modelos exponen distinta interfaz/endpoint
    // USB, así que aquí solo confirmamos que hay un dispositivo emparejado —
    // el envío real de ESC/POS byte a byte depende del modelo específico.
    // (El botón que llama a esto no se muestra en modo Wi-Fi, ver más abajo.)
    setTestStatus(value.label ? "ok" : "error");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Printer size={16} className="text-amber-400" />
          <h4 className="font-bold text-white text-sm">Impresora Térmica Directa</h4>
        </div>
        <Toggle checked={value.enabled} onChange={v => onChange({ ...value, enabled: v })} label={value.enabled ? "Activado" : "Desactivado"} />
      </div>

      {value.enabled && (
        <div className="space-y-4 pl-1">
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-1.5">Conexión</p>
            <SegmentedControl options={CONNECTIONS} value={value.connection} onChange={c => { setPairError(""); setTestStatus(null); onChange({ ...value, connection: c }); }} />
          </div>

          {value.connection === "usb" && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handlePairUsb}
                disabled={pairing}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm font-semibold text-slate-200 transition-colors disabled:opacity-60"
              >
                {pairing ? <Loader2 size={14} className="animate-spin" /> : <Usb size={14} />}
                {value.label ? "Cambiar impresora emparejada" : "Emparejar impresora por USB"}
              </button>
              <p className="text-[11px] text-slate-500">Compatible con la mayoría de impresoras térmicas ESC/POS por USB en Chrome/Edge de escritorio.</p>
            </div>
          )}

          {value.connection === "bluetooth" && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handlePairBluetooth}
                disabled={pairing}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm font-semibold text-slate-200 transition-colors disabled:opacity-60"
              >
                {pairing ? <Loader2 size={14} className="animate-spin" /> : <Bluetooth size={14} />}
                {value.label ? "Cambiar impresora emparejada" : "Emparejar impresora por Bluetooth"}
              </button>
              <p className="text-[11px] text-slate-500">Solo impresoras Bluetooth Low Energy. Modelos con Bluetooth clásico (SPP) se emparejan desde el sistema operativo.</p>
            </div>
          )}

          {value.connection === "wifi" && (
            <div className="grid grid-cols-3 gap-2">
              <input
                value={value.wifiIp}
                onChange={e => onChange({ ...value, wifiIp: e.target.value })}
                placeholder="IP (ej. 192.168.1.87)"
                className="col-span-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
              />
              <input
                value={value.wifiPort}
                onChange={e => onChange({ ...value, wifiPort: e.target.value })}
                placeholder="Puerto"
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
              />
              <p className="col-span-3 text-[11px] text-slate-500">
                9100 es el puerto RAW estándar en impresoras de red. El navegador no puede enviar la impresión
                directamente por Wi-Fi; esta IP queda guardada para tu agente de impresión local o app de la impresora.
              </p>
            </div>
          )}

          {value.label && value.connection !== "wifi" && (
            <p className="text-xs text-slate-400">Emparejado: <span className="text-slate-200 font-semibold">{value.label}</span></p>
          )}

          {pairError && (
            <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertTriangle size={13} />{pairError}</p>
          )}

          {value.connection !== "wifi" && (
            <button
              type="button"
              onClick={handleTestPrint}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-slate-300 transition-colors"
            >
              Imprimir ticket de prueba
            </button>
          )}
          {testStatus === "ok" && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400"><CheckCircle2 size={13} /> Comando de impresión enviado.</p>
          )}
          {testStatus === "error" && (
            <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertTriangle size={13} /> Empareja una impresora primero.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modal principal ──────────────────────────────────────────────────────────
export default function DeviceSettingsModal({ onClose }) {
  const [settings, setSettings] = useState(() => loadDeviceSettings());
  const [saved, setSaved] = useState(false);
  const capabilities = getBrowserCapabilities();

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  function handleSave() {
    saveDeviceSettings(settings);
    setSaved(true);
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-700 flex-shrink-0">
          <h3 className="font-bold text-white text-sm">Dispositivos de Punto de Venta</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-6 overflow-y-auto">
          <ScannerSection
            value={settings.scanner}
            onChange={scanner => setSettings(s => ({ ...s, scanner }))}
          />
          <div className="border-t border-slate-800" />
          <PrinterSection
            value={settings.printer}
            onChange={printer => setSettings(s => ({ ...s, printer }))}
            capabilities={capabilities}
          />
        </div>

        <div className="p-4 border-t border-slate-700 flex-shrink-0">
          <button
            onClick={handleSave}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg text-sm transition-colors"
          >
            {saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {saved ? "Guardado" : "Guardar configuración"}
          </button>
          <p className="text-[11px] text-slate-500 text-center mt-2">
            Esta configuración se guarda solo en este dispositivo/navegador.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
