# 觅才 · AI 人才情报系统

面向 50-200 人互联网公司的 BOSS 主动寻访工作台。系统以企业合法取得的简历为事实源，把任职经历和技能沉淀成公司/人才图谱，再生成供 HR 在 BOSS 网页版手工执行的搜索任务。

## 核心闭环

1. HR 在网页端导入授权简历，或由插件扫描当前可见的 BOSS 简历详情。
2. Sub2API `gpt-5.6` 结构化提取人才、公司、任职、技能和画像匹配证据。
3. 系统完成实体归一、图谱更新、公司评分和 BOSS 搜索任务生成。
4. HR 在 BOSS 手工搜索、判断和沟通，并回填结果数、合格数和有效沟通数。
5. 系统使用反馈小步更新有上下限的公司搜索权重；重要画像变更仍需人工审核。
6. Worker 每天北京时间 00:00 创建一次增量学习任务，重启后会自动补跑当天任务。

## 已实现

- 授权简历库：默认展示可搜索档案列表，展开查看候选人、任职、技能、来源和学习状态；点击新增后才显示 PDF、DOCX、TXT、Markdown 与粘贴导入模块；10MB 限制、SHA-256 去重、永久保留。
- 公司/人才图谱：人物、公司、技能节点；现任、曾任、技能证据边；公司人才密度洞察。
- AI 学习中心：增量学习、全量重建、运行阶段/错误/指标审计、午夜调度。
- 搜索任务工作台：公司、职位、地区组合，优先级、复制关键词、打开 BOSS、结果反馈。
- 持续学习：贝叶斯平滑、小步更新、`0.65-1.35` 权重边界、至少 3 个样本后生成人审建议。
- Sub2API 配置页：Base URL、`gpt-5.6`、Chat Completions/Responses API、连接测试。
- 密钥保护：API Key 和插件访问码以 AES-256-GCM 密文存入 SQLite，接口不回传明文。
- 公司发现：AI 只从授权简历的任职经历中发现并补全公司，以列表展示人才数、职位、市场、渠道、评分和简历证据。
- Chrome MV3 侧边栏插件 V0.6：支持 Chrome Web Store 在线安装与版本检测；正式模式提供端口自动探测、内部登录、任务领取/执行/反馈、结果页单屏判断、简历关键帧扫描和招呼语草稿；商店审核模式无需后台、BOSS 账号或真实候选人数据即可离线验证核心流程。
- 人员登录与权限管理：服务端会话、人员启停、密码重置、多角色分配、按模块配置查看/管理权限；菜单、页面和 API 同步鉴权。
- 无 AI 降级：未配置 Sub2API 时可解析带明确字段的结构化文本，不会生成虚构公司或候选人。

## 合规边界

插件没有 content script，不读取 BOSS DOM、页面文本、Cookie、密码或验证码，也不自动翻页、滚动、打开候选人或发送消息。HR 开始扫描后，每点击一次侧边栏的“截取当前帧”，插件才会在内存中截取当前标签页的一帧；完成时最多发送 10 帧至已配置的 Sub2API，图片和视频均不落盘。招呼语仅生成草稿，由 HR 审核后手工发送。

## 本地运行

要求 Node.js 24+ 与 pnpm 11+。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

执行 `pnpm dev` 并打开 [http://localhost:3000](http://localhost:3000)。系统和 Chrome 插件统一只使用 3000 端口。首次启动只创建默认“海外项目负责人”人才画像，不创建虚构公司或人选。

首次启动还会创建系统管理员。开发环境默认账号为 `admin@hunting.local`，初始密码为 `ChangeMe123!`，首次登录后必须修改。部署前应在环境变量中显式配置 `INITIAL_ADMIN_NAME`、`INITIAL_ADMIN_EMAIL` 和高强度的 `INITIAL_ADMIN_PASSWORD`；这些配置只在数据库尚无人员账号时使用。

管理员可在“人员与权限”中创建人员账号、停用账号、重置临时密码、分配多个角色，以及配置每个角色的模块权限。人员角色或角色权限变化后，已有 Web 会话会立即失效并要求重新登录。

启动午夜学习 Worker：

```bash
pnpm worker
```

也可在“数据源与设置”页面直接配置 Sub2API，不需要把 Key 写入环境变量。配置保存在 `.data/hunting.db`，本机加密密钥位于 `.data/settings.key`；生产环境应显式设置 `SETTINGS_ENCRYPTION_KEY`。

## Chrome 插件

```bash
pnpm extension:assets
pnpm extension:check
pnpm extension:pack
```

正式分发建议先将插件发布为 Chrome Web Store 的“未公开”应用，然后在设置页的“商店发布配置”中保存详情页地址。HR 之后直接点击“安装到 Chrome”，完成 Chrome 强制的一次确认即可；后台会检测已安装版本。普通网页无法静默安装 ZIP 或未上架扩展。

本地开发仍可使用侧载：

1. 在设置页保存插件访问码，并按需配置 Sub2API、启用截图分析。
2. 打开 `chrome://extensions`，启用开发者模式。
3. 加载仓库中的 `extension/` 目录，或下载并解压 `artifacts/hunting-extension-v0.6.10.zip` 后加载。
4. 点击扩展图标。插件会检测 `localhost:3000`，登录后即可领取任务、回填反馈或扫描 BOSS 简历。

详细说明见 [extension/README.md](extension/README.md)。

提交 Chrome Web Store 时，可直接使用 [docs/CHROME_WEB_STORE_REVIEW.md](docs/CHROME_WEB_STORE_REVIEW.md) 中的中英文审核步骤。

隐私政策静态页面位于 [docs/privacy.html](docs/privacy.html)，可按 [GitHub Pages 发布指南](docs/GITHUB_PAGES.md) 从默认分支的 `/docs` 目录发布。

## 验证

```bash
pnpm lint
pnpm test
pnpm build
pnpm extension:check
pnpm extension:pack
```

测试覆盖初始空库、简历永久保留与去重、图谱构建、重建幂等、插件任务状态机、反馈学习边界、会话过期、截图来源、关键帧重叠合并和密钥加密。

## Docker

```bash
docker compose up --build
```

Compose 同时启动 Web 与 Worker，SQLite 数据保存在共享的 `hunting-data` volume。生产环境建议增加企业 SSO、战役级权限、对象存储、备份、审计告警并迁移到 PostgreSQL。

产品边界、流程、数据模型和验收口径见 [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md)。
