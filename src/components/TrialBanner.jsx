// ─────────────────────────────────────────────────────────────────────────────
// src/components/TrialBanner.jsx
// Franja informativa (NO bloquea nada) que se muestra mientras la prueba
// gratis sigue activa, para que el Dueño no se lleve la sorpresa el día que
// se corta el acceso. Cambia de tono cuando quedan pocos días.
// ─────────────────────────────────────────────────────────────────────────────
import { Sparkles } from "lucide-react";

export default function TrialBanner({ daysLeft, isOwner }) {
  if (daysLeft == null) return null;
  const urgent = daysLeft <= 3;

  return (
    <div className={`flex items-center justify-center gap-2 text-xs sm:text-sm font-medium py-2 px-3 border-b ${
      urgent ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-slate-800/60 border-slate-700/50 text-slate-400"
    }`}>
      <Sparkles size={13} className="flex-shrink-0" />
      {daysLeft === 0
        ? "Tu prueba gratis termina hoy."
        : `Te quedan ${daysLeft} día${daysLeft === 1 ? "" : "s"} de prueba gratis.`}
      {isOwner && urgent && <span className="hidden sm:inline">Activa tu plan cuando quieras, desde el aviso que aparecerá al vencer.</span>}
    </div>
  );
}
