import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyAdminSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/admin/telegram-lookup?handle=<@username|id>
 *
 * Resolves a Telegram handle via the bot's getChat to tell the admin whether
 * it's a REAL, registered account (and its real display name/id) before they
 * approve a pending request. Confirms EXISTENCE, not ownership — the person
 * typing the handle still isn't proven to be it, so admin judgement applies.
 *
 * Note: works for public @usernames. A bare numeric id only resolves if that
 * user has interacted with the bot (Telegram API limitation).
 */
export async function GET(req: Request) {
  const jar = await cookies();
  if (!verifyAdminSessionToken(jar.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Admin only." }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Lookup unavailable — no bot token configured." }, { status: 503 });
  }

  const raw = (new URL(req.url).searchParams.get("handle") || "").trim().replace(/^@/, "");
  if (!raw || !/^[A-Za-z0-9_]+$/.test(raw)) {
    return NextResponse.json({ error: "Invalid handle." }, { status: 400 });
  }
  const chatId = /^\d+$/.test(raw) ? raw : `@${raw}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
    const data = (await res.json()) as {
      ok: boolean;
      result?: { id: number; type: string; username?: string; first_name?: string; last_name?: string };
      description?: string;
    };
    if (!data.ok || !data.result) {
      // Telegram returns ok:false for unknown usernames / unreachable ids.
      return NextResponse.json({ exists: false, reason: data.description || "Not found or not reachable by the bot." });
    }
    const r = data.result;
    return NextResponse.json({
      exists: true,
      id: r.id,
      username: r.username ?? null,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
      type: r.type,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lookup failed." }, { status: 502 });
  }
}
