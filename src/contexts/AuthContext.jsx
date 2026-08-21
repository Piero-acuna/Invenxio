// ─────────────────────────────────────────────────────────────────────────────
// src/contexts/AuthContext.jsx — versión Supabase
//
// Mismo contrato público que la versión Firebase original (mismos nombres
// de campos y funciones en el value del Provider), así que InventorySystem.jsx,
// App.jsx, etc. no necesitan cambios.
//
// CAMBIO DE ARQUITECTURA IMPORTANTE — alta de empleados:
// En Firebase, registerEmployee() podía crear la cuenta de Auth del empleado
// directamente desde el navegador del Dueño (usando una "app secundaria" de
// Firebase). Supabase Auth NO tiene equivalente: crear la cuenta de OTRO
// usuario (supabase.auth.admin.createUser) requiere la service_role key, que
// nunca puede vivir en el navegador. Por eso registerEmployee() ahora llama
// a un endpoint propio (api/create-employee.js) que corre en el servidor,
// verifica que quien llama es el Dueño, y ahí sí usa el Admin SDK de
// Supabase. Es, de hecho, más seguro que el truco anterior.
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  createCompany,
  getUserProfile,
  createUserProfile,
  getCompanyProfile,
} from "../services/firestoreService";
import { getCountryConfig, LEGACY_DEFAULT_CONFIG } from "../config/countryConfig";
import { parseJsonResponse } from "../utils/errors";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null); // { uid, email, displayName, providerData... } normalizado desde session.user
  const [userProfile, setUserProfile] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [companyName, setCompanyName] = useState("");
  const [companyCurrency, setCompanyCurrency] = useState(LEGACY_DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  function normalizeUser(sessionUser) {
    if (!sessionUser) return null;
    const meta = sessionUser.user_metadata || {};
    return {
      uid: sessionUser.id,
      email: sessionUser.email,
      displayName: meta.name || meta.full_name || "",
      // Datos "pendientes" guardados en user_metadata al momento de
      // signUp() — sobreviven aunque el correo se confirme en otro
      // dispositivo/navegador (a diferencia de localStorage), porque viven
      // en el propio usuario de Supabase Auth, no en el navegador.
      pendingCompanyName: meta.pendingCompanyName || null,
      pendingCountry: meta.pendingCountry || null,
      pendingJoinCompanyId: meta.pendingJoinCompanyId || null,
      providerData: (sessionUser.identities || []).map((i) => ({ providerId: i.provider === "google" ? "google.com" : i.provider })),
      getIdToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
    };
  }

  function isGoogleUser(user) {
    return !!user.providerData?.some((p) => p.providerId === "google.com");
  }

  /** Crea la empresa tolerando una segunda llamada concurrente (dos pestañas,
   *  reintentos, StrictMode) — si ya existe (unique_violation), no falla. */
  async function safeCreateCompany(params) {
    try {
      await createCompany(params);
    } catch (err) {
      const msg = String(err?.message || "");
      if (!/duplicate key|already exists|23505/i.test(msg)) throw err;
    }
  }

  /** Igual que arriba, pero para unirse como empleado a una empresa existente. */
  async function safeCreateUserProfile(params) {
    try {
      await createUserProfile(params);
    } catch (err) {
      const msg = String(err?.message || "");
      if (!/duplicate key|already exists|23505/i.test(msg)) throw err;
    }
  }

  /** Limpia los campos "pending*" de user_metadata — best-effort, si falla
   *  no es grave (en el peor caso se reintenta la próxima vez, y
   *  safeCreateCompany/safeCreateUserProfile ya toleran ese reintento). */
  async function clearPendingMetadata(fields) {
    const data = {};
    fields.forEach((f) => { data[f] = null; });
    await supabase.auth.updateUser({ data }).catch(() => {});
  }

  const loadProfile = useCallback(async function loadProfile(user, attempt = 0) {
    try {
      let profile = await getUserProfile(user.uid);

      if (!profile) {
        if (isGoogleUser(user) && attempt === 0) {
          // Primera vez con Google: creamos la empresa automáticamente.
          await safeCreateCompany({
            companyName: user.displayName ? `Empresa de ${user.displayName.split(" ")[0]}` : "Mi Empresa",
            ownerUid: user.uid,
            ownerName: user.displayName || "Propietario",
            ownerEmail: user.email,
          });
          profile = await getUserProfile(user.uid);
        } else if (user.pendingCompanyName && attempt === 0) {
          // register() con confirmación de correo ACTIVADA: en el momento del
          // signUp() no había sesión todavía, así que la empresa no se pudo
          // crear ahí. Ahora que el usuario confirmó su correo y ya tiene
          // sesión real, terminamos de crearla con los datos que quedaron
          // guardados en user_metadata desde register().
          await safeCreateCompany({
            companyName: user.pendingCompanyName,
            ownerUid: user.uid,
            ownerName: user.displayName || "Propietario",
            ownerEmail: user.email,
            country: user.pendingCountry || "PE",
          });
          await clearPendingMetadata(["pendingCompanyName", "pendingCountry"]);
          profile = await getUserProfile(user.uid);
        } else if (user.pendingJoinCompanyId && attempt === 0) {
          // Mismo caso, pero para joinCompany() (empleado auto-invitado).
          await safeCreateUserProfile({
            uid: user.uid,
            name: user.displayName,
            email: user.email,
            companyId: user.pendingJoinCompanyId,
            role: "empleado",
          });
          await clearPendingMetadata(["pendingJoinCompanyId"]);
          profile = await getUserProfile(user.uid);
        } else if (attempt < 4) {
          // Posible condición de carrera con register() todavía escribiendo
          // el perfil (create_company() es una sola RPC atómica, pero puede
          // no haber terminado de resolver cuando llega este listener).
          await new Promise((r) => setTimeout(r, 600));
          return loadProfile(user, attempt + 1);
        } else {
          setAuthError("Esta cuenta no tiene una empresa asociada. Si eras empleado, pide al Dueño que te registre de nuevo.");
          await supabase.auth.signOut();
          return;
        }
      }

      if (profile && profile.active === false) {
        setAuthError("Tu cuenta fue desactivada. Contacta al dueño de la empresa.");
        await supabase.auth.signOut();
        return;
      }

      if (profile) {
        setUserProfile(profile);
        setCompanyId(profile.companyId);
        const company = await getCompanyProfile(profile.companyId);
        setCompanyName(company?.name || "Mi Empresa");
        setCompanyCurrency(
          company?.paymentGateway
            ? {
                country: company.country,
                paymentGateway: company.paymentGateway,
                currencyCode: company.currencyCode,
                currencySymbol: company.currencySymbol,
              }
            : LEGACY_DEFAULT_CONFIG
        );
      }
    } catch (err) {
      console.error("Error cargando perfil:", err);
      // Postgrest/RLS deniega con un mensaje distinto al de Firestore, pero
      // el mismo espíritu aplica: si esto pasa con reglas bien configuradas,
      // es casi seguro un desajuste entre las políticas RLS publicadas y lo
      // que la app necesita leer (tabla users/companies).
      setAuthError("Error al leer tu perfil: revisa que las políticas RLS publicadas coincidan con el esquema de la app.");
      await supabase.auth.signOut().catch(() => {});
    }
  }, []); // sin dependencias: solo cierra sobre setters de estado (identidad
  // estable) e imports del módulo, nunca sobre props/state — por eso es
  // seguro fijar sus deps en [] y no rompe el patrón "correr una vez al
  // montar" del useEffect que la usa más abajo.

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession();
      const user = normalizeUser(session?.user);
      setCurrentUser(user);
      if (user) await loadProfile(user);
      if (mounted) setLoading(false);
    }
    bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const user = normalizeUser(session?.user);
      setCurrentUser(user);
      if (user) {
        await loadProfile(user);
      } else {
        setUserProfile(null);
        setCompanyId(null);
        setCompanyName("");
        setCompanyCurrency(LEGACY_DEFAULT_CONFIG);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  async function login(email, password) {
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(friendlyError(error));
      throw error;
    }
  }

  async function loginWithGoogle() {
    setAuthError("");
    // A diferencia de signInWithPopup de Firebase, Supabase redirige la
    // pestaña completa a Google y vuelve a `redirectTo` — no hay popup.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setAuthError(friendlyError(error));
      throw error;
    }
    // El resto (crear perfil/empresa la primera vez) ocurre en loadProfile()
    // cuando el listener onAuthStateChange dispare tras volver del redirect.
  }

  async function register(email, password, name, companyNameInput, country = "PE") {
    setAuthError("");
    try {
      // pendingCompanyName/pendingCountry quedan en user_metadata (server-side,
      // en Supabase Auth) para que, si la confirmación de correo está
      // ACTIVADA y todavía no hay sesión, loadProfile() pueda terminar de
      // crear la empresa apenas el usuario confirme el correo e inicie
      // sesión — sin importar en qué dispositivo/navegador confirme.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, pendingCompanyName: companyNameInput, pendingCountry: country } },
      });
      if (error) throw error;
      if (data.session) {
        // Confirmación de correo DESACTIVADA: ya hay sesión, creamos la
        // empresa de inmediato y limpiamos el "pendiente" que acabamos de
        // guardar (ya no hace falta, se usó al toque).
        await createCompany({ companyName: companyNameInput, ownerUid: data.user.id, ownerName: name, ownerEmail: email, country });
        await clearPendingMetadata(["pendingCompanyName", "pendingCountry"]);
        setUserProfile({ id: data.user.id, name, email, companyId: data.user.id, role: "owner", active: true });
        setCompanyId(data.user.id);
        setCompanyName(companyNameInput);
        setCompanyCurrency(getCountryConfig(country));
      } else {
        setAuthError("Te enviamos un correo de confirmación. Confírmalo y vuelve a iniciar sesión — terminaremos de crear tu empresa automáticamente.");
      }
    } catch (err) {
      setAuthError(friendlyError(err));
      throw err;
    }
  }

  /**
   * El Dueño registra a un nuevo empleado. Llama a un endpoint del servidor
   * (service_role) porque el cliente no puede crear la cuenta de otro
   * usuario — ver nota de arquitectura al inicio del archivo.
   */
  async function registerEmployee(email, password, name, permissions) {
    setAuthError("");
    if (!companyId) {
      const err = new Error("No hay una empresa activa para registrar empleados.");
      setAuthError(err.message);
      throw err;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/create-employee", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ email, password, name, permissions, companyId }),
    });
    const json = await parseJsonResponse(res);
    if (!res.ok || !json.ok) {
      const message = json?.error || "No se pudo registrar al empleado.";
      setAuthError(message);
      throw new Error(message);
    }
    return json.uid;
  }

  async function joinCompany(email, password, name, targetCompanyId) {
    setAuthError("");
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { name, pendingJoinCompanyId: targetCompanyId } },
      });
      if (error) throw error;
      if (data.session) {
        await createUserProfile({ uid: data.user.id, name, email, companyId: targetCompanyId, role: "empleado" });
        await clearPendingMetadata(["pendingJoinCompanyId"]);
      } else {
        setAuthError("Te enviamos un correo de confirmación. Confírmalo y vuelve a iniciar sesión para unirte a la empresa.");
      }
    } catch (err) {
      setAuthError(friendlyError(err));
      throw err;
    }
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  async function resetPassword(email) {
    setAuthError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) {
      setAuthError(friendlyError(error));
      throw error;
    }
  }

  const friendlyError = useCallback((err) => {
    const code = err?.code || err?.message || "";
    const map = {
      "invalid_credentials": "Correo o contraseña incorrectos.",
      "user_already_exists": "Ese correo ya está registrado.",
      "weak_password": "La contraseña debe tener al menos 6 caracteres.",
      "email_not_confirmed": "Confirma tu correo antes de iniciar sesión.",
      "over_request_rate_limit": "Demasiados intentos. Intenta más tarde.",
    };
    if (map[code]) return map[code];
    if (/invalid login credentials/i.test(code)) return "Correo o contraseña incorrectos.";
    if (/already registered/i.test(code)) return "Ese correo ya está registrado.";
    if (/network/i.test(code)) return "Error de red. Verifica tu conexión.";
    return "Ocurrió un error. Inténtalo de nuevo.";
  }, []);

  return (
    <AuthContext.Provider
      value={{
        currentUser, userProfile, companyId, companyName, companyCurrency,
        loading, authError, setAuthError,
        login, loginWithGoogle, register, joinCompany, registerEmployee, logout, resetPassword,
        setCompanyCurrency,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// useAuth vive junto a AuthProvider intencionalmente (patrón estándar de
// Context + hook); separarlo en otro archivo solo para Fast Refresh
// tocaría los 14 archivos que lo importan sin cambiar ningún comportamiento.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
