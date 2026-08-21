import { NextResponse } from "next/server";
import { getAccessOverview } from "@/lib/access-control";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApi("access.view");
  if ("response" in auth) return auth.response;
  return NextResponse.json({ data: getAccessOverview() });
}
