import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidAdminPassword, makeToken, ADMIN_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/** POST /api/admin/login — { password }. Sets the admin cookie on success. */
export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !isValidAdminPassword(password)) {
    return NextResponse.json({ error: "Invalid admin password." }, { status: 401 });
  }
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, makeToken("admin"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h
  });
  return NextResponse.json({ ok: true });
}
