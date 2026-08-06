// ─────────────────────────────────────────────────────────────────────────────
// src/config/countryConfig.js
//
// Único lugar del proyecto que decide, a partir del país elegido al crear la
// cuenta, qué MONEDA se muestra en toda la app y qué PASARELA DE PAGO se usa
// para cobrar la suscripción:
//
//   Perú           → moneda PEN (S/)  → pasarela Culqi
//   Cualquier otro → moneda USD ($)   → pasarela Mercado Pago
//
// Estos 3 valores (country, currency, paymentGateway) se calculan UNA sola
// vez, al registrar la empresa (ver createCompany en
// services/firestore/companies.js), y quedan guardados en el documento de la
// empresa — así toda la app (precios, comprobantes, PaywallScreen) lee
// siempre el mismo valor sin tener que repetir esta lógica.
// ─────────────────────────────────────────────────────────────────────────────

export const CURRENCY_BY_GATEWAY = {
  culqi: { code: "PEN", symbol: "S/" },
  mercadopago: { code: "USD", symbol: "$" },
};

// Lista de países mostrada en el formulario de registro. "PE" es el único
// que usa Culqi — todos los demás usan Mercado Pago + USD, tal como se pidió.
// Agregar un país nuevo a esta lista es tan simple como sumar una línea acá,
// no requiere tocar ningún otro archivo.
export const COUNTRIES = [
  { code: "PE", name: "Perú" },
  { code: "AR", name: "Argentina" },
  { code: "BO", name: "Bolivia" },
  { code: "BR", name: "Brasil" },
  { code: "CL", name: "Chile" },
  { code: "CO", name: "Colombia" },
  { code: "CR", name: "Costa Rica" },
  { code: "EC", name: "Ecuador" },
  { code: "SV", name: "El Salvador" },
  { code: "ES", name: "España" },
  { code: "US", name: "Estados Unidos" },
  { code: "GT", name: "Guatemala" },
  { code: "HN", name: "Honduras" },
  { code: "MX", name: "México" },
  { code: "NI", name: "Nicaragua" },
  { code: "PA", name: "Panamá" },
  { code: "PY", name: "Paraguay" },
  { code: "DO", name: "República Dominicana" },
  { code: "UY", name: "Uruguay" },
  { code: "VE", name: "Venezuela" },
  { code: "OTHER", name: "Otro país" },
];

/**
 * A partir del código de país (ej. "PE", "MX", "OTHER") devuelve la
 * configuración completa de moneda/pasarela que le corresponde a la empresa.
 */
export function getCountryConfig(countryCode) {
  const gateway = countryCode === "PE" ? "culqi" : "mercadopago";
  const currency = CURRENCY_BY_GATEWAY[gateway];
  return {
    country: countryCode || "OTHER",
    paymentGateway: gateway,
    currencyCode: currency.code,
    currencySymbol: currency.symbol,
  };
}

// Config por defecto para empresas creadas ANTES de que existiera esta
// función (documentos viejos sin country/paymentGateway/currency guardados)
// — así no se rompe nada retroactivamente y siguen viendo exactamente lo
// mismo que veían antes: soles + Culqi.
export const LEGACY_DEFAULT_CONFIG = getCountryConfig("PE");
