// src/services/settings.js
// Single-row settings collection (id: 1). Holds two embedded objects:
// anti_cheat and points_config. Also handles the weekly leaderboard reset.
import { col } from "../config/mongo.js";

export const DEFAULT_POINTS_CONFIG = {
  practiceBase: 5,            // awarded for completing any practice quiz
  perCorrect: 1,               // awarded per correct answer
  perFlashcard: 2,             // awarded per flashcard reviewed in a session
  streakBonusDaily: 1,         // flat bonus per consecutive day (above the base)
  streakBonusMultiplier: 0.5,  // fraction of streak_days added as a multiplier
  streakBonusMax: 5,           // cap on the streak multiplier contribution
};

export const DEFAULT_ANTI_CHEAT = {
  blockTabSwitch: true,
  requireFullscreen: true,
  blockCopy: true,
  blockRightClick: true,
  maxWarnings: 3,
};

export async function getSettings() {
  const settingsC = await col("settings");
  let data = await settingsC.findOne({ id: 1 });
  if (!data) {
    // Auto-create with defaults if missing.
    data = { id: 1, anti_cheat: DEFAULT_ANTI_CHEAT, points_config: DEFAULT_POINTS_CONFIG };
    await settingsC.insertOne(data);
  }
  if (!data.anti_cheat || typeof data.anti_cheat !== "object") data.anti_cheat = DEFAULT_ANTI_CHEAT;
  if (!data.points_config || typeof data.points_config !== "object") data.points_config = DEFAULT_POINTS_CONFIG;
  data.anti_cheat = { ...DEFAULT_ANTI_CHEAT, ...data.anti_cheat };
  data.points_config = { ...DEFAULT_POINTS_CONFIG, ...data.points_config };
  return data;
}

export async function getPointsConfig() {
  const s = await getSettings();
  return s.points_config;
}

export async function getAntiCheatConfig() {
  const s = await getSettings();
  return s.anti_cheat;
}

export async function updateAntiCheat(patch) {
  const settingsC = await col("settings");
  const s = await getSettings();
  const merged = { ...s.anti_cheat, ...patch };
  await settingsC.updateOne({ id: 1 }, { $set: { anti_cheat: merged } }, { upsert: true });
  return merged;
}

export async function updatePointsConfig(patch) {
  const settingsC = await col("settings");
  const s = await getSettings();
  // Coerce numbers — form data may come in as strings.
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    clean[k] = Number.isFinite(n) ? n : v;
  }
  const merged = { ...s.points_config, ...clean };
  // Clamp sane ranges.
  merged.practiceBase = Math.max(0, Math.min(100, merged.practiceBase));
  merged.perCorrect = Math.max(0, Math.min(50, merged.perCorrect));
  merged.perFlashcard = Math.max(0, Math.min(50, merged.perFlashcard));
  merged.streakBonusDaily = Math.max(0, Math.min(20, merged.streakBonusDaily));
  merged.streakBonusMultiplier = Math.max(0, Math.min(2, merged.streakBonusMultiplier));
  merged.streakBonusMax = Math.max(0, Math.min(50, merged.streakBonusMax));
  await settingsC.updateOne({ id: 1 }, { $set: { points_config: merged } }, { upsert: true });
  return merged;
}

// Compute the streak bonus for a given streak length.
//   base bonus = streakBonusDaily * min(streak, 1)
//   multiplier bonus = min(streak * streakBonusMultiplier, streakBonusMax)
//   total = streakBonusDaily (if streak > 0) + multiplier bonus
export function computeStreakBonus(streakDays, cfg = DEFAULT_POINTS_CONFIG) {
  if (!streakDays || streakDays <= 0) return 0;
  const flat = cfg.streakBonusDaily || 0;
  const multiplierBonus = Math.min(
    streakDays * (cfg.streakBonusMultiplier || 0),
    cfg.streakBonusMax || 0
  );
  return Math.round(flat + multiplierBonus);
}

// ===== Weekly leaderboard reset =====
//
// The leaderboard is supposed to reset every Monday 00:00 (Asia/Manila).
// We can't rely on a cron job because:
//   1. Render free tier sleeps the server after 15 min of inactivity.
//   2. We'd need an external scheduler (cron-job.org, Render Cron Jobs, etc.).
//
// Instead, we use a "lazy reset": on every login and every points award, we
// check if the current Manila-week is different from the last-reset week.
// If so, we atomically reset `weekly_points` to 0 for all non-admin profiles
// and stamp the new week. Safe under concurrency (idempotent updateMany).
//
// Timezone: Asia/Manila (UTC+8, no DST). The user's locale.

// Compute the epoch ms for "Monday 00:00 Asia/Manila" of the week containing `date`.
// Returns a stable integer that's the same for every moment within the same week.
export function manilaMondayEpoch(date = new Date()) {
  // Format the date in Manila as YYYY-MM-DD.
  const manilaDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  const [y, m, d] = manilaDateStr.split("-").map(Number);
  // Weekday of that Manila date (0=Sun, 1=Mon, ..., 6=Sat).
  // We use the Gregorian calendar via Date — this is consistent with what
  // the user sees on their phone.
  const weekday = new Date(y, m - 1, d).getDay();
  // Days since Monday (Mon=0, Tue=1, ..., Sun=6).
  const daysSinceMonday = (weekday + 6) % 7;
  // Epoch for "today 00:00 Manila" in UTC (Manila = UTC+8, no DST).
  const manilaMidnightUtc = Date.UTC(y, m - 1, d) - 8 * 3600 * 1000;
  // Subtract days to get Monday 00:00 Manila.
  return manilaMidnightUtc - daysSinceMonday * 24 * 3600 * 1000;
}

// Check if a weekly reset is needed, and if so, do it.
// Idempotent. Safe to call from any code path (login, awardPoints).
// Returns true if a reset happened, false otherwise.
export async function maybeResetWeeklyPoints() {
  const settingsC = await col("settings");
  const s = await getSettings();
  const currentWeek = manilaMondayEpoch();
  const lastResetWeek = s.weekly_reset_at ? manilaMondayEpoch(new Date(s.weekly_reset_at)) : 0;
  if (currentWeek <= lastResetWeek) return false;

  // Reset weekly_points for all non-admin profiles.
  const profilesC = await col("profiles");
  const r = await profilesC.updateMany(
    { role: { $ne: "admin" } },
    { $set: { weekly_points: 0 } }
  );
  // Stamp the new week.
  await settingsC.updateOne(
    { id: 1 },
    { $set: { weekly_reset_at: new Date() } },
    { upsert: true }
  );
  console.log(`[leaderboard] Weekly points reset for ${r.matchedCount} profiles (week of ${new Date(currentWeek).toISOString()}).`);
  return true;
}

