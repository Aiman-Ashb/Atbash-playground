import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyAdminSessionToken } from "@/lib/auth";
import { generateCode, listCodes, revokeCode } from "@/lib/codes";

export const runtime = "nodejs";

async function requireAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifyAdminSessionToken(jar.get(ADMIN_COOKIE)?.value);
}

/** GET — list admin-generated codes (with status). */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 401 });
  return NextResponse.json({ codes: listCodes() });
}

/** POST { label?, role? } — mint a fresh unique code (contestant or admin). */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 401 });
  const { label, role } = (await req.json().catch(() => ({}))) as { label?: string; role?: string };
  const codeRole = role === "admin" ? "admin" : "contestant";
  return NextResponse.json({ code: generateCode(label, codeRole) });
}

/** DELETE { code } — revoke (cancel) a code. */
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 401 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code) return NextResponse.json({ error: "code required." }, { status: 400 });
  return NextResponse.json({ ok: revokeCode(code) });
}
