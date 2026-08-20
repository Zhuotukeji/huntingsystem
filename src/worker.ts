import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db";
import "@/lib/seed";
import { ensureNightlyRun, processNextAiRun } from "@/lib/learning";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  console.log("Hunting System worker started");
  ensureNightlyRun();
  let lastBusinessDate = "";
  while (!stopping) {
    const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    if (businessDate !== lastBusinessDate) {
      ensureNightlyRun();
      lastBusinessDate = businessDate;
    }
    const processed = await processNextAiRun();
    if (!processed) await delay(1500);
  }
  db.close();
  console.log("Hunting System worker stopped");
}

void main();
