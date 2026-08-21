import { getHeaderNotifications, searchHeaderData } from "@/lib/header-data";
import { authorizeApi } from "@/lib/auth";
import type { PermissionCode } from "@/lib/access-control";

const routePermissions: [string, PermissionCode][] = [
  ["/campaigns", "campaigns.view"], ["/resumes", "resumes.view"], ["/organizations", "organizations.view"],
  ["/people", "people.view"], ["/search-tasks", "search_tasks.view"], ["/learning", "learning.view"],
];

function canOpen(href: string, permissions: PermissionCode[]) {
  const match = routePermissions.find(([path]) => href.startsWith(path));
  return !match || permissions.includes(match[1]);
}

export async function GET(request: Request) {
  const auth = await authorizeApi();
  if ("response" in auth) return auth.response;
  try {
    const query = new URL(request.url).searchParams.get("q");
    if (query !== null) return Response.json({ data: { results: searchHeaderData(query).filter((item) => canOpen(item.href, auth.user.permissions)) } });
    const notifications = getHeaderNotifications().items.filter((item) => canOpen(item.href, auth.user.permissions));
    return Response.json({ data: { count: notifications.reduce((total, item) => total + item.count, 0), items: notifications } });
  } catch {
    return Response.json({ error: "顶部栏数据加载失败" }, { status: 500 });
  }
}
