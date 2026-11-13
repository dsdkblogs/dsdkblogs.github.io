-- 0007: on-site text/image editing, Page lab custom code, articles, per-thread discussion timer.

-- Discussion timer: 'default' = closes 14 days after publishing (as before), 'off' = never closes,
-- 'custom' = closes_at was set by an admin/editor.
ALTER TABLE threads ADD COLUMN mode TEXT NOT NULL DEFAULT 'default' CHECK (mode IN ('default', 'off', 'custom'));

-- Text and picture overrides written from the site itself (key = data-edit / data-edit-img value in the HTML).
CREATE TABLE site_content (
	key TEXT PRIMARY KEY NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('text', 'image')),
	value TEXT NOT NULL,
	alt TEXT NOT NULL DEFAULT '',
	updated_at INTEGER NOT NULL,
	updated_by TEXT REFERENCES accounts (id) ON DELETE SET NULL
);

-- HTML + CSS from the Page lab. target = 'site:global', 'page:<name>' or 'post:<id>'.
CREATE TABLE custom_pages (
	target TEXT PRIMARY KEY NOT NULL,
	html TEXT NOT NULL DEFAULT '',
	css TEXT NOT NULL DEFAULT '',
	mode TEXT NOT NULL DEFAULT 'below' CHECK (mode IN ('above', 'below', 'replace')),
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	updated_at INTEGER NOT NULL,
	updated_by TEXT REFERENCES accounts (id) ON DELETE SET NULL
);

-- Static "docs style" article posts (HTML body + scoped CSS). They appear in the normal post catalog with type "Article".
CREATE TABLE articles (
	id TEXT PRIMARY KEY NOT NULL,
	title TEXT NOT NULL,
	description TEXT NOT NULL,
	category TEXT NOT NULL,
	tags_json TEXT NOT NULL DEFAULT '[]',
	image TEXT NOT NULL DEFAULT '',
	image_alt TEXT NOT NULL DEFAULT '',
	body_html TEXT NOT NULL,
	css TEXT NOT NULL DEFAULT '',
	published_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	author_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT
);

CREATE INDEX articles_by_date ON articles (published_at DESC);
