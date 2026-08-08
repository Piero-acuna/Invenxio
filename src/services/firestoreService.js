// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestoreService.js
//
// ARQUITECTURA MULTI-EMPRESA:
//   companies/{companyId}/products/{productId}
//   companies/{companyId}/suppliers/{supplierId}
//   companies/{companyId}/transactions/{txId}
//   companies/{companyId}/supplierSales/{saleId}
//   companies/{companyId}/warehouseLocations/{id}
//   companies/{companyId}/warehouseStock/{id}
//   companies/{companyId}/warehouseMovements/{id}
//   companies/{companyId}/warehouseProducts/{id}
//   companies/{companyId}/profile          ← datos de la empresa
//   users/{uid}                            ← perfil del usuario (companyId, role)
//
// Este archivo es un BARREL de compatibilidad: el código real vive dividido
// por dominio en ./firestore/*, porque este archivo había crecido a 839
// líneas mezclando 8 dominios distintos. Se mantiene esta ruta y estos
// nombres de export exactamente iguales para que NINGÚN import existente en
// el resto de la app (`from "../services/firestoreService"` /
// `from "./services/firestoreService"`) tenga que cambiar.
//
// Mapa de dónde vive cada cosa ahora:
//   ./firestore/shared.js        → helpers de ruta + subscribeToCollection (genérico)
//   ./firestore/companies.js     → empresa, perfil, facturación, suscripción, invoiceCounter
//   ./firestore/employees.js     → equipo/permisos/activar-desactivar empleados
//   ./firestore/products.js      → catálogo de productos de tienda + su historial
//   ./firestore/suppliers.js     → catálogo de proveedores
//   ./firestore/transactions.js  → registrar compras y ventas (log inmutable)
//   ./firestore/supplierSales.js → ventas de almacén a proveedores + cancelación
//   ./firestore/warehouse.js     → ubicaciones, stock, movimientos, catálogo de almacén
//
// Para agregar una función nueva: ponla en el dominio que corresponda dentro
// de ./firestore/ y agrega su export acá abajo. Si no encaja en ningún
// dominio existente, probablemente merece su propio archivo nuevo en
// ./firestore/.
// ─────────────────────────────────────────────────────────────────────────────

export { subscribeToCollection } from "./firestore/shared";

export {
  TRIAL_DAYS,
  createCompany,
  getUserProfile,
  createUserProfile,
  getCompanyProfile,
  subscribeToCompany,
  updateCompanyBilling,
  updateCompanyCountry,
  subscribeToSubscription,
  getSubscription,
  getNextInvoiceNumber,
} from "./firestore/companies";

export {
  subscribeToEmployees,
  updateUserPermissions,
  setEmployeeActive,
} from "./firestore/employees";

export {
  addProduct,
  updateProduct,
  deleteProduct,
  adjustProductStock,
  subscribeToProductHistory,
} from "./firestore/products";

export {
  addSupplier,
  updateSupplier,
  deleteSupplier,
} from "./firestore/suppliers";

export {
  recordPurchase,
  recordWarehousePurchase,
  recordSale,
} from "./firestore/transactions";

export {
  addSupplierSale,
  sellWarehouseToSupplier,
  updateSupplierSaleStatus,
  cancelSupplierSale,
} from "./firestore/supplierSales";

export {
  subscribeToLocations,
  addLocation,
  updateLocation,
  deleteLocation,
  subscribeToWarehouseStock,
  adjustWarehouseStock,
  subscribeToWarehouseMovements,
  subscribeToWarehouseProducts,
  addWarehouseProduct,
  updateWarehouseProduct,
  deleteWarehouseProduct,
  sendWarehouseToInventory,
  addWarehouseMovement,
} from "./firestore/warehouse";
