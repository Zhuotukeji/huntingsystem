import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "hunting-system-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.db");
process.env.DEMO_MODE = "true";

let agents: typeof import("../src/lib/agents");
let repository: typeof import("../src/lib/repository");
let database: typeof import("../src/lib/db");

before(async () => {
  agents = await import("../src/lib/agents");
  repository = await import("../src/lib/repository");
  database = await import("../src/lib/db");
});

test("seed creates a complete review workspace", () => {
  assert.equal(repository.listCampaigns().length, 1);
  assert.equal(repository.listOrganizations().length, 6);
  assert.equal(repository.listPeople().length, 5);
  assert.ok(repository.getDashboard().metrics.pendingCompanies > 0);
});

test("CSV parser handles quoted commas and Chinese headers", () => {
  const records = agents.parseCsv('公司,官网,地区,证据\n"测试公司",test.example,广州,"覆盖 Google, Meta"');
  assert.equal(records.length, 1);
  assert.equal(records[0].公司, "测试公司");
  assert.equal(records[0].证据, "覆盖 Google, Meta");
});

test("import is idempotent and creates an evidence-backed company", () => {
  const input = { campaignId: "campaign-overseas-gm", provider: "InsightTracker", title: "测试导入", text: "company,website,location,product,market,channel,monetization,evidence\n测试星河,test-galaxy.example,广州,Galaxy,东南亚,TikTok,广告,授权调研摘录" };
  const first = agents.processImport(input);
  const second = agents.processImport(input);
  assert.equal(first.imported, 1);
  assert.equal(second.duplicate, true);
  assert.equal(repository.listOrganizations().some((item) => item.name === "测试星河" && item.evidence.length === 1), true);
});

after(() => {
  database?.db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});
