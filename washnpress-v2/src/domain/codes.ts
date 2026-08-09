import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateQrBatchCode(rng: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return `WNP-${s}`;
}

export function generateOrderCode(): string {
  const n = randomInt(100000, 999999);
  return `ORD-${n}`;
}
