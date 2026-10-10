// src/middleware/auth.js
// Attach `req.user` (profile doc) and `req.role` if a session user_id is present.
import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

export async function attachUser(req, _res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    req.user = null;
    req.role = null;
    return next();
  }
  try {
    const profiles = await col("profiles");
    const data = await profiles.findOne({ _id: toObjectId(userId) });
    if (!data) {
      req.session.destroy(() => {});
      req.user = null;
      req.role = null;
      return next();
    }
    req.user = data;
    req.role = data.role;
    // Convenience: views use `user.id` (string) and `user.uid` (string).
    // Mongo stores `_id` (ObjectId) and `uid` (string) — expose both.
    req.user.id = data._id.toString();
    // refresh last_active_date (today, yyyy-mm-dd)
    const today = new Date().toISOString().slice(0, 10);
    if (data.last_active_date !== today) {
      await profiles.updateOne({ _id: data._id }, { $set: { last_active_date: today } });
    }
    next();
  } catch (err) {
    console.error("[attachUser] error:", err.message);
    req.user = null;
    req.role = null;
    next();
  }
}

// Require an authenticated session.
// For /api/* routes, return 401 JSON (so client-side fetch doesn't follow a
// redirect to /login and try to parse the HTML page as JSON). For browser
// navigations, redirect to /login so the user lands on the sign-in page.
export function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ ok: false, error: "Authentication required." });
    }
    return res.redirect("/login?error=auth_required");
  }
  next();
}

// Require a specific role (or any of an allowed list)
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ ok: false, error: "Authentication required." });
      }
      return res.redirect("/login?error=auth_required");
    }
    if (!roles.includes(req.role)) {
      if (req.path.startsWith("/api/")) {
        return res.status(403).json({ ok: false, error: `Requires ${roles.join(" or ")} role.` });
      }
      return res.status(403).render("error/403", { user: req.user });
    }
    next();
  };
}

// Convenience guards
export const requireStudent = requireRole("student");
export const requireSubAdmin = requireRole("subadmin", "admin"); // admin can do everything sub-admin can
export const requireAdmin = requireRole("admin");
