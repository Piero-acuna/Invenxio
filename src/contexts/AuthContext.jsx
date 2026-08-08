// ─────────────────────────────────────────────────────────────────────────────
// src/contexts/AuthContext.jsx
//
// Métodos disponibles:
//   login(email, password)           — correo + contraseña
//   loginWithGoogle()                — Google OAuth popup
//   register(email,password,name,companyName)
//   logout() / resetPassword(email)
//
// Para activar Google: Firebase Console → Authentication →
//   Sign-in method → Google → Habilitar → guardar dominio autorizado.
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useEffect, useState } from "react";
import { initializeApp, getApp, deleteApp } from "firebase/app";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  getAuth,
  setPersistence,
  inMemoryPersistence,
} from "firebase/auth";
import { auth } from "../firebase/config";
import {
  createCompany,
  getUserProfile,
  createUserProfile,
  getCompanyProfile,
  updateUserPermissions,
} from "../services/firestoreService";
import { defaultPermissions } from "../config/permissions";
import { getCountryConfig, LEGACY_DEFAULT_CONFIG } from "../config/countryConfig";

const AuthContext    = createContext(null);
const googleProvider = new GoogleAuthProvider();

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [companyId,   setCompanyId]   = useState(null);
  const [companyName, setCompanyName] = useState("");
  // Moneda/pasarela de pago de la empresa, calculadas UNA vez a partir del
  // país elegido al registrarse (ver countryConfig.js). Se exponen acá,
  // globalmente, para que cualquier componente de la app (inventario,
  // ventas, comprobantes, PaywallScreen…) pueda mostrar el símbolo correcto
  // sin tener que ir a buscarlo cada uno por su cuenta. Empresas viejas sin
  // estos campos guardados caen en LEGACY_DEFAULT_CONFIG (soles + Culqi),
  // que es exactamente el comportamiento que ya tenían antes de este cambio.
  const [companyCurrency, setCompanyCurrency] = useState(LEGACY_DEFAULT_CONFIG);
  const [loading,     setLoading]     = useState(true);
  const [authError,   setAuthError]   = useState("");

  // ¿Esta cuenta inició sesión alguna vez con Google?
  function isGoogleUser(user) {
    return !!user.providerData?.some(p => p.providerId === "google.com");
  }

  // Carga o crea perfil del usuario
  async function loadProfile(user, attempt = 0) {
    try {
      let profile = await getUserProfile(user.uid);

      if (!profile) {
        if (isGoogleUser(user) && attempt === 0) {
          // Primera vez con Google: SÍ creamos la empresa automáticamente
          // (no hay otro formulario de registro para este caso).
          await createCompany({
            companyName: user.displayName
              ? `Empresa de ${user.displayName.split(" ")[0]}`
              : "Mi Empresa",
            ownerUid:   user.uid,
            ownerName:  user.displayName || "Propietario",
            ownerEmail: user.email,
          });
          profile = await getUserProfile(user.uid);
        } else if (attempt < 4) {
          // Puede ser una condición de carrera: register() (correo y
          // contraseña) puede seguir escribiendo el perfil en Firestore en
          // este mismo instante. Reintentamos un par de veces antes de
          // rendirnos, EN VEZ de crear una empresa nueva — esto era lo que
          // a veces hacía que el Dueño apareciera como Empleado de una
          // empresa vacía creada por error.
          await new Promise(r => setTimeout(r, 600));
          return loadProfile(user, attempt + 1);
        } else {
          // Después de varios intentos sigue sin existir perfil: la cuenta
          // de Firebase Auth existe pero su perfil de Firestore fue borrado
          // a propósito (ej. un empleado eliminado a mano desde la consola).
          // NO se le crea una empresa nueva — se expulsa con un mensaje claro.
          setAuthError("Esta cuenta no tiene una empresa asociada. Si eras empleado, pide al Dueño que te registre de nuevo.");
          await signOut(auth);
          return;
        }
      }

      // Cuenta de empleado desactivada por el Dueño → se expulsa de inmediato
      if (profile && profile.active === false) {
        setAuthError("Tu cuenta fue desactivada. Contacta al dueño de la empresa.");
        await signOut(auth);
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
      if (err.code === "permission-denied") {
        // Esto no significa "sin permisos asignados" — significa que las
        // REGLAS de Firestore no coinciden con lo que la app necesita leer
        // (users/{uid}, companies/{companyId}/...). Avisamos explícito en
        // vez de dejar al usuario viendo el mensaje genérico de permisos.
        setAuthError("Error de reglas de Firestore: revisa que las reglas publicadas coincidan con la estructura de la app (users/, companies/).");
      }
      await signOut(auth).catch(() => {});
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
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
    return unsub;
  }, []);

  async function login(email, password) {
    setAuthError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setAuthError(friendlyError(err.code)); throw err;
    }
  }

  async function loginWithGoogle() {
    setAuthError("");
    try {
      await signInWithPopup(auth, googleProvider);
      // onAuthStateChanged → loadProfile se ejecuta automáticamente
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        setAuthError(friendlyError(err.code));
      }
      throw err;
    }
  }

  async function register(email, password, name, companyNameInput, country = "PE") {
    setAuthError("");
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName: name });
      await createCompany({
        companyName: companyNameInput,
        ownerUid:    user.uid,
        ownerName:   name,
        ownerEmail:  email,
        country,
      });
      // Fijamos el perfil de inmediato (en vez de esperar a que el listener
      // onAuthStateChanged lo vuelva a leer) para que no haya ninguna ventana
      // de tiempo en la que el Dueño recién creado se vea sin perfil/rol.
      setUserProfile({ id: user.uid, name, email, companyId: user.uid, role: "owner", active: true });
      setCompanyId(user.uid);
      setCompanyName(companyNameInput);
      setCompanyCurrency(getCountryConfig(country));
    } catch (err) {
      setAuthError(friendlyError(err.code)); throw err;
    }
  }

  /**
   * El Dueño (o un Administrador) registra a un nuevo empleado: crea su
   * cuenta de Firebase Auth y su perfil en Firestore con el rol asignado.
   *
   * IMPORTANTE: createUserWithEmailAndPassword inicia sesión automáticamente
   * como el usuario recién creado en la instancia de Auth que se le pase.
   * Para que el Dueño NO sea desconectado al registrar a su empleado, esta
   * función usa una app secundaria de Firebase, exclusiva para esta
   * operación, y la destruye apenas termina.
   */
  async function registerEmployee(email, password, name, permissions = defaultPermissions()) {
    setAuthError("");
    if (!companyId) {
      const err = new Error("No hay una empresa activa para registrar empleados.");
      setAuthError(err.message);
      throw err;
    }
    const secondaryApp = initializeApp(getApp().options, `Empleado-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);
    try {
      // CRÍTICO: por defecto Firebase Auth persiste la sesión en IndexedDB,
      // y ese almacenamiento se comparte entre TODAS las instancias de Auth
      // del navegador (aunque sean apps distintas). Sin esta línea, la
      // sesión del empleado recién creado "se filtra" hacia la sesión
      // principal del Dueño y AuthContext, al no encontrar su perfil aún,
      // termina creándole una empresa nueva y marcándolo como "owner".
      // Con inMemoryPersistence esa sesión nunca toca el almacenamiento
      // compartido, así que no puede filtrarse.
      await setPersistence(secondaryAuth, inMemoryPersistence);
      const { user } = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await updateProfile(user, { displayName: name });
      // El alta SIEMPRE se crea con los permisos por defecto: firestore.rules
      // exige esto en la creación de users/{uid} para que nadie que conozca
      // el companyId pueda autoasignarse permisos altos al registrarse (esa
      // escritura ocurre autenticada como el propio empleado nuevo, no como
      // el Dueño — ver el comentario en la regla "create" de users/{uid}).
      await createUserProfile({ uid: user.uid, name, email, companyId, role: "empleado", permissions: defaultPermissions() });
      // Los permisos reales elegidos en el formulario se aplican acá, en un
      // segundo paso — este updateDoc SÍ corre autenticado como el Dueño (la
      // sesión principal, `auth`, nunca se tocó), que es el único que las
      // reglas dejan elevar los permisos de un empleado.
      await updateUserPermissions(user.uid, permissions);
      return user.uid;
    } catch (err) {
      setAuthError(friendlyError(err.code));
      throw err;
    } finally {
      // Cerrar y destruir la app secundaria; la sesión principal (el Dueño)
      // sigue intacta en todo momento porque nunca tocamos `auth`.
      await signOut(secondaryAuth).catch(() => {});
      await deleteApp(secondaryApp).catch(() => {});
    }
  }

  async function joinCompany(email, password, name, targetCompanyId) {
    setAuthError("");
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName: name });
      await createUserProfile({ uid: user.uid, name, email, companyId: targetCompanyId, role: "empleado", permissions: defaultPermissions() });
    } catch (err) {
      setAuthError(friendlyError(err.code)); throw err;
    }
  }

  async function logout() { await signOut(auth); }

  async function resetPassword(email) {
    setAuthError("");
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      setAuthError(friendlyError(err.code)); throw err;
    }
  }

  function friendlyError(code) {
    return ({
      "auth/user-not-found":        "No existe una cuenta con ese correo.",
      "auth/wrong-password":        "Contraseña incorrecta.",
      "auth/invalid-credential":    "Correo o contraseña incorrectos.",
      "auth/email-already-in-use":  "Ese correo ya está registrado.",
      "auth/weak-password":         "La contraseña debe tener al menos 6 caracteres.",
      "auth/invalid-email":         "Correo electrónico inválido.",
      "auth/too-many-requests":     "Demasiados intentos. Intenta más tarde.",
      "auth/network-request-failed":"Error de red. Verifica tu conexión.",
      "auth/popup-blocked":         "El navegador bloqueó el popup. Permite pop-ups para este sitio.",
      "auth/account-exists-with-different-credential":
                                    "Ya hay una cuenta con ese correo usando otro método.",
    }[code] || "Ocurrió un error. Inténtalo de nuevo.");
  }

  return (
    <AuthContext.Provider value={{
      currentUser, userProfile, companyId, companyName, companyCurrency,
      loading, authError, setAuthError,
      login, loginWithGoogle, register, joinCompany, registerEmployee, logout, resetPassword,
      setCompanyCurrency,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}