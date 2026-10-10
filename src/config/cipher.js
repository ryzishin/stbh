// src/config/cipher.js
// LRN ↔ password cipher — a simple, reversible substitution.
//
// Algorithm: each digit is replaced by its QWERTY-row letter.
//   0 → Q    1 → W    2 → E    3 → R    4 → T
//   5 → Y    6 → U    7 → I    8 → O    9 → P
//
// So LRN `123456789012` becomes password `WERTYUIOPWE`.
//
// Why QWERTY row?
//   - Easy for students to type on any keyboard.
//   - Each student's password is unique (derived from their unique LRN).
//   - The developer can compute the password from the LRN anytime (no DB lookup needed).
//   - The actual password is stored as a bcrypt hash — never as plaintext.
//
// This is a cipher, NOT encryption. It only obscures the password from casual
// observation. The real security comes from bcrypt hashing on the server.

const ENCODE = {
  "0": "Q", "1": "W", "2": "E", "3": "R", "4": "T",
  "5": "Y", "6": "U", "7": "I", "8": "O", "9": "P",
};

const DECODE = Object.fromEntries(
  Object.entries(ENCODE).map(([k, v]) => [v, k])
);

// LRN (string or number) → cipher password (string of letters)
export function cipher(lrn) {
  return String(lrn || "")
    .split("")
    .map((c) => ENCODE[c] ?? c)
    .join("");
}

// Cipher password → original LRN
export function decipher(password) {
  return String(password || "")
    .split("")
    .map((c) => DECODE[c] ?? c)
    .join("");
}

// Validate that a string looks like an LRN (12 digits)
export function isValidLRN(lrn) {
  return /^\d{12}$/.test(String(lrn || "").trim());
}

const cipherModule = { cipher, decipher, isValidLRN };
export default cipherModule;
