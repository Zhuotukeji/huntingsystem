import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { EXTENSION_ARTIFACT_PATH, EXTENSION_FILE_NAME } from "@/lib/extension-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const archive = await readFile(EXTENSION_ARTIFACT_PATH);
    return new Response(archive, { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${EXTENSION_FILE_NAME}"`,
      "Cache-Control": "no-store",
    } });
  } catch {
    return NextResponse.json({ error: "插件分发包尚未生成，请先运行 pnpm extension:pack" }, { status: 404 });
  }
}
