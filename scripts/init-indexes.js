// scripts/init-indexes.js — ensures all MongoDB indexes are created.
// Idempotent. Safe to run multiple times.
//
// Usage: node scripts/init-indexes.js

import { getDb } from "../src/config/mongo.js";

async function main() {
  console.log("Ensuring MongoDB indexes…");
  await getDb(); // calls ensureIndexes internally
  console.log("✓ Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
