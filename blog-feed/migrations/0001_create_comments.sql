CREATE TABLE comments (
	id TEXT PRIMARY KEY NOT NULL,
	post_id TEXT NOT NULL,
	author TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	ip_hash TEXT NOT NULL
);

CREATE INDEX comments_by_post
	ON comments (post_id, created_at DESC);

CREATE TABLE comment_rate_limits (
	ip_hash TEXT NOT NULL,
	window_start INTEGER NOT NULL,
	comment_count INTEGER NOT NULL,
	PRIMARY KEY (ip_hash, window_start)
);
