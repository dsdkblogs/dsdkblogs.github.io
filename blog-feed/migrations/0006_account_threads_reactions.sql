ALTER TABLE comments ADD COLUMN account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN parent_comment_id TEXT REFERENCES comments (id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));

CREATE INDEX comments_by_parent
	ON comments (post_id, parent_comment_id, created_at ASC);

CREATE TABLE comment_reactions (
	comment_id TEXT NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
	account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
	emoji TEXT NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '🤔')),
	created_at INTEGER NOT NULL,
	PRIMARY KEY (comment_id, account_id)
);

CREATE INDEX comment_reactions_by_comment
	ON comment_reactions (comment_id, emoji);
