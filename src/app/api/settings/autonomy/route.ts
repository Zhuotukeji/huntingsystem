import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { getAutonomySettings, saveAutonomySettings } from "@/lib/settings";

export async function GET() {
  const auth = await authorizeApi("settings.view");
  return "response" in auth ? auth.response : NextResponse.json({ data: getAutonomySettings() });
}

export async function PUT(request: Request) {
  const auth = await authorizeApi("settings.manage");
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ data: saveAutonomySettings(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存自主设置失败" }, { status: 400 });
  }
}
