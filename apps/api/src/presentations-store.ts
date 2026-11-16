import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { desc, eq } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { presentationLimit, type PresentationInput } from '@classflow/shared/presentations';
import { RequestError } from './repository.js';

const presentations = sqliteTable('presentations', {
  id: text().primaryKey(), title: text().notNull(), description: text().notNull(),
  filename: text().notNull(), html: text().notNull(), bytes: integer().notNull(),
  createdAt: text().notNull(), updatedAt: text().notNull(),
});
const metadata = {
  id: presentations.id, title: presentations.title, description: presentations.description,
  filename: presentations.filename, bytes: presentations.bytes,
  createdAt: presentations.createdAt, updatedAt: presentations.updatedAt,
};

export function openPresentations(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sql = new Database(join(directory, 'presentations.sqlite'));
  try {
    sql.transaction(() => {
      const version = sql.pragma('user_version', { simple: true });
      if (version === 1) return;
      if (version !== 0) throw new Error('课件库版本不兼容');
      sql.exec(`CREATE TABLE presentations(id TEXT PRIMARY KEY, title TEXT NOT NULL,
        description TEXT NOT NULL, filename TEXT NOT NULL, html TEXT NOT NULL,
        bytes INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
        PRAGMA user_version=1;`);
    }).immediate();
  } catch (error) { sql.close(); throw error; }
  const db = drizzle(sql);
  const get = (id: string) => {
    const row = db.select().from(presentations).where(eq(presentations.id, id)).get();
    if (!row) throw new RequestError(404, '找不到这份课件');
    return row;
  };
  return {
    close: () => sql.close(),
    list: () => db.select(metadata).from(presentations).orderBy(desc(presentations.updatedAt), presentations.id).all(),
    get,
    save(input: PresentationInput, id?: string) {
      const bytes = Buffer.byteLength(input.html, 'utf8');
      if (bytes > presentationLimit) throw new RequestError(413, '课件超过 16 MB，请压缩内嵌资源后重试');
      if (!/<(?:!doctype\s+html|html|head|body)[\s>]/i.test(input.html))
        throw new RequestError(400, '文件不是完整的 HTML 课件');
      return sql.transaction(() => {
        if (id) get(id);
        const now = new Date().toISOString();
        if (id) return db.update(presentations).set({ ...input, bytes, updatedAt: now })
          .where(eq(presentations.id, id)).returning(metadata).get()!;
        return db.insert(presentations).values({ ...input, bytes, id: randomUUID(), createdAt: now, updatedAt: now })
          .returning(metadata).get();
      }).immediate();
    },
    remove(id: string) {
      if (!db.delete(presentations).where(eq(presentations.id, id)).run().changes)
        throw new RequestError(404, '找不到这份课件');
    },
  };
}
