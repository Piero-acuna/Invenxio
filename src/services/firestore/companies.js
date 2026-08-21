// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/companies.js — versión Supabase
// Mismos exports que la versión Firestore original (ver firestoreService.js).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, rowToCamel, assertNoError, subscribeToRow } from "./shared";

export const TRIAL_DAYS = 14; // informativo — el valor real vive en create_company() (SQL)

/**
 * Crea la empresa + perfil del Dueño + suscripción de prueba, TODO dentro de
 * una sola función Postgres atómica (create_company). auth.uid() ya debe
 * estar autenticado (se llama justo después de supabase.auth.signUp()).
 */
export async function createCompany({ companyName, ownerName, ownerEmail, country = "PE" }) {
  const { data, error } = await supabase.rpc("create_company", {
    p_company_name: companyName,
    p_country: country,
    p_owner_name: ownerName,
    p_owner_email: ownerEmail,
  });
  assertNoError(error, "createCompany");
  return data; // companyId (== ownerUid)
}

export async function getUserProfile(uid) {
  const { data, error } = await supabase.from("users").select("*").eq("id", uid).maybeSingle();
  assertNoError(error, "getUserProfile");
  return data ? rowToCamel(data) : null;
}

/**
 * Crea el perfil de un usuario invitado a una empresa existente (flujo
 * joinCompany). Para el alta de EMPLEADOS con cuenta nueva creada por el
 * Dueño, ver registerEmployee() en AuthContext.jsx — esa cuenta se crea en
 * el servidor (api/create-employee.js) porque Supabase, a diferencia de
 * Firebase, no permite crear la cuenta de otro usuario desde el cliente.
 */
export async function createUserProfile({ name, email, companyId }) {
  const { error } = await supabase.rpc("join_company", {
    p_company_id: companyId,
    p_name: name,
    p_email: email,
  });
  assertNoError(error, "createUserProfile");
}

export async function getCompanyProfile(companyId) {
  const { data, error } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
  assertNoError(error, "getCompanyProfile");
  return data ? rowToCamel(data) : null;
}

export function subscribeToCompany(companyId, onData) {
  return subscribeToRow("companies", "id", companyId, onData);
}

export async function updateCompanyBilling(companyId, billing) {
  const { error } = await supabase.from("companies").update({ billing }).eq("id", companyId);
  assertNoError(error, "updateCompanyBilling");
}

export async function updateCompanyCountry(companyId, country) {
  const gateway = country === "PE" ? "culqi" : "mercadopago";
  const currencyCode = gateway === "culqi" ? "PEN" : "USD";
  const currencySymbol = gateway === "culqi" ? "S/" : "$";
  const { error } = await supabase
    .from("companies")
    .update({ country, payment_gateway: gateway, currency_code: currencyCode, currency_symbol: currencySymbol })
    .eq("id", companyId);
  assertNoError(error, "updateCompanyCountry");
}

export function subscribeToSubscription(companyId, onData) {
  return subscribeToRow("subscriptions", "company_id", companyId, onData);
}

export async function getSubscription(companyId) {
  const { data, error } = await supabase.from("subscriptions").select("*").eq("company_id", companyId).maybeSingle();
  assertNoError(error, "getSubscription");
  return data ? rowToCamel(data) : null;
}

export async function getNextInvoiceNumber(companyId) {
  const { data, error } = await supabase.rpc("next_invoice_number", { p_company: companyId });
  assertNoError(error, "getNextInvoiceNumber");
  return data;
}
