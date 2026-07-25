// ─────────────────────────────────────────────────────────────────────────────
// src/components/PaywallScreen.jsx
// Pantalla de bloqueo TOTAL cuando la prueba gratis terminó o el plan pagado
// venció. Reemplaza el contenido de la app (el header con "Cerrar sesión"
// sigue visible, así nadie queda atrapado sin poder salir).
//
// Solo el Dueño ve el botón de pago — un empleado ve un aviso pidiéndole que
// contacte al Dueño, porque la tarjeta y la decisión de pagar son de él.
//
// El pago se procesa con el widget "Culqi Checkout" (carga su script solo
// cuando esta pantalla aparece, no en el bundle principal). El token que
// entrega Culqi NO es un pago confirmado — es solo una referencia de tarjeta
// segura; el cobro real y la actualización de "ya pagó" ocurren en el
// backend (api/culqi-charge.js), nunca en este componente. Ver ese archivo
// para el porqué.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { Lock, CreditCard, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

const CULQI_SCRIPT_URL = "https://checkout.culqi.com/js/v4";
const PLAN_AMOUNT_SOLES = 54.99; // S/ 54.99 al mes — ajusta este número a tu precio real
const PLAN_AMOUNT_CENTS = PLAN_AMOUNT_SOLES * 100; // Culqi cobra en céntimos

function loadCulqiScript() {
  return new Promise((resolve, reject) => {
    if (window.Culqi) return resolve();
    const existing = document.querySelector(`script[src="${CULQI_SCRIPT_URL}"]`);
    if (existing) { existing.addEventListener("load", resolve); return; }
    const script = document.createElement("script");
    script.src = CULQI_SCRIPT_URL;
    script.onload = resolve;
    script.onerror = () => reject(new Error("No se pudo cargar Culqi. Revisa tu conexión."));
    document.body.appendChild(script);
  });
}

export default function PaywallScreen({ isOwner, companyId, companyName, getIdToken, reason }) {
  const [status, setStatus] = useState("idle"); // idle | loading-widget | charging | error | success
  const [errorMsg, setErrorMsg] = useState("");
  const callbackRef = useRef(null);

  // Culqi Checkout llama a una función global window.culqi() cuando el
  // usuario termina de llenar el formulario de tarjeta — la registramos acá
  // y la limpiamos al desmontar para no dejar basura en `window`.
  useEffect(() => {
    window.culqi = () => {
      if (window.Culqi.token) {
        callbackRef.current?.(window.Culqi.token.id);
      } else if (window.Culqi.order) {
        callbackRef.current?.(null, "El pago no se completó. Intenta de nuevo.");
      } else {
        callbackRef.current?.(null, window.Culqi?.error?.user_message || "El pago fue rechazado. Intenta con otra tarjeta.");
      }
    };
    return () => { delete window.culqi; };
  }, []);

  async function handlePay() {
    setErrorMsg("");
    setStatus("loading-widget");
    try {
      await loadCulqiScript();
      const publicKey = import.meta.env.VITE_CULQI_PUBLIC_KEY;
      if (!publicKey) {
        setStatus("error");
        setErrorMsg("Falta configurar VITE_CULQI_PUBLIC_KEY en las variables de entorno.");
        return;
      }
      window.Culqi.publicKey = publicKey;
      window.Culqi.settings({
        title: companyName || "Invenxio",
        currency: "PEN",
        amount: PLAN_AMOUNT_CENTS,
      });
      window.Culqi.options({
        lang: "auto",
        installments: false,
        paymentMethods: { tarjeta: true, yape: true, billetera: false, bancaMovil: false, agente: false, cuotealo: false },
      });

      callbackRef.current = async (token, err) => {
        if (err || !token) {
          setStatus("error");
          setErrorMsg(err || "No se recibió el token de pago.");
          return;
        }
        setStatus("charging");
        try {
          const idToken = await getIdToken();
          const res = await fetch("/api/culqi-charge", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ token, companyId }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || "El cobro no se pudo confirmar.");
          setStatus("success");
          // No hace falta recargar nada: el listener de suscripción en
          // InventorySystem.jsx detecta el cambio en Firestore (escrito por
          // el backend) y esta pantalla desaparece sola en cuanto llegue.
        } catch (e) {
          console.error(e);
          setStatus("error");
          setErrorMsg(e.message || "No se pudo confirmar el pago. Si tu tarjeta fue cargada, contáctanos.");
        }
      };

      setStatus("idle");
      window.Culqi.open();
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "No se pudo abrir la ventana de pago.");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-24 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-4">
        <Lock size={24} className="text-amber-400" />
      </div>
      <h2 className="text-lg sm:text-xl font-bold text-white mb-1.5">
        {reason === "trial" ? "Tu prueba gratis terminó" : "Tu suscripción venció"}
      </h2>
      <p className="text-sm text-slate-400 max-w-sm mb-6">
        {isOwner
          ? "Para seguir usando Invenxio, activa tu plan mensual. Tus datos siguen guardados y seguros — no se pierde nada."
          : "Pídele al Dueño de tu empresa que renueve la suscripción para poder seguir trabajando aquí."}
      </p>

      {isOwner && (
        <>
          {status === "success" ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
              <CheckCircle2 size={18} />¡Pago confirmado! Actualizando acceso…
            </div>
          ) : (
            <button
              onClick={handlePay}
              disabled={status === "loading-widget" || status === "charging"}
              className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-wait text-slate-900 font-bold text-sm rounded-xl transition-colors shadow-lg shadow-amber-500/20"
            >
              {status === "loading-widget" || status === "charging"
                ? <Loader2 size={16} className="animate-spin" />
                : <CreditCard size={16} />}
              {status === "charging" ? "Confirmando pago…" : `Pagar S/ ${PLAN_AMOUNT_SOLES}.00 / mes`}
            </button>
          )}
          {errorMsg && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 mt-3 max-w-sm">
              <AlertCircle size={13} className="flex-shrink-0" />{errorMsg}
            </div>
          )}
          <p className="text-[11px] text-slate-600 mt-4">Pago seguro procesado por Culqi · tarjeta o Yape</p>
        </>
      )}
    </div>
  );
}
