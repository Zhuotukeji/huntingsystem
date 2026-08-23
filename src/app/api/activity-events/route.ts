import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { listActivityEvents } from "@/lib/autonomy";

export async function GET(request: Request) {
  const auth = await authorizeApi("reviews.view");
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ data: listActivityEvents({ campaignId: params.get("campaignId") || undefined, personId: params.get("personId") || undefined, limit: Number(params.get("limit") || 100) }) });
}
