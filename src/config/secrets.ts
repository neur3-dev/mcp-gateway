import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(encoded: string, keyHex: string): string {
  if (!encoded.startsWith("enc:")) return encoded;
  const parts = encoded.split(":");
  const ivHex = parts[1];
  const tagHex = parts[2];
  const cipherHex = parts[3];
  const key = Buffer.from(keyHex, "hex");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(cipherHex, "hex")).toString("utf8") + decipher.final("utf8");
}
