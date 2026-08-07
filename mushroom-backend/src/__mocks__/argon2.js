/**
 * Lightweight argon2 mock for Jest unit tests.
 * Uses Node's built-in crypto so tests run without the native argon2 binary.
 * DO NOT use this in production.
 */
const crypto = require('crypto');

const argon2id = 2;

function hash(data, _opts) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.createHash('sha256').update(salt + data).digest('hex');
  return Promise.resolve(`$argon2id$v=19$test$${salt}$${h}`);
}

function verify(hashed, plain) {
  const parts = hashed.split('$');
  // Format: $argon2id$v=19$test$<salt>$<hash>
  if (parts.length < 6) return Promise.resolve(false);
  const salt = parts[4];
  const expected = parts[5];
  const actual = crypto.createHash('sha256').update(salt + plain).digest('hex');
  return Promise.resolve(actual === expected);
}

module.exports = { hash, verify, argon2id };
