(function registerReviewMode(target) {
  const campaign = {
    id: "review-campaign-overseas-lead",
    name: "商店审核演示画像",
    roleName: "海外项目负责人",
  };

  const tasks = [
    {
      id: "review-task-growth-lead",
      campaignId: campaign.id,
      campaignName: campaign.name,
      companyName: "合成海外工具公司池",
      title: "搜索海外增长负责人",
      priority: 92,
      status: "NEW",
      reason: { summary: "合成简历显示海外增长、商业化与团队管理为高频有效线索。" },
      query: {
        keywords: ["海外增长负责人", "商业化", "团队管理"],
        locations: ["广州"],
        instructions: ["优先查看具有工具出海或订阅增长经历的人才", "进入详情后核实经营结果与团队规模"],
      },
    },
    {
      id: "review-task-monetization-lead",
      campaignId: campaign.id,
      campaignName: campaign.name,
      companyName: "合成广告变现公司池",
      title: "扩展广告变现负责人候选人",
      priority: 84,
      status: "NEW",
      reason: { summary: "合成公司图谱新增广告变现与新兴市场的高置信度关系。" },
      query: {
        keywords: ["广告变现负责人", "新兴市场", "P&L"],
        locations: ["深圳"],
        instructions: ["关注同时具备增长和收入责任的负责人", "记录关键词偏差并提交合成反馈"],
      },
    },
  ];

  const candidates = [
    {
      alias: "合成候选人 A",
      currentTitle: "海外业务负责人",
      currentCompany: "广州星云科技（合成）",
      location: "广州",
      experience: "10 年经验",
      score: 88,
      verdict: "建议沟通",
      evidence: [
        "当前可见页显示负责海外工具产品商业化与广告变现",
        "当前可见页显示管理 18 人跨职能团队",
        "当前可见页显示覆盖欧美、东南亚和拉美市场",
      ],
      unknowns: ["年度收入规模未在当前可见区域披露", "当前离职意愿需要人工沟通核实"],
    },
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createCampaigns() {
    return [clone(campaign)];
  }

  function createTasks() {
    return clone(tasks);
  }

  function analyzeVisibleScreenshot(imageDataUrl) {
    if (!String(imageDataUrl || "").startsWith("data:image/")) throw new Error("没有获得当前可见页截图");
    return {
      note: "商店审核模式：截图仅在插件内存中验证，以下为合成判断结果；没有连接后台或 Sub2API。",
      candidates: clone(candidates),
    };
  }

  function greetingDraft() {
    return "你好，看到你在海外工具产品增长、商业化和团队管理方面的合成经历，与我们演示画像较为契合，想和你交流一下相关机会。此内容为商店审核模式生成的合成草稿。";
  }

  function scanResult(frameCount) {
    return {
      candidateName: "周明远（合成候选人）",
      frameCount,
      employments: 3,
      skills: 10,
      organizations: 3,
    };
  }

  target.HuntingReviewMode = { createCampaigns, createTasks, analyzeVisibleScreenshot, greetingDraft, scanResult };
})(globalThis);
