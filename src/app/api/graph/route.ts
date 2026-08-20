import { NextResponse } from "next/server";
import { getGraphData } from "@/lib/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const campaignId = new URL(request.url).searchParams.get("campaignId") || undefined;
  return NextResponse.json({ data: getGraphData(campaignId) });
}
