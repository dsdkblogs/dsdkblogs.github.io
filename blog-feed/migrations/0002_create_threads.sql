CREATE TABLE threads (
	post_id TEXT PRIMARY KEY NOT NULL,
	title TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	closes_at INTEGER NOT NULL
);
