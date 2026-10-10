// src/config/db.js
// Re-export of the Mongo pool, kept under the legacy `db` import path so
// existing code that imports from "./db.js" doesn't break.
//
// The actual implementation is in mongo.js — this file is a thin shim.
export { getDb, getClient, col, closeMongo } from "./mongo.js";

export default { getDb: (...a) => import("./mongo.js").then(m => m.getDb(...a)) };
