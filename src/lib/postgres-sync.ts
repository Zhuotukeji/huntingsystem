import { readFileSync, unlinkSync } from "node:fs";
import { Worker } from "node:worker_threads";
import "pg";

export interface DatabaseRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface DatabaseStatement {
  all(...values: unknown[]): unknown[];
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): DatabaseRunResult;
}

export interface CompatibleDatabase {
  prepare(sql: string): DatabaseStatement;
  exec(sql: string): void;
  close(): void;
}

type WorkerResponse = { ok: true; value: unknown } | { ok: false; error: string; stack?: string; sql?: string };

const workerSource = String.raw`
const { parentPort, workerData, threadId } = require("node:worker_threads");
const { writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
let pool;
let startupError;
try {
  const pg = require("pg");
  pg.types.setTypeParser(20, (value) => Number(value));
  pg.types.setTypeParser(114, (value) => value);
  pg.types.setTypeParser(3802, (value) => value);
  pool = new pg.Pool({
    connectionString: workerData.connectionString,
    max: 1,
    application_name: "hunting-system",
  });
} catch (error) {
  startupError = error;
}
let queue = Promise.resolve();

function parameterize(sql) {
  let output = "";
  let index = 0;
  let singleQuoted = false;
  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const character = sql[cursor];
    if (character === "'") {
      output += character;
      if (singleQuoted && sql[cursor + 1] === "'") {
        output += sql[++cursor];
      } else {
        singleQuoted = !singleQuoted;
      }
    } else if (character === "?" && !singleQuoted) {
      output += "$" + (++index);
    } else {
      output += character;
    }
  }
  return output;
}

function normalizeSql(value) {
  const caseInsensitive = /COLLATE\s+NOCASE/i.test(value);
  let sql = value.trim()
    .replace(/=\s*\?\s+COLLATE\s+NOCASE/gi, "ILIKE ?")
    .replace(/\s+COLLATE\s+NOCASE/gi, "");
  if (caseInsensitive) sql = sql.replace(/\bLIKE\b/gi, "ILIKE");

  const ignore = /^INSERT\s+OR\s+IGNORE\s+INTO\s+/i.test(sql);
  if (ignore) {
    sql = sql.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\s+/i, "INSERT INTO ").replace(/;\s*$/, "");
    if (!/\bON\s+CONFLICT\b/i.test(sql)) sql += " ON CONFLICT DO NOTHING";
  }

  sql = sql
    .replace(/GROUP_CONCAT\(DISTINCT\s+([^\)]+)\)/gi, "STRING_AGG(DISTINCT $1::text, ',')")
    .replace(/GROUP_CONCAT\(([^,\)]+),\s*'([^']*)'\)/gi, "STRING_AGG($1::text, '$2')")
    .replace(/GROUP_CONCAT\(([^\)]+)\)/gi, "STRING_AGG($1::text, ',')")
    .replace(/\bMAX\(([^,\(\)]+),\s*([^\(\)]+)\)/gi, "GREATEST($1, $2)")
    .replace(/\bquery_json\s+(I?LIKE)\b/gi, "query_json::text $1");
  return parameterize(sql);
}

function normalizeExecSql(value) {
  return value.replace(/\bBEGIN\s+IMMEDIATE\b/gi, "BEGIN");
}

function respond(message, response) {
  const control = new Int32Array(message.control);
  const data = new Uint8Array(message.data);
  let encoded = Buffer.from(JSON.stringify(response));
  if (encoded.length > data.length) {
    const path = join(tmpdir(), "hunting-pg-" + threadId + "-" + message.id + ".json");
    writeFileSync(path, encoded);
    encoded = Buffer.from(JSON.stringify({ overflowPath: path }));
  }
  data.set(encoded.subarray(0, data.length));
  Atomics.store(control, 1, encoded.length);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0, 1);
}

async function execute(message) {
  let sql = message.sql || "";
  try {
    if (startupError) throw startupError;
    if (message.operation === "close") {
      await pool.end();
      respond(message, { ok: true, value: null });
      return;
    }
    sql = message.operation === "exec" ? normalizeExecSql(message.sql) : normalizeSql(message.sql);
    const result = await pool.query(sql, message.values || []);
    const value = message.operation === "all" ? result.rows
      : message.operation === "get" ? (result.rows[0] || null)
      : message.operation === "run" ? { changes: result.rowCount || 0, lastInsertRowid: 0 }
      : null;
    respond(message, { ok: true, value });
  } catch (error) {
    respond(message, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : "",
      sql,
    });
  }
}

parentPort.on("message", (message) => {
  queue = queue.then(() => execute(message));
});
`;

export class PostgresSyncDatabase implements CompatibleDatabase {
  private readonly worker: Worker;
  private requestId = 0;

  constructor(connectionString: string) {
    this.worker = new Worker(workerSource, {
      eval: true,
      workerData: { connectionString },
    });
  }

  private request(operation: "all" | "get" | "run" | "exec" | "close", sql = "", values: unknown[] = []) {
    const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const dataBuffer = new SharedArrayBuffer(4 * 1024 * 1024);
    const control = new Int32Array(controlBuffer);
    const data = new Uint8Array(dataBuffer);
    const id = ++this.requestId;
    this.worker.postMessage({ id, operation, sql, values, control: controlBuffer, data: dataBuffer });
    const result = Atomics.wait(control, 0, 0, 180_000);
    if (result === "timed-out") throw new Error(`PostgreSQL query timed out: ${sql.slice(0, 120)}`);
    const length = Atomics.load(control, 1);
    let decoded = JSON.parse(Buffer.from(data.subarray(0, length)).toString("utf8")) as WorkerResponse | { overflowPath: string };
    if ("overflowPath" in decoded) {
      const path = decoded.overflowPath;
      try {
        decoded = JSON.parse(readFileSync(path, "utf8")) as WorkerResponse;
      } finally {
        unlinkSync(path);
      }
    }
    if (!decoded.ok) {
      const error = new Error(`${decoded.error}${decoded.sql ? `\nSQL: ${decoded.sql.slice(0, 500)}` : ""}`);
      if (decoded.stack) error.stack = decoded.stack;
      throw error;
    }
    return decoded.value;
  }

  prepare(sql: string): DatabaseStatement {
    return {
      all: (...values) => this.request("all", sql, values) as unknown[],
      get: (...values) => this.request("get", sql, values),
      run: (...values) => this.request("run", sql, values) as DatabaseRunResult,
    };
  }

  exec(sql: string) {
    this.request("exec", sql);
  }

  close() {
    try {
      this.request("close");
    } finally {
      void this.worker.terminate();
    }
  }
}
