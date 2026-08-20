# 觅才 · AI 人才情报系统

面向 50-200 人互联网公司的 BOSS 主动寻访工作台。系统以企业合法取得的简历为事实源，把任职经历和技能沉淀成公司/人才图谱，再生成供 HR 在 BOSS 网页版手工执行的搜索任务。

## 核心闭环

1. HR 导入候选人主动提供、官方授权下载或其他具备明确处理依据的简历。
2. Sub2API `gpt-5.6` 结构化提取人才、公司、任职、技能和画像匹配证据。
3. 系统完成实体归一、图谱更新、公司评分和 BOSS 搜索任务生成。
4. HR 在 BOSS 手工搜索、判断和沟通，并回填结果数、合格数和有效沟通数。
5. 系统使用反馈小步更新有上下限的公司搜索权重；重要画像变更仍需人工审核。
6. Worker 每天北京时间 00:00 创建一次增量学习任务，重启后会自动补跑当天任务。

## 已实现

- 授权简历库：PDF、DOCX、TXT、Markdown、粘贴文本，10MB 限制、SHA-256 去重、180 天默认保留期。
- 公司/人才图谱：人物、公司、技能节点；现任、曾任、技能证据边；公司人才密度洞察。
- AI 学习中心：增量学习、全量重建、运行阶段/错误/指标审计、午夜调度。
- 搜索任务工作台：公司、职位、地区组合，优先级、复制关键词、打开 BOSS、结果反馈。
- 持续学习：贝叶斯平滑、小步更新、`0.65-1.35` 权重边界、至少 3 个样本后生成人审建议。
- Sub2API 配置页：Base URL、`gpt-5.6`、Chat Completions/Responses API、连接测试。
- 密钥保护：API Key 和插件访问码以 AES-256-GCM 密文存入 SQLite，接口不回传明文。
- Chrome MV3 侧边栏插件：内部登录、任务列表、搜索词、显式截图分析、个性化招呼语草稿。
- 无 AI 降级：未配置 Sub2API 时可解析带明确字段的结构化文本，不会生成虚构公司或候选人。

## 合规边界

插件没有 content script，不读取 BOSS DOM、Cookie、密码或验证码，不自动翻页、打开候选人、抓取简历或发送消息。截图只在 HR 点击后截取当前可见标签页，后端不保存原图；招呼语仅生成草稿，由 HR 审核后手工发送。完整简历只通过候选人分享、正式下载或其他已获授权的路径进入系统。

## 本地运行

要求 Node.js 24+ 与 pnpm 11+。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次启动只创建默认“海外项目负责人”人才画像，不创建虚构公司或人选。

启动午夜学习 Worker：

```bash
pnpm worker
```

也可在“数据源与设置”页面直接配置 Sub2API，不需要把 Key 写入环境变量。配置保存在 `.data/hunting.db`，本机加密密钥位于 `.data/settings.key`；生产环境应显式设置 `SETTINGS_ENCRYPTION_KEY`。

## Chrome 插件

1. 在设置页保存插件访问码并按需启用截图分析。
2. 打开 `chrome://extensions`，启用开发者模式。
3. 加载仓库中的 `extension/` 目录。
4. 点击扩展图标，在侧边栏登录内部系统。

详细说明见 [extension/README.md](extension/README.md)。

## 验证

```bash
pnpm lint
pnpm test
pnpm build
```

测试覆盖初始空库、公司导入去重、简历去重、图谱构建、重建幂等、搜索任务、反馈学习边界和密钥加密。

## Docker

```bash
docker compose up --build
```

Compose 同时启动 Web 与 Worker，SQLite 数据保存在共享的 `hunting-data` volume。生产环境建议增加企业 SSO、战役级权限、对象存储、备份、审计告警并迁移到 PostgreSQL。

产品边界、流程、数据模型和验收口径见 [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md)。
