import crypto from "node:crypto";

export function deriveBackupKey(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 24) {
    throw new Error("Backup encryption passphrase must contain at least 24 characters.");
  }
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
  if (saltBuffer.length < 16) throw new Error("Backup encryption salt must contain at least 16 bytes.");
  return crypto.scryptSync(passphrase, saltBuffer, 32);
}

export function encryptBackupBuffer(plain, key) {
  const plainBuffer = Buffer.isBuffer(plain) ? plain : Buffer.from(plain);
  assertKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  return { iv, ciphertext, authTag: cipher.getAuthTag() };
}

export function decryptBackupBuffer(encrypted, key) {
  assertKey(key);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv));
  decipher.setAuthTag(Buffer.from(encrypted.authTag));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext)),
    decipher.final()
  ]);
}

export function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Backup encryption key must be a 32-byte Buffer.");
  }
}
