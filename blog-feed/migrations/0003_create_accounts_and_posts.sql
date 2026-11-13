CREATE TABLE accounts (
	id TEXT PRIMARY KEY NOT NULL,
	username TEXT NOT NULL COLLATE NOCASE UNIQUE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'publisher', 'editor', 'admin')),
	created_at INTEGER NOT NULL
);

CREATE TABLE account_sessions (
	token_hash TEXT PRIMARY KEY NOT NULL,
	account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX account_sessions_by_expiry ON account_sessions (expires_at);

CREATE TABLE login_rate_limits (
	ip_hash TEXT NOT NULL,
	window_start INTEGER NOT NULL,
	attempt_count INTEGER NOT NULL,
	PRIMARY KEY (ip_hash, window_start)
);

CREATE TABLE video_posts (
	id TEXT PRIMARY KEY NOT NULL,
	title TEXT NOT NULL,
	description TEXT NOT NULL,
	video_id TEXT NOT NULL,
	category TEXT NOT NULL,
	tags_json TEXT NOT NULL,
	image TEXT NOT NULL DEFAULT '',
	image_alt TEXT NOT NULL DEFAULT '',
	published_at TEXT NOT NULL,
	author_id TEXT NOT NULL,
	FOREIGN KEY (author_id) REFERENCES accounts (id) ON DELETE RESTRICT
);

CREATE INDEX video_posts_by_date ON video_posts (published_at DESC);

CREATE TABLE removed_posts (
	post_id TEXT PRIMARY KEY NOT NULL,
	removed_at INTEGER NOT NULL,
	removed_by TEXT NOT NULL REFERENCES accounts (id)
);
