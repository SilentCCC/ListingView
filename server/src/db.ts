import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database as SqlDatabase, type SqlJsStatic, type Statement } from 'sql.js';
import { databasePath, dataDir, sqlWasmDir } from './config.js';

fs.mkdirSync(dataDir, { recursive: true });
class PreparedStatement {
  constructor(private readonly database: SqlDatabase, private readonly sql: string) {}
  private execute<T>(params: unknown[], mode: 'get' | 'all' | 'run'): T {
    const statement: Statement = this.database.prepare(this.sql);
    try {
      if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) statement.bind(params[0] as any);
      else statement.bind(params as any[]);
      if (mode === 'get' || mode === 'all') {
        const rows: any[] = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return (mode === 'get' ? rows[0] : rows) as T;
      }
      while (statement.step()) { /* consume */ }
      const result = this.database.exec('SELECT last_insert_rowid() AS lastInsertRowid');
      return { changes: this.database.getRowsModified(), lastInsertRowid: Number(result[0]?.values[0]?.[0] || 0) } as T;
    } finally { statement.free(); }
  }
  get(...params: unknown[]) { return this.execute<any>(params, 'get'); }
  all(...params: unknown[]) { return this.execute<any[]>(params, 'all'); }
  run(...params: unknown[]) { return this.execute<{ changes: number; lastInsertRowid: number }>(params, 'run'); }
}
class SqliteCompat {
  constructor(private readonly database: SqlDatabase) {}
  exec(sql: string) { this.database.run(sql); }
  prepare(sql: string) { return new PreparedStatement(this.database, sql); }
  pragma(sql: string) { this.database.run(`PRAGMA ${sql}`); }
  transaction<T>(callback: () => T) { return () => { this.database.run('BEGIN'); try { const result = callback(); this.database.run('COMMIT'); return result; } catch (error) { this.database.run('ROLLBACK'); throw error; } }; }
  persist() { fs.writeFileSync(databasePath, Buffer.from(this.database.export())); }
}
export let db: SqliteCompat;
export async function initDatabase() {
  const SQL: SqlJsStatic = await initSqlJs({ locateFile: (file) => path.join(sqlWasmDir, file) });
  const database = fs.existsSync(databasePath) ? new SQL.Database(new Uint8Array(fs.readFileSync(databasePath))) : new SQL.Database();
  db = new SqliteCompat(database);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sku TEXT NOT NULL UNIQUE, generic_title TEXT NOT NULL DEFAULT '', generic_price REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS platform_content (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, platform TEXT NOT NULL CHECK (platform IN ('amazon', 'tmall')), title TEXT NOT NULL DEFAULT '', price REAL, UNIQUE(product_id, platform));
    CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, scope TEXT NOT NULL CHECK (scope IN ('common', 'amazon', 'tmall')), kind TEXT NOT NULL CHECK (kind IN ('main', 'detail')), device TEXT NOT NULL DEFAULT 'all' CHECK (device IN ('all', 'desktop', 'mobile')), original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at DESC);

  `);
  const imageColumns = db.prepare('PRAGMA table_info(images)').all() as Array<{ name: string }>;
  if (!imageColumns.some((column) => column.name === 'device')) {
    db.exec("ALTER TABLE images ADD COLUMN device TEXT NOT NULL DEFAULT 'all'");
  }
  const hasRowOrder = imageColumns.some((column) => column.name === 'row_order');
  if (!hasRowOrder) {
    db.exec('ALTER TABLE images ADD COLUMN row_order INTEGER NOT NULL DEFAULT 0');
  }
  if (!imageColumns.some((column) => column.name === 'col_order')) {
    db.exec('ALTER TABLE images ADD COLUMN col_order INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasRowOrder) {
    db.exec('UPDATE images SET row_order = sort_order, col_order = 0');
  }
  db.exec('DROP INDEX IF EXISTS idx_images_product_scope_kind_order');
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_product_scope_kind_device_order ON images(product_id, scope, kind, device, sort_order)');
  const sampleProduct = db.prepare('SELECT id FROM products LIMIT 1').get() as { id?: number } | undefined;
  if (!sampleProduct) {
    const insertProduct = db.prepare('INSERT INTO products (name, sku, generic_title, generic_price) VALUES (?, ?, ?, ?)');
    const insertPlatform = db.prepare('INSERT INTO platform_content (product_id, platform, title, price) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      const result = insertProduct.run('轻量通勤双肩包', 'LV-DEMO-001', '轻量通勤双肩包｜多隔层收纳，日常出行更从容', 129);
      insertPlatform.run(result.lastInsertRowid, 'amazon', 'Lightweight Commuter Backpack with Multi-Compartment Storage', 19.99);
      insertPlatform.run(result.lastInsertRowid, 'tmall', '轻量通勤双肩包 多隔层大容量 适合日常通勤出行', 129);
    })();
  }
  db.persist();
}


