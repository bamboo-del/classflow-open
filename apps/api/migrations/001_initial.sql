CREATE TABLE notices (
  id TEXT PRIMARY KEY NOT NULL, original TEXT NOT NULL, source TEXT NOT NULL, notes TEXT NOT NULL,
  receivedAt TEXT NOT NULL, createdAt TEXT NOT NULL, processed INTEGER NOT NULL CHECK (processed IN (0,1))
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('通知','材料','会议','活动','其他')),
  priority TEXT NOT NULL CHECK (priority IN ('高','中','低')),
  status TEXT NOT NULL CHECK (status IN ('待办','进行中','已完成')),
  visibility TEXT NOT NULL DEFAULT '私人' CHECK (visibility IN ('私人','未来可公开')),
  dueDate TEXT NOT NULL, dueTime TEXT, assignee TEXT NOT NULL,
  sourceNoticeId TEXT REFERENCES notices(id) ON DELETE RESTRICT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, completedAt TEXT,
  CHECK ((status = '已完成') = (completedAt IS NOT NULL))
);
CREATE INDEX tasks_due ON tasks(dueDate, dueTime);
CREATE INDEX tasks_notice ON tasks(sourceNoticeId);
