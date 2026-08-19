# 觅才 · AI 人才寻访系统

面向 50-200 人互联网公司的主动猎聘工作台。系统把 HR 的工作方式从逐人搜索改为审核经过研究的公司与人选队列，并保留事实来源、AI 推测、未知项和人工反馈。

## 已实现

- 寻访战役、业务目标、必须项与排除项
- 公司发现智能体与透明三分制评分
- 人员发现智能体与事实/推测/未知项证据卡
- 公司、人选的搜索、筛选、卡片/表格视图和批量审核
- InsightTracker 人工调研指令包
- CSV、TSV、文本和链接的合规导入、哈希去重与证据建档
- 任务状态、重试、取消和独立 Worker
- 北极星指标与人才漏斗看板
- BOSS 直聘、InsightTracker、网页搜索 API 和模型配置边界
- SQLite 本地持久化、确定性演示数据和可选 OpenAI 结构化输出

## 本地运行

要求 Node.js 24+ 与 pnpm 11+。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次启动会在 `.data/hunting.db` 创建数据库和虚构演示数据。运行 `pnpm db:reset` 后重新启动可恢复初始演示环境。

需要处理失败任务重试时，在第二个终端运行：

```bash
pnpm worker
```

默认不需要模型密钥。配置 `OPENAI_API_KEY` 后，InsightTracker 调研任务会使用 Responses API 严格结构化输出；调用失败会回退到确定性方案。不得把未获授权的个人资料发送到外部模型。

## 验证

```bash
pnpm lint
pnpm test
pnpm build
```

## Docker

```bash
docker compose up --build
```

Compose 会同时启动 Web 与 Worker，SQLite 数据保存在共享的 `hunting-data` volume。生产环境应进一步接入企业认证、战役级权限、字段加密、对象存储、备份和 PostgreSQL；当前版本定位是可以本地试用和验证工作流的 V1 MVP。

## 数据源合规

当前没有 BOSS 直聘或 InsightTracker API。系统只生成检索指令并接收 HR 按平台规则导入的资料，不会自动登录、处理验证码、绕过付费墙或规避反自动化限制。无人值守公司发现需要后续采购合规网页搜索 API。
