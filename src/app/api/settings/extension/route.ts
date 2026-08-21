import { NextResponse } from "next/server";
import { getChromeDistributionSettings, saveChromeDistributionSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ data: getChromeDistributionSettings() });
}

export async function PUT(request: Request) {
  try {
    const input = await request.json();
    return NextResponse.json({ data: saveChromeDistributionSettings(String(input.webStoreUrl || "")) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Chrome 分发设置保存失败" }, { status: 400 });
  }
}
