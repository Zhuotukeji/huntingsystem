import { db, now } from "@/lib/db";

const campaignId = "campaign-overseas-gm";

function clearDatabase() {
  db.exec(`
    DELETE FROM plugin_sessions;
    DELETE FROM learning_recommendations;
    DELETE FROM learning_weights;
    DELETE FROM search_task_feedback;
    DELETE FROM search_tasks;
    DELETE FROM ai_run_items;
    DELETE FROM ai_runs;
    DELETE FROM graph_edges;
    DELETE FROM organization_facts;
    DELETE FROM person_skills;
    DELETE FROM skills;
    DELETE FROM employments;
    DELETE FROM profile_versions;
    DELETE FROM feedback;
    DELETE FROM sources;
    DELETE FROM tasks;
    DELETE FROM evidence;
    DELETE FROM resume_documents;
    DELETE FROM campaign_people;
    DELETE FROM people;
    DELETE FROM campaign_organizations;
    DELETE FROM organizations;
    DELETE FROM campaigns;
  `);
}

export function seedDatabase(force = false) {
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM campaigns").get() as { count: number }).count);
  if (count > 0 && !force) return;
  if (force) clearDatabase();
  const stamp = now();
  db.prepare(`INSERT INTO campaigns
    (id, name, role_name, status, owner_name, business_goal, value_proposition, locations_json, markets_json, channels_json, must_haves_json, nice_to_haves_json, exclusions_json, target_organization_count, target_person_count, weekly_target, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      campaignId,
      "海外项目负责人寻访",
      "海外项目负责人 / General Manager",
      "ACTIVE",
      "陈晨",
      "在 12 个月内建立海外广告变现业务，完成从 0 到 1 的团队和收入验证。",
      "独立业务决策权、成熟供应链资源、核心团队搭建空间。",
      JSON.stringify(["广州", "深圳", "杭州", "远程"]),
      JSON.stringify(["欧美", "东南亚"]),
      JSON.stringify(["Google", "Meta", "TikTok", "SEO"]),
      JSON.stringify(["有海外业务 P&L 或项目全盘经验", "带领 8 人以上跨职能团队", "熟悉广告或联盟变现"]),
      JSON.stringify(["0 到 1 产品经验", "有东南亚市场落地经验"]),
      JSON.stringify(["纯代运营背景", "无可验证海外业务经历"]),
      100,
      150,
      20,
      stamp,
      stamp,
    );
  db.prepare(`INSERT INTO profile_versions (id, campaign_id, version, criteria_json, is_active, created_by, created_at)
    VALUES ('profile-overseas-gm-v1', ?, 1, ?, 1, '系统初始化', ?)`)
    .run(campaignId, JSON.stringify({ roleName: "海外项目负责人 / General Manager", northStarMetric: "高匹配有效沟通人数", minimumSamplesBeforeRecommendation: 3 }), stamp);
  db.prepare(`INSERT INTO tasks
    (id, campaign_id, type, status, title, result_summary, payload_json, steps_json, attempts, max_attempts, model_name, estimated_cost, idempotency_key, created_at, completed_at)
    VALUES ('task-onboarding', ?, 'ONBOARDING', 'WAITING_HUMAN', '导入第一批授权简历', '当前公司与人才库为空；导入简历后运行一次 AI 学习即可生成图谱与 BOSS 搜索任务。', '{}', ?, 0, 3, 'system', 0, 'task-onboarding', ?, NULL)`)
    .run(campaignId, JSON.stringify(["在简历库导入 PDF、DOCX、TXT 或结构化文本", "确认简历来源与处理依据", "在 AI 学习页面触发增量学习", "审核公司图谱并执行 BOSS 搜索任务"]), stamp);
}

if (process.env.DEMO_MODE !== "false") seedDatabase();
