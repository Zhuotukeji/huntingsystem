import { NextResponse } from "next/server";
import { EXTENSION_VERSION, PLUGIN_API_VERSION } from "@/lib/extension-delivery";
import { pluginCorsHeaders } from "@/lib/plugin-auth";
import { getPublicAiSettings, hasPluginAccessCode } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() { return new Response(null, { status: 204, headers: pluginCorsHeaders }); }

export function GET() {
  const ai = getPublicAiSettings();
  return NextResponse.json({ data: {
    service: "觅才人才情报系统",
    version: PLUGIN_API_VERSION,
    extensionVersion: EXTENSION_VERSION,
    ready: true,
    loginConfigured: hasPluginAccessCode(),
    ai: { enabled: ai.enabled, hasApiKey: ai.hasApiKey, screenAnalysisEnabled: ai.screenAnalysisEnabled, model: ai.model },
    checkedAt: new Date().toISOString(),
  } }, { headers: { ...pluginCorsHeaders, "Cache-Control": "no-store" } });
}
