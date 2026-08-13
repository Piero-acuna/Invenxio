#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/migrate-data.js
//
// Migra los DATOS existentes (no las cuentas de Auth — ver MIGRATION.md para
// eso) de Firestore a Supabase, empresa por empresa, respetando el orden de
// dependencias (companies → users → subscriptions → products → ... ).
//
// USO:
//   node scripts/migrate-data.js
//
// VARIABLES DE ENTORNO NECESARIAS (ponlas en tu shell, NO en el repo):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//     → las mismas 3 que usaban las funciones serverless viejas.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//     → las nuevas, con permiso total (bypasea RLS a propósito, es un
//       script de migración de una sola vez).
//
// IMPORTANTE:
//   - Los ids de Firestore (productos, proveedores, etc.) NO son uuid, así
//     que este script genera un uuid nuevo por cada documento y arma un
//     mapa oldId → newUuid para poder mantener las relaciones (ej. qué
//     producto pertenece a qué historial, qué venta de almacén referencia
//     qué producto de almacén).
//   - company.id y user.id de owners SE MANTIENEN igual a su uid de Firebase
//     Auth (que también será el mismo uid en Supabase Auth, ver
//     scripts/migrate-auth-users.js), porque ese es justamente el invariante
//     que sostiene toda la arquitectura (companyId == ownerUid).
//   - Corre esto DESPUÉS de aplicar las migraciones SQL (0001/0002/0003) y
//     DESPUÉS de migrar las cuentas de Auth (los users.id deben existir en
//     auth.users por el FK).
// ─────────────────────────────────────────────────────────────────────────────
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});
const fs = admin.firestore();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const iso = (ts) => (ts?.toDate ? ts.toDate().toISOString() : ts || null);

