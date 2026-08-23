import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { testAiWebSearchCapability } from "@/lib/llm";
import { setWebSearchCapability } from "@/lib/settings";

export async function POST() {
  const auth = await authorizeApi("intelligence.manage");
  if ("response" in auth) return auth.response;
  try {
    const data = await testAiWebSearchCapability();
    setWebSearchCapability("AVAILABLE");
    return NextResponse.json({ data });
  } catch (error) {
    setWebSearchCapability("UNAVAILABLE");
    return NextResponse.json({ error: error instanceof Error ? error.message : "联网能力检测失败" }, { status: 400 });
  }
}
