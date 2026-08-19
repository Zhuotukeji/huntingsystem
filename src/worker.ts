import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db";
import "@/lib/seed";
import { discoverOrganizations, discoverPeople } from "@/lib/agents";
import { updateTask } from "@/lib/repository";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function processNext() {
  const task = db.prepare("SELECT id, campaign_id, type FROM tasks WHERE status = 'QUEUED' ORDER BY created_at LIMIT 1").get() as { id: string; campaign_id: string | null; type: string } | undefined;
  if (!task) return false;
  db.prepare("UPDATE tasks SET status = 'RUNNING', attempts = attempts + 1 WHERE id = ? AND status = 'QUEUED'").run(task.id);
  try {
    if (task.campaign_id && task.type === "DISCOVER_ORGANIZATIONS") discoverOrganizations(task.campaign_id);
    else if (task.campaign_id && task.type === "DISCOVER_PERSONS") discoverPeople(task.campaign_id);
    updateTask(task.id, "SUCCEEDED", "Worker 已完成重试任务。");
  } catch (error) {
    updateTask(task.id, "FAILED", error instanceof Error ? error.message : "Worker 任务失败");
  }
  return true;
}

async function main() {
  console.log("Hunting System worker started");
  while (!stopping) {
    const processed = await processNext();
    if (!processed) await delay(1500);
  }
  db.close();
  console.log("Hunting System worker stopped");
}

void main();
