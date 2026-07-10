#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  decryptBackupBuffer,
  deriveBackupKey,
  encryptBackupBuffer,
  sha256Buffer
} from "./lib/zero-cost-backup-crypto.mjs";

const salt = crypto.randomBytes(16);
const key = deriveBackupKey("correct horse battery staple backup", salt);
const plain = Buffer.from("CREATE TABLE public.example(id uuid primary key);\nCOPY public.example FROM stdin;\n", "utf8");
const encrypted = encryptBackupBuffer(plain, key);
const restored = decryptBackupBuffer(encrypted, key);

assert.deepEqual(restored, plain);
assert.equal(sha256Buffer(restored), sha256Buffer(plain));
assert.notEqual(sha256Buffer(encrypted.ciphertext), sha256Buffer(plain));

const tampered = {
  ...encrypted,
  ciphertext: Buffer.from(encrypted.ciphertext)
};
tampered.ciphertext[0] ^= 0xff;
assert.throws(() => decryptBackupBuffer(tampered, key));

const wrongKey = deriveBackupKey("a different backup passphrase value", salt);
assert.throws(() => decryptBackupBuffer(encrypted, wrongKey));
assert.throws(() => deriveBackupKey("too short", salt));

key.fill(0);
wrongKey.fill(0);
console.log("[backup:crypto-test] AES-256-GCM round-trip and tamper detection passed");
