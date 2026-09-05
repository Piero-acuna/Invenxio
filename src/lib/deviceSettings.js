// ─────────────────────────────────────────────────────────────────────────────
// src/lib/deviceSettings.js
// Helpers puros (sin React) para la configuración de hardware de punto de
// venta: lector de código de barras (1D/2D) e impresora térmica directa.
//
// A diferencia de los datos de la empresa (productos, ventas, permisos…) que
// viven en Supabase, esta configuración describe el HARDWARE FÍSICO conectado
// a ESTA computadora/terminal — dos cajas de la misma empresa pueden tener
// impresoras o lectores distintos. Por eso se guarda en localStorage y nunca
// se sincroniza entre dispositivos.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "invenxio_device_settings_v1";

const DEFAULT_SETTINGS = {
  scanner: {
    enabled: false,
    type: "2d",          // "1d" | "2d"
    connection: "usb",   // "usb" | "bluetooth" | "wifi"
    label: "",           // nombre descriptivo (ej. "Honeywell 1900" o el nombre del dispositivo Bluetooth emparejado)
    wifiUrl: "",         // solo si connection === "wifi": URL/endpoint al que el lector envía el código escaneado
  },
  printer: {
    enabled: false,
    connection: "usb",   // "usb" | "bluetooth" | "wifi"
    label: "",           // nombre descriptivo / dispositivo USB o Bluetooth emparejado
    wifiIp: "",          // solo si connection === "wifi"
    wifiPort: "9100",    // puerto estándar RAW/ESC-POS en impresoras de red
  },
};

/** Lee la configuración guardada, o los valores por defecto si no hay nada aún. */
function loadDeviceSettings() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      scanner: { ...DEFAULT_SETTINGS.scanner, ...(parsed.scanner || {}) },
      printer: { ...DEFAULT_SETTINGS.printer, ...(parsed.printer || {}) },
    };
  } catch (err) {
    console.warn("No se pudo leer la configuración de dispositivos:", err);
    return DEFAULT_SETTINGS;
  }
}

/** Guarda la configuración completa. */
function saveDeviceSettings(settings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("No se pudo guardar la configuración de dispositivos:", err);
  }
}

/** Soporte del navegador actual para cada API de emparejamiento. */
function getBrowserCapabilities() {
  if (typeof navigator === "undefined") {
    return { usb: false, bluetooth: false };
  }
  return {
    usb: "usb" in navigator,
    bluetooth: "bluetooth" in navigator,
  };
}

export { DEFAULT_SETTINGS, loadDeviceSettings, saveDeviceSettings, getBrowserCapabilities, STORAGE_KEY };
