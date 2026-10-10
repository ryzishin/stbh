// src/config/mongo.js
// MongoDB connection — lazy singleton. Used by every service.
//
// Resolution order:
//   1. MONGODB_URI env var → connect to that (Atlas, local Mongo, etc.)
//   2. Fallback → mongodb-memory-server (in-process ephemeral MongoDB, dev only).
//
// The fallback exists so the app boots without any external setup. Production
// must always set MONGODB_URI; data in the memory server is lost on restart.

import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { config } from "./env.js";

let _client = null;
let _db = null;
let _memoryServer = null;

export async function getDb() {
  if (_db) return _db;

  let uri = config.mongoUri;
  if (!uri) {
    if (config.env === "production") {
      throw new Error(
        "MONGODB_URI is required in production. Set it in your environment."
      );
    }
    console.warn("[mongo] MONGODB_URI not set — spinning up an in-memory MongoDB (dev only; data lost on restart).");
    _memoryServer = await MongoMemoryServer.create();
    uri = _memoryServer.getUri();
    console.log(`[mongo] In-memory MongoDB running at ${uri}`);
  }

  _client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    maxPoolSize: 20,
  });

  await _client.connect();
  _db = _client.db(config.mongoDbName);
  console.log(`[mongo] Connected to database "${_db.databaseName}".`);

  // Ensure indexes once per boot (idempotent).
  await ensureIndexes(_db);

  return _db;
}

export async function getClient() {
  if (!_client) await getDb();
  return _client;
}

export async function closeMongo() {
  if (_client) {
    await _client.close();
    _client = null;
    _db = null;
  }
  if (_memoryServer) {
    await _memoryServer.stop();
    _memoryServer = null;
  }
}

// Convenience: get a typed collection.
export async function col(name) {
  const db = await getDb();
  return db.collection(name);
}

// Create indexes that mirror what the SQL schema declared. Idempotent.
async function ensureIndexes(db) {
  // profiles: unique UID (case-insensitive collation), unique username.
  await db.collection("profiles").createIndex(
    { uid: 1 },
    { unique: true, collation: { locale: "en", strength: 2 } }
  );
  await db.collection("profiles").createIndex(
    { username: 1 },
    { unique: true, collation: { locale: "en", strength: 2 } }
  );

  // units: unique slug.
  await db.collection("units").createIndex({ slug: 1 }, { unique: true });
  await db.collection("units").createIndex({ sort_order: 1 });

  // parts: lookup by unit_id.
  await db.collection("parts").createIndex({ unit_id: 1, sort_order: 1 });

  // content_blocks: lookup by part_id.
  await db.collection("content_blocks").createIndex({ part_id: 1, sort_order: 1 });

  // quizzes + items + options.
  await db.collection("quizzes").createIndex({ kind: 1, created_at: -1 });
  await db.collection("quiz_items").createIndex({ quiz_id: 1, sort_order: 1 });
  await db.collection("quiz_options").createIndex({ item_id: 1, sort_order: 1 });

  // flashcards.
  await db.collection("flashcards").createIndex({ unit_id: 1, created_at: -1 });

  // SM-2 spaced repetition: per-user per-card schedule.
  await db.collection("card_schedules").createIndex(
    { user_id: 1, card_id: 1 },
    { unique: true }
  );
  await db.collection("card_schedules").createIndex({ user_id: 1, next_review_at: 1 });

  // attempts.
  await db.collection("quiz_attempts").createIndex({ user_id: 1, taken_at: -1 });
  await db.collection("quiz_attempts").createIndex({ quiz_id: 1 });

  // live.
  await db.collection("live_sessions").createIndex({ status: 1, created_at: -1 });
  await db.collection("live_participants").createIndex(
    { session_id: 1, user_id: 1 },
    { unique: true }
  );

  // notifications: per-user + broadcasts, newest first; unread index for count.
  await db.collection("notifications").createIndex({ user_id: 1, created_at: -1 });
  await db.collection("notifications").createIndex({ user_id: 1, read_at: 1 });

  // activity.
  await db.collection("activity_feed").createIndex({ created_at: -1 });

  // uploads: profile pictures + content images stored as BSON BinData.
  // Lookups are always by _id (ObjectId), so no extra index is needed.
  // This index is for the admin "list uploads by user" query (future use).
  await db.collection("uploads").createIndex({ uploaded_by: 1, created_at: -1 });

  // settings: single-row (id: 1).
  await db.collection("settings").createIndex({ id: 1 }, { unique: true });

  // reactions: one per user per target.
  await db.collection("reactions").createIndex(
    { target_type: 1, target_id: 1, user_id: 1 },
    { unique: true }
  );
  await db.collection("reactions").createIndex({ target_type: 1, target_id: 1 });

  // TTL index on expired sessions — connect-mongo inserts { expires } fields.
  // The collection is named "sessions" by default.
  await db.collection("sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });

  console.log("[mongo] Indexes ensured.");
}

export default { getDb, getClient, col, closeMongo };
