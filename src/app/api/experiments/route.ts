import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { createExperiment, listExperiments } from "@/lib/autonomy";

export async function GET(request: Request) {
  const auth = await authorizeApi("strategies.view");
  if ("response" in auth) return auth.response;
  const campaignId = new URL(request.url).searchParams.get("campaignId") || undefined;
  return NextResponse.json({ data: listExperiments(campaignId) });
}

export async function POST(request: Request) {
  const auth = await authorizeApi("strategies.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = await request.json();
    const data = createExperiment({ campaignId: String(input.campaignId || ""), name: String(input.name || ""), dimension: input.dimension, arms: input.arms, createdBy: auth.user.email });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建实验失败" }, { status: 400 });
  }
}
