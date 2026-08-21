import { NextResponse } from "next/server";
import { getGraphData } from "@/lib/learning";
import { authorizeApi } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeApi("graph.view");
  if ("response" in auth) return auth.response;
  const campaignId = new URL(request.url).searchParams.get("campaignId") || undefined;
  return NextResponse.json({ data: getGraphData(campaignId) });
}
