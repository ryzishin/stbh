// src/services/leaderboard.js
// Points, streaks, and leaderboard helpers.
// Uses MongoDB atomic $inc for increments (replaces the Supabase `increment` RPC).
import { ObjectId } from "mongodb";
import { col } from "../config/mongo.js";
import { getPointsConfig, computeStreakBonus, maybeResetWeeklyPoints } from "./settings.js";

function toOid(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try { return new ObjectId(String(id)); } catch { return null; }
}

// Award points to a user (both lifetime + weekly) — single atomic update.
// Also lazy-resets the weekly leaderboard if a new Manila-week has started.
export async function awardPoints(userId, points, _opts = {}) {
  if (!points || points <= 0) return;
  // Cheap check — one settings read, only resets on week boundary.
  try { await maybeResetWeeklyPoints(); } catch (err) { console.warn("[awardPoints] weekly reset check failed:", err.message); }
  const profilesC = await col("profiles");
  await profilesC.updateOne(
    { _id: toOid(userId) },
    { $inc: { points: points, weekly_points: points } }
  );
}

// Back-compat alias — same function. Old controllers call awardPointsFallback.
export const awardPointsFallback = awardPoints;

// Compute the points a user should earn for completing a practice quiz,
// using the admin-configurable points_config.
export async function computePracticePoints(score, streakDays = 0) {
  const cfg = await getPointsConfig();
  const base = cfg.practiceBase || 0;
  const correct = (cfg.perCorrect || 0) * score;
  const streakBonus = computeStreakBonus(streakDays, cfg);
  return { base, correct, streakBonus, total: base + correct + streakBonus, cfg };
}

// Compute the points a user should earn per flashcard review.
export async function computeFlashcardPoints(streakDays = 0) {
  const cfg = await getPointsConfig();
  const base = cfg.perFlashcard || 0;
  const streakBonus = Math.round(computeStreakBonus(streakDays, cfg) / 4); // smaller slice for flashcards
  return { base, streakBonus, total: base + streakBonus, cfg };
}

// Bump a user's daily streak (called on login). Also awards the streak bonus.
export async function bumpStreak(userId) {
  const profilesC = await col("profiles");
  const p = await profilesC.findOne(
    { _id: toOid(userId) },
    { projection: { streak_days: 1, last_active_date: 1 } }
  );
  if (!p) return { newStreak: 0, bonus: 0, incremented: false };
  const today = new Date().toISOString().slice(0, 10);
  if (p.last_active_date === today) {
    return { newStreak: p.streak_days || 0, bonus: 0, incremented: false };
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newStreak = p.last_active_date === yesterday ? (p.streak_days || 0) + 1 : 1;
  await profilesC.updateOne(
    { _id: toOid(userId) },
    { $set: { streak_days: newStreak, last_active_date: today } }
  );

  const cfg = await getPointsConfig();
  const bonus = computeStreakBonus(newStreak, cfg);
  if (bonus > 0) await awardPoints(userId, bonus);

  return { newStreak, bonus, incremented: true };
}

export async function getLeaderboard(scope = "weekly") {
  const profilesC = await col("profiles");
  const sortKey = scope === "alltime" ? "points" : "weekly_points";
  const users = await profilesC
    .find({ role: { $ne: "admin" } })
    .project({ name: 1, username: 1, avatar_color: 1, avatar_url: 1, points: 1, weekly_points: 1, streak_days: 1 })
    .sort({ [sortKey]: -1 })
    .limit(50)
    .toArray();
  return users.map((u, i) => ({
    ...u,
    id: u._id.toString(),
    rank: i + 1,
  }));
}

export async function logActivity(userId, userName, kind, detail) {
  const feedC = await col("activity_feed");
  await feedC.insertOne({
    user_id: userId ? toOid(userId) : null,
    user_name: userName || "",
    kind,
    detail: detail || "",
    created_at: new Date(),
  });
}

export async function getRecentActivity(limit = 30) {
  const feedC = await col("activity_feed");
  const items = await feedC.find({}).sort({ created_at: -1 }).limit(limit).toArray();
  return items.map(i => ({ ...i, id: i._id.toString() }));
}