async function migrateCompany(companyDoc) {
  const companyId = companyDoc.id; // == ownerUid, se mantiene igual
  const c = companyDoc.data();
  console.log(`\n▶ Empresa ${companyId} (${c.name})`);

  // companies
  await supabase.from("companies").upsert({
    id: companyId,
    owner_id: c.ownerId || companyId,
    name: c.name,
    plan: c.plan || "free",
    country: c.country || "PE",
    payment_gateway: c.paymentGateway || "culqi",
    currency_code: c.currencyCode || "PEN",
    currency_symbol: c.currencySymbol || "S/",
    billing: c.billing || null,
    created_at: iso(c.createdAt) || new Date().toISOString(),
  });

  // users (colección raíz, filtrada por companyId)
  const usersSnap = await fs.collection("users").where("companyId", "==", companyId).get();
  for (const uDoc of usersSnap.docs) {
    const u = uDoc.data();
    await supabase.from("users").upsert({
      id: uDoc.id, // debe existir ya en auth.users (ver migrate-auth-users.js)
      company_id: companyId,
      name: u.name, email: u.email, role: u.role, permissions: u.permissions || {},
      active: u.active !== false,
      created_at: iso(u.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`  usuarios: ${usersSnap.size}`);

  // meta/subscription
  const subSnap = await fs.doc(`companies/${companyId}/meta/subscription`).get();
  if (subSnap.exists) {
    const s = subSnap.data();
    await supabase.from("subscriptions").upsert({
      company_id: companyId,
      status: s.status, plan: s.plan,
      trial_ends_at: s.trialEndsAt || null,
      paid_until: s.paidUntil || null,
      payment_gateway: s.paymentGateway || null,
      currency_code: s.currencyCode || null,
      last_payment_at: iso(s.lastPaymentAt),
      last_charge_id: s.lastChargeId || null,
      granted_manually_at: iso(s.grantedManuallyAt),
      created_at: iso(s.createdAt) || new Date().toISOString(),
    });
  }

  // meta/invoiceCounter
  const invSnap = await fs.doc(`companies/${companyId}/meta/invoiceCounter`).get();
  if (invSnap.exists) {
    await supabase.from("invoice_counters").upsert({ company_id: companyId, value: invSnap.data().value || 0 });
  }

  // products + su historial
  const productIdMap = new Map(); // firestoreId -> uuid
  const productsSnap = await fs.collection(`companies/${companyId}/products`).get();
  for (const pDoc of productsSnap.docs) {
    const p = pDoc.data();
    const newId = randomUUID();
    productIdMap.set(pDoc.id, newId);
    await supabase.from("products").insert({
      id: newId, company_id: companyId,
      name: p.name, sku: p.sku, description: p.description, category: p.category,
      price: p.price || 0, cost: p.cost || 0, stock: p.stock || 0, min_stock: p.minStock || 0,
      pack_qty: p.packQty || null, barcode: p.barcode || null,
      status: p.status || "En Stock",
      created_at: iso(p.createdAt) || new Date().toISOString(),
    });

    const histSnap = await fs.collection(`companies/${companyId}/products/${pDoc.id}/history`).get();
    if (histSnap.size) {
      await supabase.from("product_history").insert(
        histSnap.docs.map((h) => {
          const d = h.data();
          return {
            company_id: companyId, product_id: newId,
            date: d.date, action: d.action, qty: d.qty, user_name: d.user, note: d.note || null,
            created_at: iso(d.createdAt) || new Date().toISOString(),
          };
        })
      );
    }
  }
  console.log(`  productos: ${productsSnap.size}`);

  // suppliers
  const supplierIdMap = new Map();
  const suppliersSnap = await fs.collection(`companies/${companyId}/suppliers`).get();
  for (const sDoc of suppliersSnap.docs) {
    const s = sDoc.data();
    const newId = randomUUID();
    supplierIdMap.set(sDoc.id, newId);
    await supabase.from("suppliers").insert({
      id: newId, company_id: companyId,
      name: s.name, contact: s.contact ?? s.contactName ?? null, phone: s.phone, email: s.email, address: s.address, notes: s.notes,
      ruc: s.ruc || null, status: s.status || "Activo", products: s.products || [],
      total_orders: s.totalOrders || 0, total_spent: s.totalSpent || 0, last_order: s.lastOrder || "—",
      created_at: iso(s.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`  proveedores: ${suppliersSnap.size}`);

  // transactions (inmutable, se copian tal cual)
  const txSnap = await fs.collection(`companies/${companyId}/transactions`).get();
  const txRows = txSnap.docs.map((d) => {
    const t = d.data();
    return {
      company_id: companyId, type: t.type, target: t.target || null, date: t.date, time: t.time || null,
      product: t.product, sku: t.sku, description: t.description, qty: t.qty,
      unit_cost: t.unitCost || null, unit_price: t.unitPrice || null, total: t.total || 0,
      supplier: t.supplier || null, client: t.client || null, note: t.note || null, created_by: t.createdBy || null,
      pack_mode: !!t.packMode, pack_qty: t.packQty || null, pack_name: t.packName || null, base_unit_name: t.baseUnitName || null,
      location_id: t.locationId || null, location_name: t.locationName || null,
      created_at: iso(t.createdAt) || new Date().toISOString(),
    };
  });
  if (txRows.length) await supabase.from("transactions").insert(txRows);
  console.log(`  transacciones: ${txRows.length}`);

  // warehouseLocations
  const locationIdMap = new Map();
  const locSnap = await fs.collection(`companies/${companyId}/warehouseLocations`).get();
  for (const lDoc of locSnap.docs) {
    const l = lDoc.data();
    const newId = randomUUID();
    locationIdMap.set(lDoc.id, newId);
    await supabase.from("warehouse_locations").insert({
      id: newId, company_id: companyId, name: l.name, description: l.description || null,
      type: l.type || "Zona", code: l.code || null,
      created_at: iso(l.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`  ubicaciones de almacén: ${locSnap.size}`);

  // warehouseProducts
  const whProductIdMap = new Map();
  const whProdSnap = await fs.collection(`companies/${companyId}/warehouseProducts`).get();
  for (const wDoc of whProdSnap.docs) {
    const w = wDoc.data();
    const newId = randomUUID();
    whProductIdMap.set(wDoc.id, newId);
    await supabase.from("warehouse_products").insert({
      id: newId, company_id: companyId, name: w.name, sku: w.sku || null, description: w.description || null,
      pack_name: w.packName || null, pack_qty: w.packQty || null,
      unit_price: w.unitPrice || null, cost: w.cost || null,
      created_at: iso(w.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`  productos de almacén: ${whProdSnap.size}`);

  // warehouseStock (id compuesto: `${productId}__${locationId}` con los NUEVOS uuid)
  const stockSnap = await fs.collection(`companies/${companyId}/warehouseStock`).get();
  const stockRows = [];
  for (const sDoc of stockSnap.docs) {
    const s = sDoc.data();
    const newProductId = whProductIdMap.get(s.productId);
    const newLocationId = locationIdMap.get(s.locationId);
    if (!newProductId || !newLocationId) continue; // referencia rota, se omite
    stockRows.push({
      id: `${newProductId}__${newLocationId}`,
      company_id: companyId, product_id: newProductId, product_name: s.productName,
      sku: s.sku || null, location_id: newLocationId, location_name: s.locationName,
      qty: s.qty || 0,
    });
  }
  if (stockRows.length) await supabase.from("warehouse_stock").insert(stockRows);
  console.log(`  stock de almacén: ${stockRows.length}`);

  // warehouseMovements
  const movSnap = await fs.collection(`companies/${companyId}/warehouseMovements`).get();
  const movRows = movSnap.docs.map((d) => {
    const m = d.data();
    return {
      company_id: companyId, type: m.type,
      product_id: whProductIdMap.get(m.productId) || null, product_name: m.productName, sku: m.sku || null,
      qty: m.qty, unit_qty: m.unitQty || null,
      from_location_id: locationIdMap.get(m.fromLocationId) || null, from_location_name: m.fromLocationName || null,
      to_location_id: locationIdMap.get(m.toLocationId) || null, to_location_name: m.toLocationName || null,
      store_product_id: productIdMap.get(m.storeProductId) || null, store_product_name: m.storeProductName || null,
      reason: m.reason || null, user_name: m.userName || null, date: m.date, time: m.time || null,
      pack_name: m.packName || null, pack_qty: m.packQty || null, pack_price: m.packPrice || null,
      created_at: iso(m.createdAt) || new Date().toISOString(),
    };
  }).filter((r) => r.product_id); // sin producto de almacén válido, se omite
  if (movRows.length) await supabase.from("warehouse_movements").insert(movRows);
  console.log(`  movimientos de almacén: ${movRows.length}`);

  // supplierSales
  const salesSnap = await fs.collection(`companies/${companyId}/supplierSales`).get();
  const saleRows = salesSnap.docs.map((d) => {
    const s = d.data();
    return {
      company_id: companyId, supplier: s.supplier, product: s.product, description: s.description || null,
      sku: s.sku || null, qty: s.qty, pack_name: s.packName || null, pack_qty: s.packQty || null,
      unit_price: s.unitPrice || 0, total: s.total || 0, status: s.status || "Entregado", note: s.note || null,
      warehouse_product_id: whProductIdMap.get(s.warehouseProductId) || null,
      location_id: locationIdMap.get(s.locationId) || null, location_name: s.locationName || null,
      date: s.date, created_at: iso(s.createdAt) || new Date().toISOString(),
    };
  });
  if (saleRows.length) await supabase.from("supplier_sales").insert(saleRows);
  console.log(`  ventas a proveedor: ${saleRows.length}`);
}

async function main() {
  const companiesSnap = await fs.collection("companies").get();
  console.log(`Empresas encontradas: ${companiesSnap.size}`);
  for (const companyDoc of companiesSnap.docs) {
    await migrateCompany(companyDoc);
  }
  console.log("\n✔ Migración de datos terminada.");
}

main().catch((err) => {
  console.error("✖ Migración fallida:", err);
  process.exit(1);
});
