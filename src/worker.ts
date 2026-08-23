import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db";
import "@/lib/seed";
import { ensureNightlyRun, processNextAiRun } from "@/lib/learning";
import { ensureScheduledReviews, markStaleClaims, processNextResearchTask } from "@/lib/autonomy";
import { ensureDailyAnalyticsSnapshots } from "@/lib/analytics";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  console.log("Hunting System worker started");
  ensureNightlyRun();
  ensureScheduledReviews();
  markStaleClaims();
  ensureDailyAnalyticsSnapshots();
  let lastBusinessDate = "";
  while (!stopping) {
    const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    if (businessDate !== lastBusinessDate) {
      ensureNightlyRun();
      ensureScheduledReviews();
      markStaleClaims();
      ensureDailyAnalyticsSnapshots();
      lastBusinessDate = businessDate;
    }
    const processed = await processNextAiRun() || await processNextResearchTask();
    if (!processed) await delay(1500);
  }
  db.close();
  console.log("Hunting System worker stopped");
}

void main();
