import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAdminSessionTokenAsync } from "@/lib/auth-edge";

export async function middleware(request: NextRequest) {
  const adminCookie = request.cookies.get("atbash_admin")?.value;
  const secret = process.env.AUTH_SECRET || "dev-only-insecure-secret-change-in-production";
  
  const isValid = await verifyAdminSessionTokenAsync(adminCookie, secret);
  if (!isValid) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

