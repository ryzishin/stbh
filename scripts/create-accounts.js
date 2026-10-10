// scripts/create-accounts.js — bulk-create accounts from a CSV file.
//
// CSV format (one account per line, header optional):
//   uid,user,name,role
//   123456789012,althea,Althea Reyes,student       ← students typically use their LRN as UID
//   123456789013,bianca,Bianca Cruz,student
//   ms.roa,ms.roa,Ms. Patricia Roa,admin           ← admins can use any unique UID
//
// Backwards compatibility: the CSV header may also say `lrn,name,role` (3-col format).
// In that case, `username` defaults to a derived slug of the name.
//
// If `uid` looks like a 12-digit LRN, the initial password is the QWERTY cipher of it
// (so students can derive it themselves). If `uid` is something else (e.g. "ms.roa"),
// a random 8-character password is generated and printed once.
//
// The password is bcrypt-hashed (cost 12) and stored in `profiles.password_hash`.
//
// Usage:
//   node scripts/create-accounts.js path/to/accounts.csv
//   node scripts/create-accounts.js path/to/accounts.csv --dry-run
//
// Re-runnable: existing UIDs are skipped, so you can append rows and re-run safely.

import fs from "node:fs";
import bcrypt from "bcryptjs";
import { getDb, col } from "../src/config/mongo.js";
import { cipher, isValidLRN } from "../src/config/cipher.js";

const CSV_PATH = process.argv[2];
const DRY_RUN = process.argv.includes("--dry-run");

if (!CSV_PATH) {
  console.error("Usage: node scripts/create-accounts.js <csv-path> [--dry-run]");
  console.error("");
  console.error("CSV format (header optional):");
  console.error("  uid,user,name,role            (4-col, recommended)");
  console.error("  123456789012,althea,Althea Reyes,student");
  console.error("  ms.roa,ms.roa,Ms. Patricia Roa,admin");
  console.error("");
  console.error("Legacy 3-col format also works:");
  console.error("  uid,name,role                 (username auto-derived from name)");
  console.error("  lrn,name,role                  (same as uid,name,role)");
  process.exit(1);
}

if (!fs.existsSync(CSV_PATH)) {
  console.error(`✗ File not found: ${CSV_PATH}`);
  process.exit(1);
}

function randomPassword(len = 8) {
  // Avoid ambiguous chars: 0/O, 1/l/I
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Derive a default username from a name: lowercase, ASCII-only, separators → dots.
function deriveUsername(name) {
  const base = String(name || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 20);
  return base || "user";
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const first = lines[0].toLowerCase();
  const hasHeader = (first.includes("uid") || first.includes("lrn") || first.includes("user")) && (first.includes("name") || first.includes("role"));
  const rows = hasHeader ? lines.slice(1) : lines;
  return rows
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(",").map((s) => (s || "").trim());
      if (cells.length === 4) {
        // uid,user,name,role
        return { uid: cells[0], username: cells[1], name: cells[2], role: cells[3] };
      } else if (cells.length === 3) {
        // uid,name,role  (or  lrn,name,role)
        const uid = cells[0];
        const name = cells[1];
        const role = cells[2];
        return { uid, username: deriveUsername(name), name, role };
      }
      // graceful fallback: just use what we have
      return { uid: cells[0], username: deriveUsername(cells[1] || cells[0]), name: cells[1] || "", role: cells[2] || "student" };
    });
}

async function main() {
  await getDb(); // ensure connection
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCSV(text);
  console.log(`Found ${rows.length} rows in ${CSV_PATH}${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}.\n`);

  let created = 0, skipped = 0, errors = 0;
  const profilesC = await col("profiles");

  for (const row of rows) {
    const { uid, username, name, role } = row;
    if (!uid) {
      console.error(`✗ Empty UID on row — skipped.`);
      errors++;
      continue;
    }
    if (uid.length < 3) {
      console.error(`✗ UID too short: "${uid}" (min 3 chars) — skipped.`);
      errors++;
      continue;
    }
    if (!/^[a-zA-Z0-9_.\-]+$/.test(username || "")) {
      console.error(`✗ Invalid username "${username}" — only letters, digits, dots, underscores, dashes. Skipped.`);
      errors++;
      continue;
    }
    const validRole = ["student", "subadmin", "admin"].includes(role) ? role : "student";
    const isLrn = isValidLRN(uid);
    const plaintextPassword = isLrn ? cipher(uid) : randomPassword(8);
    const mustChange = !isLrn;
    const displayName = (name?.trim()) || (isLrn ? `Student ${uid.slice(-8)}` : `User ${uid}`);
    const finalUsername = username || deriveUsername(displayName);

    if (DRY_RUN) {
      console.log(`[dry-run] Would create: UID=${uid}  username=${finalUsername}  Name="${displayName}"  Role=${validRole}  Password=${plaintextPassword}${mustChange ? '  (must-change on first login)' : ''}`);
      created++;
      continue;
    }

    // Check if UID already exists (case-insensitive).
    const existingUid = await profilesC.findOne(
      { uid },
      { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
    );
    if (existingUid) {
      console.warn(`! Skipped (UID already exists): UID=${uid}`);
      skipped++;
      continue;
    }
    // Check if username is taken (case-insensitive).
    const existingUsername = await profilesC.findOne(
      { username: finalUsername },
      { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
    );
    if (existingUsername) {
      // Auto-suffix: try username2, username3, ... up to username9.
      let candidate = finalUsername;
      let i = 2;
      while (i < 10) {
        candidate = `${finalUsername}${i}`;
        const taken = await profilesC.findOne(
          { username: candidate },
          { collation: { locale: "en", strength: 2 }, projection: { _id: 1 } }
        );
        if (!taken) break;
        i++;
      }
      console.warn(`! Username "${finalUsername}" taken — using "${candidate}" instead.`);
      finalUsername = candidate;
    }

    const passwordHash = await bcrypt.hash(plaintextPassword, 12);
    await profilesC.insertOne({
      uid,
      username: finalUsername,
      name: displayName,
      email: null,
      role: validRole,
      avatar_color: 152,
      avatar_url: null,
      password_hash: passwordHash,
      must_change_password: mustChange,
      points: 0,
      weekly_points: 0,
      streak_days: 0,
      last_active_date: new Date().toISOString().slice(0, 10),
      practice_quizzes_taken: 0,
      flashcards_reviewed: 0,
      created_at: new Date(),
    });
    console.log(`✓ Created: UID=${uid}  username=${finalUsername}  Name="${displayName}"  Role=${validRole}  Password=${plaintextPassword}${mustChange ? '  (must-change on first login)' : ''}`);
    created++;
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped, ${errors} errors.`);
  if (!DRY_RUN && created > 0) {
    console.log(`\nTell each user their initial password (or, for LRN users, have them run:`);
    console.log(`  node scripts/cipher.js <LRN>`);
    console.log(`Non-LRN users (admins with custom UIDs) must change their password on first login.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
