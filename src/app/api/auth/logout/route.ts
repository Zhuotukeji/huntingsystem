import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeWebSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) revokeWebSession(token);
  const response = NextResponse.json({ data: { loggedOut: true } });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return response;
}
