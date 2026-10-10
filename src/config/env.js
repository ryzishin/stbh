// src/config/env.js
// Environment config. The only required env var in production is MONGODB_URI.
//
// In dev: if MONGODB_URI is unset, the server falls back to mongodb-memory-server
// (auto-starts an ephemeral in-process MongoDB). Data is lost on restart, so
// always set MONGODB_URI for anything that matters.
import dotenv from "dotenv";
dotenv.config();

function required(name, fallback) {
  const v = process.env[name] || fallback;
  if (!v) {
    console.error(`[config] Missing required env var: ${name}`);
    console.error(`[config] Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
  return v;
}

function optional(name, fallback = "") {
  return process.env[name] || fallback;
}

export const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  sessionSecret: required("SESSION_SECRET", "dev-session-secret-change-me"),
  // Mongo connection string. Atlas format:
  //   mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/<db>?retryWrites=true&w=majority
  // Local format:
  //   mongodb://127.0.0.1:27017/stbh
  // When unset, the app falls back to mongodb-memory-server (dev convenience only).
  mongoUri: optional("MONGODB_URI", ""),
  mongoDbName: optional("MONGODB_DB_NAME", "stbh"),
  publicUrl: process.env.PUBLIC_URL || "http://localhost:3000",
  // First-admin bootstrap. When the server boots and finds zero admins in the DB,
  // it auto-creates one using these credentials (if both are set). Useful for
  // fresh deploys where the operator can't run scripts (e.g. Render free tier).
  bootstrapAdminUid: optional("ADMIN_UID", ""),
  bootstrapAdminPassword: optional("ADMIN_PASSWORD", ""),
  bootstrapAdminName: optional("ADMIN_NAME", "Administrator"),
  bootstrapAdminUsername: optional("ADMIN_USERNAME", "admin"),
};

export default config;
