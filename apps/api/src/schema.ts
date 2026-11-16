import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { categories, priorities, statuses, visibilities } from '@classflow/shared';
import type { HandbookInput } from '@classflow/shared/handbook';

export const handbook = sqliteTable('handbook', {
  id: text().primaryKey(),
  kind: text().$type<HandbookInput['kind']>().notNull(),
  values: text({ mode: 'json' }).$type<HandbookInput['values']>().notNull(),
  photos: text({ mode: 'json' }).$type<HandbookInput['photos']>().notNull(),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
});

export const notices = sqliteTable('notices', {
  id: text().primaryKey(),
  original: text().notNull(),
  source: text().notNull(),
  notes: text().notNull(),
  receivedAt: text().notNull(),
  createdAt: text().notNull(),
  processed: integer({ mode: 'boolean' }).notNull(),
});
export const tasks = sqliteTable('tasks', {
  id: text().primaryKey(),
  title: text().notNull(),
  description: text().notNull(),
  category: text({ enum: categories }).notNull(),
  priority: text({ enum: priorities }).notNull(),
  status: text({ enum: statuses }).notNull(),
  visibility: text({ enum: visibilities }).notNull().default('私人'),
  dueDate: text().notNull(),
  dueTime: text(),
  assignee: text().notNull(),
  sourceNoticeId: text().references(() => notices.id),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
  completedAt: text(),
});
