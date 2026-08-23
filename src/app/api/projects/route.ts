import { NextResponse } from "next/server";
import { authorizeApi } from "@/lib/auth";
import { listProjects } from "@/lib/autonomy";

export async function GET(request: Request) {
  const auth = await authorizeApi("intelligence.view");
  if ("response" in auth) return auth.response;
  const organizationId = new URL(request.url).searchParams.get("organizationId") || undefined;
  return NextResponse.json({ data: listProjects(organizationId) });
}
