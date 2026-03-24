// sql-engine.ts — SQL execution engine using bun:sqlite

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  changes?: number;
}

export class SqlEngine {
  private databases = new Map<string, Database>();
  private defaultDb: Database;
  private notebookDir: string;

  constructor(notebookDir: string) {
    this.notebookDir = notebookDir;
    this.defaultDb = new Database(":memory:");
  }

  /**
   * Attach a database file. Usage: %sql attach <path> [as <alias>]
   */
  attach(dbPath: string, alias?: string): string {
    const absPath = resolve(this.notebookDir, dbPath);
    if (!existsSync(absPath)) {
      throw new Error(`Database file not found: ${absPath}`);
    }
    const name = alias || dbPath.replace(/\.[^.]+$/, "");
    const db = new Database(absPath);
    this.databases.set(name, db);
    return `Attached ${absPath} as "${name}"`;
  }

  /**
   * Import a CSV file as a table. Usage: %sql import <file.csv> [as <table>]
   */
  async importCsv(csvPath: string, tableName?: string): Promise<string> {
    const absPath = resolve(this.notebookDir, csvPath);
    if (!existsSync(absPath)) {
      throw new Error(`File not found: ${absPath}`);
    }

    const content = await Bun.file(absPath).text();
    const lines = content.trim().split("\n");
    if (lines.length < 2) throw new Error("CSV file is empty or has no data rows");

    const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const name = tableName || csvPath.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");

    const colDefs = headers.map((h) => `"${h}" TEXT`).join(", ");
    this.defaultDb.run(`CREATE TABLE IF NOT EXISTS "${name}" (${colDefs})`);

    const placeholders = headers.map(() => "?").join(", ");
    const insert = this.defaultDb.prepare(`INSERT INTO "${name}" VALUES (${placeholders})`);

    const insertMany = this.defaultDb.transaction((rows: string[][]) => {
      for (const row of rows) insert.run(...row);
    });

    const dataRows = lines.slice(1).map((line) =>
      line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""))
    );
    insertMany(dataRows);

    return `Imported ${dataRows.length} rows into "${name}" (${headers.join(", ")})`;
  }

  /**
   * Execute a SQL query and return results.
   */
  execute(sql: string, dbName?: string): SqlResult {
    const db = dbName ? this.databases.get(dbName) : this.defaultDb;
    if (!db) throw new Error(`Database "${dbName}" not found. Use %sql attach <path> first.`);

    const trimmed = sql.trim();
    const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed);

    if (isSelect) {
      const rows = db.query(trimmed).all() as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
      return { columns, rows, rowCount: rows.length };
    } else {
      const result = db.run(trimmed);
      return { columns: [], rows: [], rowCount: 0, changes: result.changes };
    }
  }

  close(): void {
    this.defaultDb.close();
    for (const db of this.databases.values()) {
      try { db.close(); } catch {}
    }
    this.databases.clear();
  }
}
