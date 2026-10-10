// src/server.js — Express + EJS + MongoDB + Socket.IO entry point.
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import expressLayouts from "express-ejs-layouts";
import MongoStore from "connect-mongo";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { config } from "./config/env.js";
import { getDb } from "./config/mongo.js";
import { attachRealtime } from "./services/realtime.js";
import { shareLocals } from "./middleware/shareLocals.js";
import { bootstrapAdminIfEmpty } from "./services/bootstrap.js";
import routes from "./routes/index.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const app = express();
const PORT = config.port;

// ===== View engine (EJS + layouts) =====
app.set("view engine", "ejs");
app.set("views", path.join(ROOT, "src", "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

// ===== Security & middleware =====
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "https:"],
    },
  },
}));
app.use(morgan(config.env === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// ===== Connect to MongoDB (lazy + singleton) =====
// We need it before the session store can be created.
let db;
try {
  db = await getDb();
} catch (err) {
  console.error("[server] Could not connect to MongoDB:", err.message);
  process.exit(1);
}

// ===== Session store (MongoDB-backed, survives restarts) =====
app.use(session({
  store: MongoStore.create({
    client: db.client, // reuse the same connection
    dbName: config.mongoDbName,
    collectionName: "sessions",
    ttl: 7 * 24 * 60 * 60, // 7 days (matches cookie maxAge)
    autoRemove: "interval",
    autoRemoveInterval: 15, // minutes
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ===== Rate limiter for auth endpoints (anti-brute-force) =====
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 attempts per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many attempts. Try again in a minute." },
  // For form submits, redirect to /login with an error instead of returning JSON.
  handler: (req, res) => {
    if (req.path === "/login" || req.path === "/signup") {
      return res.render("login", { title: "Sign in", error: "Too many attempts. Wait a minute and try again." });
    }
    res.status(429).json({ ok: false, error: "Too many attempts. Try again in a minute." });
  },
});

// ===== Static =====
// PWA manifest + service worker are served BEFORE static middleware so we can
// override their MIME types (Express static would otherwise serve .json as
// application/json, which Lighthouse flags as a PWA error).
app.get("/manifest.json", (_req, res) => {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(ROOT, "public", "manifest.json"));
});
app.get("/sw.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(ROOT, "public", "sw.js"));
});
app.use(express.static(path.join(ROOT, "public")));
// Note: /uploads is NOT served from disk anymore — files are stored in MongoDB
// and served by the GET /uploads/:id route (see src/routes/index.js). This keeps
// uploads persistent across Render deploys (where the local disk is ephemeral).

// ===== File upload (profile pictures, content images) =====
// memoryStorage keeps the file in memory (req.file.buffer) so we can insert it
// into MongoDB directly. We never write to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error("Only image files are allowed"));
    cb(null, true);
  },
});
app.use((req, _res, next) => { req.upload = upload; next(); });

// ===== Locals =====
// attachUser must run BEFORE shareLocals so that res.locals.user is set
// to the actual profile (not null) when shareLocals reads req.user.
// attachUser is also registered inside the routes router for compatibility
// with code that imports the router standalone — but the global registration
// here is what makes the locals actually reflect the user.
import { attachUser } from "./middleware/auth.js";
app.use((req, res, next) => {
  res.locals.appName = "STEM Tesla BioHub";
  res.locals.tagline = "Explore. Practice. Apply. Discover Biology.";
  res.locals.publicUrl = config.publicUrl;
  next();
});
app.use(attachUser);
app.use(shareLocals);

// ===== Rate-limited auth routes (mount BEFORE the main router) =====
// We mount just the rate-limited /login and /signup routes here so we don't
// accidentally rate-limit other GET /login resources.
app.use("/login", authLimiter);
app.use("/signup", authLimiter);

// ===== Routes =====
app.use(routes);

// ===== 404 =====
app.use((req, res) => {
  res.status(404).render("error/404", { title: "Not Found" });
});

// ===== 500 =====
app.use((err, req, res, _next) => {
  console.error("[unhandled error]", err);
  res.status(500).render("error/500", { title: "Server Error", message: err.message });
});

// ===== Bootstrap admin from env vars (if DB has zero admins) =====
try {
  await bootstrapAdminIfEmpty();
} catch (err) {
  console.warn("[server] Bootstrap admin failed:", err.message);
}

// ===== Start HTTP server + Socket.IO =====
const httpServer = app.listen(PORT, () => {
  console.log(`\n  STEM Tesla BioHub running at:`);
  console.log(`    Local:    http://localhost:${PORT}`);
  console.log(`    Public:   ${config.publicUrl}`);
  console.log(`    Env:      ${config.env}`);
  console.log(`    DB:       ${db.databaseName}\n`);
});

attachRealtime(httpServer);

export default app;
