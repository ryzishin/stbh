// scripts/cipher.js — dev utility to print the cipher password for an LRN.
// Usage:
//   node scripts/cipher.js 123456789012
//   node scripts/cipher.js 123456789012 987654321098
//
// Output: prints the cipher password(s) the student should type at /login.
//
// Algorithm: each digit → QWERTY row letter (0→Q, 1→W, 2→E, 3→R, 4→T, 5→Y, 6→U, 7→I, 8→O, 9→P)
import { cipher, decipher, isValidLRN } from "../src/config/cipher.js";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/cipher.js <LRN> [more LRNs...]");
  console.error("       node scripts/cipher.js --decipher <password>");
  process.exit(1);
}

if (args[0] === "--decipher") {
  const pwd = args[1];
  if (!pwd) { console.error("Provide a password to decipher."); process.exit(1); }
  console.log(`Password: ${pwd}`);
  console.log(`LRN:      ${decipher(pwd)}`);
} else {
  for (const lrn of args) {
    if (!isValidLRN(lrn)) {
      console.error(`✗ "${lrn}" is not a valid 12-digit LRN — skipped.`);
      continue;
    }
    console.log(`LRN:      ${lrn}`);
    console.log(`Password: ${cipher(lrn)}`);
    console.log("");
  }
}
