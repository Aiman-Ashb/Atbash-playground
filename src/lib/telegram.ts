/**
 * Telegram Login verification.
 *
 * The Telegram Login Widget hands the browser a signed user object; we verify
 * the signature server-side per Telegram's spec so the identity can't be forged:
 *   secret = SHA256(bot_token)
 *   hmac   = HMAC_SHA256(data_check_string, secret)
 *   valid  ⇔ hmac === payload.hash  (and auth_date is recent)
 *
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * Telegram is only an IDENTITY here — once verified, the contestant chats with
 * the SAME Hermes agent through the same relay. We do not proxy the Telegram
 * bot (the Bot API can't send messages to a bot on a user's behalf).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

/** Dev/no-bot mode: accept a simulated login without a real signature. */
export function isTelegramMock(): boolean {
  return (process.env.TELEGRAM_MOCK ?? "0") === "1" || !process.env.TELEGRAM_BOT_TOKEN;
}

/** Public bot username for the widget (or empty if Telegram login is off). */
export function telegramBotUsername(): string {
  return process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "";
}

export type TelegramVerifyResult =
  | { ok: true; user: TelegramUser }
  | { ok: false; error: string };

export function verifyTelegramLogin(payload: Record<string, unknown>): TelegramVerifyResult {
  const id = Number(payload.id);
  const auth_date = Number(payload.auth_date);
  if (!id || !auth_date) return { ok: false, error: "Malformed Telegram payload." };

  const user: TelegramUser = {
    id,
    first_name: typeof payload.first_name === "string" ? payload.first_name : undefined,
    last_name: typeof payload.last_name === "string" ? payload.last_name : undefined,
    username: typeof payload.username === "string" ? payload.username : undefined,
    photo_url: typeof payload.photo_url === "string" ? payload.photo_url : undefined,
    auth_date,
    hash: String(payload.hash ?? ""),
  };

  // Dev mock: trust the payload as-is (no bot token configured).
  if (isTelegramMock()) return { ok: true, user };

  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!user.hash) return { ok: false, error: "Missing Telegram hash." };

  // Reject stale logins (replay window: 24h).
  if (Date.now() / 1000 - auth_date > 86400) return { ok: false, error: "Telegram login expired." };

  // Build the data-check-string from all fields except `hash`, sorted by key.
  const dataCheckString = Object.keys(payload)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${payload[k as keyof typeof payload]}`)
    .join("\n");

  const secret = createHash("sha256").update(token).digest();
  const hmac = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(hmac);
  const b = Buffer.from(user.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "Telegram signature check failed." };
  }
  return { ok: true, user };
}

/** Human label for a verified Telegram user. */
export function telegramLabel(u: TelegramUser): string {
  if (u.username) return `@${u.username}`;
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return name || `tg:${u.id}`;
}
