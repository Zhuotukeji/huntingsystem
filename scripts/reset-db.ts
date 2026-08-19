import { existsSync, unlinkSync } from "node:fs";
import { resolve, sep } from "node:path";

const root = resolve(process.cwd());
const path = resolve(root, process.env.DATABASE_PATH || ".data/hunting.db");
if (!path.startsWith(`${root}${sep}`)) throw new Error("数据库重置只允许作用于当前仓库内的文件");

for (const target of [path, `${path}-wal`, `${path}-shm`]) {
  if (existsSync(target)) unlinkSync(target);
}
console.log(`Database reset: ${path}`);
