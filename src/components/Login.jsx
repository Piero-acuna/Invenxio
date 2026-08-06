// ─────────────────────────────────────────────────────────────────────────────
// src/components/auth/Login.jsx  —  Invenxio
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import {
  Mail, Lock, User, Building2, Eye, EyeOff,
  ArrowRight, RefreshCw, AlertCircle, CheckCircle,
  ChevronLeft, Layers, Globe,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { COUNTRIES } from "../config/countryConfig";

// ── Ícono Google SVG ──────────────────────────────────────────────────────────
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// ── Campo de formulario ───────────────────────────────────────────────────────
const Field = ({ label, icon, error, children }) => (
  <div>
    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
      {label}
    </label>
    <div className="relative">
      {icon && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
          {icon}
        </span>
      )}
      {children}
    </div>
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

// ── Input estándar ────────────────────────────────────────────────────────────
const Input = ({ icon, error, ...props }) => (
  <input
    {...props}
    autoComplete="off"
    className={`w-full ${icon ? "pl-9" : "pl-3"} pr-4 py-2.5 bg-slate-800 border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none transition-colors ${
      error ? "border-red-500 focus:border-red-400" : "border-slate-700 focus:border-amber-500"
    }`}
  />
);

// ════════════════════════════════════════════════════════════════════════════
export default function Login() {
  const { login, loginWithGoogle, register, resetPassword, authError, setAuthError } = useAuth();

  const [mode,        setMode]        = useState("login"); // "login" | "register" | "reset"
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [name,        setName]        = useState("");
  const [company,     setCompany]     = useState("");
  // País de la empresa: define la moneda (soles/dólares) y la pasarela de
  // pago (Culqi para Perú, Mercado Pago para el resto) de toda la cuenta.
  // Ver src/config/countryConfig.js.
  const [country,     setCountry]     = useState("PE");
  const [showPass,    setShowPass]    = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [googleLoad,  setGoogleLoad]  = useState(false);
  const [success,     setSuccess]     = useState("");
  const [errors,      setErrors]      = useState({});

  const clear = () => { setErrors({}); setAuthError(""); setSuccess(""); };
  const switchMode = (m) => { setMode(m); clear(); };

  function validate() {
    const e = {};
    if (!email)                               e.email    = "El correo es requerido";
    else if (!/\S+@\S+\.\S+/.test(email))     e.email    = "Correo inválido";
    if (mode !== "reset") {
      if (!password)                          e.password = "La contraseña es requerida";
    }
    if (mode === "register") {
      if (!name)                              e.name     = "Tu nombre es requerido";
      if (!company)                           e.company  = "El nombre de la empresa es requerido";
      if (password.length < 6)               e.password = "Mínimo 6 caracteres";
      if (password !== confirmPass)          e.confirm  = "Las contraseñas no coinciden";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    clear();
    if (mode === "reset") {
      if (!email) { setErrors({ email: "El correo es requerido" }); return; }
      setLoading(true);
      try {
        await resetPassword(email);
        setSuccess("¡Enlace enviado! Revisa tu bandeja de entrada.");
      } catch {}
      setLoading(false);
      return;
    }
    if (!validate()) return;
    setLoading(true);
    try {
      if (mode === "login")    await login(email, password);
      if (mode === "register") await register(email, password, name, company, country);
    } catch {}
    setLoading(false);
  }

  async function handleGoogle() {
    clear();
    setGoogleLoad(true);
    try {
      await loginWithGoogle();
    } catch {}
    setGoogleLoad(false);
  }

  const titles = {
    login:    "Iniciar Sesión",
    register: "Crear Cuenta",
    reset:    "Recuperar Contraseña",
  };

  return (
    <div
      className="min-h-screen bg-slate-950 flex items-center justify-center p-4"
      style={{ fontFamily: "'IBM Plex Sans','DM Sans',system-ui,sans-serif" }}
    >
      {/* Fondo decorativo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0" style={{
          backgroundImage:
            "linear-gradient(rgba(251,191,36,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(251,191,36,.03) 1px,transparent 1px)",
          backgroundSize: "40px 40px",
        }} />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-amber-500/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-500 rounded-2xl shadow-lg shadow-amber-500/30 mb-4">
            <Layers size={26} className="text-slate-900" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            <span className="text-white">Inven</span>
            <span className="text-amber-400">xio</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-mono uppercase tracking-widest">
            Gestión de Inventarios
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">

          {/* Back button */}
          {mode !== "login" && (
            <button
              onClick={() => switchMode("login")}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 mb-5 transition-colors"
            >
              <ChevronLeft size={14} /> Volver
            </button>
          )}

          <div className="mb-5">
            <h2 className="text-lg font-bold text-white">{titles[mode]}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {mode === "login"    && "Accede a tu panel de inventario"}
              {mode === "register" && "Crea tu empresa en Invenxio"}
              {mode === "reset"    && "Te enviaremos un enlace a tu correo"}
            </p>
          </div>

          {/* Error global */}
          {authError && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg mb-4 text-xs text-red-400">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />{authError}
            </div>
          )}

          {/* Éxito */}
          {success && (
            <div className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg mb-4 text-xs text-emerald-400">
              <CheckCircle size={14} className="flex-shrink-0 mt-0.5" />{success}
            </div>
          )}

          {/* ── BOTÓN GOOGLE (solo en login y register) ── */}
          {mode !== "reset" && (
            <>
              <button
                onClick={handleGoogle}
                disabled={googleLoad}
                className="w-full flex items-center justify-center gap-3 py-2.5 bg-white hover:bg-gray-100 disabled:bg-slate-700 disabled:text-slate-500 text-gray-700 font-semibold text-sm rounded-xl border border-slate-200 transition-colors shadow-sm mb-4"
              >
                {googleLoad
                  ? <RefreshCw size={16} className="animate-spin text-slate-400" />
                  : <GoogleIcon />
                }
                {googleLoad ? "Conectando…" : "Continuar con Google"}
              </button>

              {/* Separador */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-slate-700/80" />
                <span className="text-xs text-slate-600 font-medium">o</span>
                <div className="flex-1 h-px bg-slate-700/80" />
              </div>
            </>
          )}

          {/* ── FORMULARIO ── */}
          <div className="space-y-4" onKeyDown={e => e.key === "Enter" && handleSubmit()}>

            {mode === "register" && (
              <>
                <Field label="Tu nombre" icon={<User size={14} />} error={errors.name}>
                  <Input icon value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Juan García" error={errors.name} />
                </Field>
                <Field label="Nombre de la empresa" icon={<Building2 size={14} />} error={errors.company}>
                  <Input icon value={company} onChange={e => setCompany(e.target.value)} placeholder="Ej: Distribuidora Lima SAC" error={errors.company} />
                </Field>
                <Field label="País de la empresa" icon={<Globe size={14} />}>
                  <div className="relative">
                    <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <select
                      value={country}
                      onChange={e => setCountry(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 focus:border-amber-500 rounded-lg text-sm text-slate-200 focus:outline-none transition-colors appearance-none"
                    >
                      {COUNTRIES.map(c => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {country === "PE"
                      ? "Se te cobrará en soles (S/) a través de Culqi."
                      : "Se te cobrará en dólares ($) a través de Mercado Pago."}
                  </p>
                </Field>
              </>
            )}

            <Field label="Correo electrónico" icon={<Mail size={14} />} error={errors.email}>
              <Input icon type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@empresa.com" error={errors.email} />
            </Field>

            {mode !== "reset" && (
              <Field label="Contraseña" error={errors.password}>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`w-full pl-9 pr-10 py-2.5 bg-slate-800 border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none transition-colors ${errors.password ? "border-red-500" : "border-slate-700 focus:border-amber-500"}`}
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-red-400 mt-1">{errors.password}</p>}
              </Field>
            )}

            {mode === "register" && (
              <Field label="Confirmar contraseña" error={errors.confirm}>
                <input
                  type={showPass ? "text" : "password"}
                  value={confirmPass}
                  onChange={e => setConfirmPass(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full pl-3 pr-4 py-2.5 bg-slate-800 border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none transition-colors ${errors.confirm ? "border-red-500" : "border-slate-700 focus:border-amber-500"}`}
                />
                {errors.confirm && <p className="text-xs text-red-400 mt-1">{errors.confirm}</p>}
              </Field>
            )}
          </div>

          {/* Olvidé contraseña */}
          {mode === "login" && (
            <div className="text-right mt-2 mb-1">
              <button onClick={() => switchMode("reset")}
                className="text-xs text-slate-500 hover:text-amber-400 transition-colors">
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="mt-5 w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
          >
            {loading
              ? <><RefreshCw size={16} className="animate-spin" />Procesando…</>
              : <>{titles[mode]}<ArrowRight size={16} /></>
            }
          </button>

          {/* Cambiar modo */}
          <div className="mt-5 pt-4 border-t border-slate-800 text-center">
            {mode === "login" ? (
              <p className="text-xs text-slate-500">
                ¿No tienes cuenta?{" "}
                <button onClick={() => switchMode("register")} className="text-amber-400 hover:text-amber-300 font-semibold transition-colors">
                  Crear empresa nueva
                </button>
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                ¿Ya tienes cuenta?{" "}
                <button onClick={() => switchMode("login")} className="text-amber-400 hover:text-amber-300 font-semibold transition-colors">
                  Iniciar sesión
                </button>
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          Cada empresa tiene su propio espacio aislado de datos
        </p>
      </div>
    </div>
  );
}