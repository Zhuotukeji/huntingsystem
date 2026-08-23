import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { Pool, type PoolClient } from "pg";
import { POSTGRES_SCHEMA_SQL } from "../src/lib/postgres-schema.generated";

type SqliteRow = Record<string, unknown>;
type TargetColumn = { column_name: string; data_type: string; udt_name: string };

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function option(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function stableHash(rows: SqliteRow[]) {
  const normalized = rows.map((row) => Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function timestampedBackupName(sourcePath: string) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const extension = sourcePath.toLowerCase().endsWith(".db") ? ".db" : ".sqlite";
  return `${basename(sourcePath, extension)}.pre-postgres-${timestamp}${extension}`;
}

function listSourceTables(database: DatabaseSync) {
  return (database.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name`).all() as Array<{ name: string }>).map((row) => row.name);
}

function orderedTables(database: DatabaseSync, tables: string[]) {
  const tableSet = new Set(tables);
  const dependencies = new Map<string, Set<string>>();
  for (const table of tables) {
    const rows = database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all() as Array<{ table: string }>;
    dependencies.set(table, new Set(rows.map((row) => row.table).filter((dependency) => dependency !== table && tableSet.has(dependency))));
  }
  const pending = new Set(tables);
  const ordered: string[] = [];
  while (pending.size) {
    const ready = [...pending].filter((table) => [...(dependencies.get(table) || [])].every((dependency) => !pending.has(dependency))).sort();
    if (!ready.length) throw new Error(`SQLite 表存在无法排序的循环外键: ${[...pending].join(", ")}`);
    for (const table of ready) {
      pending.delete(table);
      ordered.push(table);
    }
  }
  return ordered;
}

function sourceRows(database: DatabaseSync, table: string, columns?: string[]) {
  const select = columns?.length ? columns.map(quoteIdentifier).join(", ") : "*";
  return database.prepare(`SELECT ${select} FROM ${quoteIdentifier(table)}`).all() as SqliteRow[];
}

async function targetColumns(client: PoolClient, table: string) {
  const result = await client.query<TargetColumn>(`SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = $1
    ORDER BY ordinal_position`, [table]);
  return result.rows;
}

function normalizeValue(value: unknown, column: TargetColumn) {
  if (value === null || value === undefined) return null;
  if (column.data_type === "timestamp with time zone") {
    if (value === "") return null;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) throw new Error(`无效时间值 ${column.column_name}=${String(value)}`);
    return parsed.toISOString();
  }
  return value;
}

async function ensureEmptyTarget(client: PoolClient, tables: string[]) {
  const occupied: string[] = [];
  for (const table of tables) {
    const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`);
    if (Number(result.rows[0]?.count || 0) > 0) occupied.push(`${table}=${result.rows[0].count}`);
  }
  if (occupied.length) throw new Error(`PostgreSQL 目标库不是空库，已拒绝覆盖: ${occupied.join(", ")}`);
}

async function importTable(client: PoolClient, database: DatabaseSync, table: string) {
  const columns = await targetColumns(client, table);
  if (!columns.length) throw new Error(`PostgreSQL 缺少目标表 ${table}`);
  const sourceColumnNames = new Set((database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>).map((row) => row.name));
  const sharedColumns = columns.filter((column) => sourceColumnNames.has(column.column_name));
  const rows = sourceRows(database, table, sharedColumns.map((column) => column.column_name));
  if (!rows.length) return 0;
  const names = sharedColumns.map((column) => quoteIdentifier(column.column_name)).join(", ");
  const placeholders = sharedColumns.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders})`;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const values = sharedColumns.map((column) => normalizeValue(row[column.column_name], column));
    try {
      await client.query(sql, values);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${table} 第 ${index + 1} 行迁移失败: ${message}`, { cause: error });
    }
  }
  return rows.length;
}

