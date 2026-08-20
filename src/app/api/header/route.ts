import { getHeaderNotifications, searchHeaderData } from "@/lib/header-data";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q");
    if (query !== null) return Response.json({ data: { results: searchHeaderData(query) } });
    return Response.json({ data: getHeaderNotifications() });
  } catch {
    return Response.json({ error: "顶部栏数据加载失败" }, { status: 500 });
  }
}
