import "@/lib/seed";
import { db } from "@/lib/db";

type Row = Record<string, string | number | null>;

export type HeaderSearchKind = "campaign" | "resume" | "organization" | "person" | "search-task";

export interface HeaderSearchResult {
  id: string;
  kind: HeaderSearchKind;
  label: string;
  title: string;
  description: string;
  href: string;
}

export interface HeaderNotification {
  id: string;
  kind: "organization" | "person" | "resume" | "search-task" | "learning";
  title: string;
  description: string;
  href: string;
  count: number;
}

const searchLabels: Record<HeaderSearchKind, string> = {
  campaign: "寻访战役",
  resume: "简历",
  organization: "公司",
  person: "人选",
  "search-task": "BOSS 任务",
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function result(input: Omit<HeaderSearchResult, "label">): HeaderSearchResult {
  return { ...input, label: searchLabels[input.kind] };
}

function resultHref(path: string, query: string) {
  return `${path}?q=${encodeURIComponent(query)}`;
}

export function searchHeaderData(rawQuery: string, limit = 12): HeaderSearchResult[] {
  const query = rawQuery.trim().slice(0, 80);
  if (!query) return [];
  const pattern = `%${escapeLike(query)}%`;
  const values = [pattern, pattern, pattern];

  const campaigns = db.prepare(`SELECT id, name, role_name, business_goal
    FROM campaigns
    WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR role_name LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR business_goal LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY CASE WHEN name = ? COLLATE NOCASE THEN 0 WHEN name LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 1 ELSE 2 END, updated_at DESC
    LIMIT 4`).all(...values, query, `${escapeLike(query)}%`) as Row[];

  const resumes = db.prepare(`SELECT r.id, r.file_name, p.name, p.headline, c.name AS campaign_name
    FROM resume_documents r
    JOIN campaigns c ON c.id = r.campaign_id
    LEFT JOIN people p ON p.id = r.person_id
    WHERE r.file_name LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR p.name LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR p.headline LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR EXISTS (
         SELECT 1 FROM employments e
         WHERE e.resume_id = r.id
           AND (e.raw_company_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR e.raw_title LIKE ? ESCAPE '\\' COLLATE NOCASE)
       )
    ORDER BY r.updated_at DESC
    LIMIT 4`).all(pattern, pattern, pattern, pattern, pattern) as Row[];

  const organizations = db.prepare(`SELECT DISTINCT o.id, o.name, o.location, co.category, c.name AS campaign_name
    FROM campaign_organizations co
    JOIN organizations o ON o.id = co.organization_id
    JOIN campaigns c ON c.id = co.campaign_id
    WHERE EXISTS (
      SELECT 1 FROM employments e JOIN resume_documents r ON r.id = e.resume_id
      WHERE e.organization_id = co.organization_id AND r.campaign_id = co.campaign_id
    )
      AND (o.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR o.location LIKE ? ESCAPE '\\' COLLATE NOCASE OR co.category LIKE ? ESCAPE '\\' COLLATE NOCASE)
    ORDER BY co.fit_score DESC, co.updated_at DESC
    LIMIT 4`).all(...values) as Row[];

  const people = db.prepare(`SELECT DISTINCT p.id, p.name, p.headline, p.location, o.name AS organization_name, c.name AS campaign_name
    FROM campaign_people cp
    JOIN people p ON p.id = cp.person_id
    JOIN organizations o ON o.id = cp.organization_id
    JOIN campaigns c ON c.id = cp.campaign_id
    WHERE p.name LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR p.headline LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR p.location LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR o.name LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR cp.slot LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY cp.fit_score DESC, cp.updated_at DESC
    LIMIT 4`).all(pattern, pattern, pattern, pattern, pattern) as Row[];

  const searchTasks = db.prepare(`SELECT s.id, s.title, s.company_name, s.status, c.name AS campaign_name
    FROM search_tasks s
    JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.title LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR s.company_name LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR s.query_json LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY s.priority DESC, s.created_at DESC
    LIMIT 4`).all(...values) as Row[];

  const results = [
    ...campaigns.map((row) => result({ id: String(row.id), kind: "campaign", title: String(row.name), description: `${row.role_name} · ${row.business_goal}`, href: `/campaigns/${row.id}` })),
    ...people.map((row) => result({ id: String(row.id), kind: "person", title: String(row.name), description: `${row.organization_name || "公司待识别"} · ${row.headline || row.location || row.campaign_name}`, href: resultHref("/people", String(row.name)) })),
    ...organizations.map((row) => result({ id: String(row.id), kind: "organization", title: String(row.name), description: `${row.location || "地区待确认"} · ${row.category || row.campaign_name}`, href: resultHref("/organizations", String(row.name)) })),
    ...resumes.map((row) => {
      const title = String(row.name || row.file_name);
      return result({ id: String(row.id), kind: "resume", title, description: `${row.headline || row.file_name} · ${row.campaign_name}`, href: resultHref("/resumes", title) });
    }),
    ...searchTasks.map((row) => result({ id: String(row.id), kind: "search-task", title: String(row.title), description: `${row.campaign_name} · ${row.status}`, href: resultHref("/search-tasks", String(row.company_name || row.title)) })),
  ];

  const normalized = query.toLocaleLowerCase("zh-CN");
  return results
    .sort((left, right) => {
      const score = (item: HeaderSearchResult) => item.title.toLocaleLowerCase("zh-CN") === normalized ? 0 : item.title.toLocaleLowerCase("zh-CN").startsWith(normalized) ? 1 : 2;
      return score(left) - score(right);
    })
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

export function getHeaderNotifications() {
  const count = (sql: string) => Number((db.prepare(sql).get() as Row).count);
  const candidates: HeaderNotification[] = [
    {
      id: "organizations-pending",
      kind: "organization",
      title: "公司等待审核",
      description: "确认业务匹配、人才迁移性和简历证据",
      href: "/organizations",
      count: count("SELECT COUNT(*) AS count FROM campaign_organizations WHERE status = 'PENDING_REVIEW'"),
    },
    {
      id: "people-pending",
      kind: "person",
      title: "人选等待判断",
      description: "审核画像匹配度和需要补充的未知项",
      href: "/people",
      count: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status IN ('PENDING_REVIEW','NEEDS_RESEARCH')"),
    },
    {
      id: "resumes-pending",
      kind: "resume",
      title: "简历等待处理",
      description: "运行增量学习或复核失败的识别结果",
      href: "/resumes",
      count: count("SELECT COUNT(*) AS count FROM resume_documents WHERE status IN ('PENDING','FAILED','NEEDS_REVIEW')"),
    },
    {
      id: "search-tasks-open",
      kind: "search-task",
      title: "BOSS 任务待执行",
      description: "按优先级领取搜索任务并回填有效沟通",
      href: "/search-tasks",
      count: count("SELECT COUNT(*) AS count FROM search_tasks WHERE status IN ('NEW','CLAIMED','IN_PROGRESS','DEFERRED')"),
    },
    {
      id: "learning-failed",
      kind: "learning",
      title: "AI 学习运行失败",
      description: "查看失败阶段和错误信息后重新运行",
      href: "/learning",
      count: count("SELECT COUNT(*) AS count FROM ai_runs WHERE status = 'FAILED'"),
    },
  ];
  const items = candidates.filter((item) => item.count > 0);

  return { count: items.reduce((total, item) => total + item.count, 0), items };
}