const criticalChecks: Array<{ table: string; columns: string[]; label: string }> = [
  { table: "resume_documents", columns: ["id", "content_hash"], label: "简历内容指纹" },
  { table: "users", columns: ["id", "email", "password_hash", "status"], label: "用户与密码哈希" },
  { table: "roles", columns: ["id", "code"], label: "角色" },
  { table: "role_permissions", columns: ["role_id", "permission_code"], label: "角色权限" },
  { table: "ai_settings", columns: ["setting_key", "setting_value", "is_secret"], label: "AI 与插件加密配置" },
  { table: "plugin_sessions", columns: ["id", "email", "token_hash"], label: "插件会话" },
];

async function verifyMigration(client: PoolClient, database: DatabaseSync, tables: string[], expectedCounts: Map<string, number>) {
  const mismatches: string[] = [];
  for (const table of tables) {
    const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`);
    const actual = Number(result.rows[0]?.count || 0);
    const expected = expectedCounts.get(table) || 0;
    if (actual !== expected) mismatches.push(`${table}: SQLite=${expected}, PostgreSQL=${actual}`);
  }
  if (mismatches.length) throw new Error(`逐表数量校验失败: ${mismatches.join("; ")}`);

  const invalidConstraints = await client.query<{ table_name: string; constraint_name: string }>(`SELECT conrelid::regclass::text AS table_name, conname AS constraint_name
    FROM pg_constraint WHERE contype = 'f' AND NOT convalidated`);
  if (invalidConstraints.rowCount) throw new Error(`PostgreSQL 存在未验证外键: ${invalidConstraints.rows.map((row) => `${row.table_name}.${row.constraint_name}`).join(", ")}`);

  for (const check of criticalChecks.filter((item) => tables.includes(item.table))) {
    const source = sourceRows(database, check.table, check.columns);
    const target = (await client.query<SqliteRow>(`SELECT ${check.columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(check.table)}`)).rows;
    if (stableHash(source) !== stableHash(target)) throw new Error(`${check.label}哈希校验失败`);
  }
}

async function main() {
  const sourcePath = resolve(option("--source") || process.env.DATABASE_PATH || ".data/hunting.db");
  const databaseUrl = option("--database-url") || process.env.DATABASE_URL;
  if (!existsSync(sourcePath)) throw new Error(`SQLite 源文件不存在: ${sourcePath}`);
  if (!databaseUrl) throw new Error("缺少 PostgreSQL 连接串，请设置 DATABASE_URL 或传入 --database-url");

  const database = new DatabaseSync(sourcePath, { readOnly: true });
  database.exec("PRAGMA foreign_keys = ON;");
  const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all() as SqliteRow[];
  if (foreignKeyErrors.length) throw new Error(`SQLite 外键校验失败，共 ${foreignKeyErrors.length} 条`);

  const tables = orderedTables(database, listSourceTables(database));
  const expectedCounts = new Map(tables.map((table) => [table, sourceRows(database, table).length]));
  const totalRows = [...expectedCounts.values()].reduce((sum, value) => sum + value, 0);
  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "hunting-sqlite-migration" });
  const client = await pool.connect();
  let backupPath: string | null = null;

  try {
    await client.query("SELECT current_database()");
    if (dryRun) {
      const schema = await client.query<{ table_count: string }>(`SELECT COUNT(*)::text AS table_count FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`, [tables]);
      console.log(`Dry-run 通过: ${tables.length} 张表，${totalRows} 行；PostgreSQL 已存在 ${schema.rows[0]?.table_count || 0} 张目标表。`);
      return;
    }

    const backupDirectory = resolve(option("--backup-dir") || join(dirname(sourcePath), "backups"));
    mkdirSync(backupDirectory, { recursive: true });
    backupPath = join(backupDirectory, timestampedBackupName(sourcePath));
    await backup(database, backupPath);

    await client.query(POSTGRES_SCHEMA_SQL);
    await ensureEmptyTarget(client, tables);
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    try {
      for (const table of tables) await importTable(client, database, table);
      await verifyMigration(client, database, tables, expectedCounts);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    await verifyMigration(client, database, tables, expectedCounts);
    console.log(`迁移完成: ${tables.length} 张表，${totalRows} 行。`);
    console.log(`SQLite 一致性备份: ${backupPath}`);
  } finally {
    database.close();
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
