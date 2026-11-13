import { sanitizeHtml, sanitizeCss } from "./sanitize.js";

const MAX_AUTHOR_LENGTH = 50;
const MAX_BODY_LENGTH = 1000;
const MAX_REQUEST_BYTES = 8192;
const MAX_PROFILE_IMAGE_LENGTH = 360000;
const MAX_PROFILE_REQUEST_BYTES = 400000;
const COMMENTS_PER_HOUR = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const THREAD_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const POST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALLOWED_ORIGINS = ["https://blog.ankomstudios.com", "null"];
const ROLE_LEVEL = { reader: 0, publisher: 1, editor: 2, admin: 3 };
const COMMENT_REACTIONS = new Set(["👍", "❤️", "😂", "🤔"]);
const REACTION_BY_BASE = new Map(Array.from(COMMENT_REACTIONS, function (emoji) { return [emoji.replace(/\uFE0F/g, ""), emoji]; }));
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 100000;
const MAX_ARTICLE_REQUEST_BYTES = 450000;
const MAX_ARTICLE_HTML = 300000;
const MAX_CSS_LENGTH = 60000;
const MAX_CUSTOM_HTML = 200000;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const MAX_CONTENT_CHANGES = 200;
const CONTENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const CUSTOM_TARGET_PATTERN = /^(?:site:global|page:[a-z0-9][a-z0-9-]{0,39}|post:[a-z0-9][a-z0-9-]{0,63})$/;
const UPLOAD_KEY_PATTERN = /^img\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|png|jpg|gif)$/;

function jsonResponse(payload, status) {
	return new Response(JSON.stringify(payload), {
		status: status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store"
		}
	});
}

function addCorsHeaders(request, response) {
	const origin = request.headers.get("Origin");
	if (!origin || !ALLOWED_ORIGINS.includes(origin)) return response;

	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", origin);
	if (origin !== "null") headers.set("Access-Control-Allow-Credentials", "true");
	headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
	headers.set("Access-Control-Allow-Headers", "Accept, Content-Type");
	headers.set("Access-Control-Max-Age", "86400");
	headers.append("Vary", "Origin");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function normalizeText(value, singleLine) {
	return value
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
		.trim()
		.replace(singleLine ? /\s+/g : /[ \t]+\n/g, singleLine ? " " : "\n");
}

async function readJsonBody(request, maxBytes) {
	maxBytes = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : MAX_REQUEST_BYTES;
	const length = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(length) && length > maxBytes) {
		return { error: "That request is too large.", status: 413 };
	}
	if (!request.body) {
		return { error: "A JSON request body is required.", status: 400 };
	}

	const reader = request.body.getReader();
	const chunks = [];
	let totalBytes = 0;
	while (true) {
		const part = await reader.read();
		if (part.done) break;
		totalBytes += part.value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			return { error: "That request is too large.", status: 413 };
		}
		chunks.push(part.value);
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	try {
		return { value: JSON.parse(new TextDecoder().decode(bytes)) };
	} catch {
		return { error: "The request body must be valid JSON.", status: 400 };
	}
}

async function hashAddress(address) {
	const bytes = new TextEncoder().encode(address);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), function (byte) {
		return byte.toString(16).padStart(2, "0");
	}).join("");
}

function accountView(row) {
	return {
		id: row.id,
		username: row.username,
		displayName: row.display_name || row.username,
		profileImage: row.profile_image || "",
		role: row.role
	};
}

function validOrigin(request) {
	const origin = request.headers.get("Origin");
	return !origin || origin === new URL(request.url).origin;
}

function decodeHex(value) {
	const bytes = new Uint8Array(value.length / 2);
	for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
	return bytes;
}

function encodeHex(bytes) {
	return Array.from(new Uint8Array(bytes), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
}

async function passwordHash(password, salt) {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: PASSWORD_ITERATIONS }, key, 256);
	return encodeHex(bits);
}

async function hashPassword(password) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return "pbkdf2$" + PASSWORD_ITERATIONS + "$" + encodeHex(salt) + "$" + await passwordHash(password, salt);
}

async function verifyPassword(password, stored) {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2" || Number(parts[1]) !== PASSWORD_ITERATIONS) return false;
	const actual = await passwordHash(password, decodeHex(parts[2]));
	return actual === parts[3];
}

function readCookie(request, name) {
	const cookies = request.headers.get("Cookie") || "";
	const match = cookies.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
	if (!match) return "";
	try { return decodeURIComponent(match[1]); } catch { return ""; }
}

function withSessionCookie(response, token, maxAge) {
	const headers = new Headers(response.headers);
	headers.append("Set-Cookie", "dsdk_session=" + (token || "") + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
}

async function createSession(accountId, env) {
	const token = encodeHex(crypto.getRandomValues(new Uint8Array(32)));
	const now = Date.now();
	await env.DB.prepare("DELETE FROM account_sessions WHERE expires_at < ?").bind(now).run();
	await env.DB.prepare("INSERT INTO account_sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
		.bind(await hashAddress(token), accountId, now + SESSION_LIFETIME_MS, now).run();
	return token;
}

async function currentAccount(request, env) {
	const token = readCookie(request, "dsdk_session");
	if (!token) return null;
	const tokenHash = await hashAddress(token);
	const row = await env.DB.prepare(
		"SELECT accounts.id, accounts.username, accounts.display_name, accounts.profile_image, accounts.role, account_sessions.expires_at " +
		"FROM account_sessions JOIN accounts ON accounts.id = account_sessions.account_id WHERE account_sessions.token_hash = ?"
	).bind(tokenHash).first();
	if (!row) return null;
	if (row.expires_at <= Date.now()) {
		await env.DB.prepare("DELETE FROM account_sessions WHERE token_hash = ?").bind(tokenHash).run();
		return null;
	}
	return row;
}

function hasRole(account, role) {
	return Boolean(account && ROLE_LEVEL[account.role] >= ROLE_LEVEL[role]);
}

function usernameValid(value) {
	return typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$/.test(value);
}

function passwordValid(value) {
	return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

function articleCatalogItem(row) {
	let tags = [];
	try { tags = JSON.parse(row.tags_json); } catch {}
	return {
		id: row.id, title: row.title, description: row.description, videoId: "", videoSrc: "",
		type: "Article", category: row.category, tags: tags, publishedAt: row.published_at,
		image: row.image, imageAlt: row.image_alt, authorId: row.author_id,
		pageUrl: "post.html?id=" + encodeURIComponent(row.id)
	};
}

async function readCatalog(env) {
	const asset = await env.ASSETS.fetch(new Request("https://blog-site-assets/blog-posts.json"));
	if (!asset.ok) throw new Error("Post catalog asset request failed with status " + asset.status);
	const staticPosts = await asset.json();
	if (!Array.isArray(staticPosts)) throw new Error("Post catalog must be a JSON array");
	const removedRows = await env.DB.prepare("SELECT post_id FROM removed_posts").all();
	const removedIds = new Set(removedRows.results.map(function (row) { return row.post_id; }));
	const dynamicPosts = await env.DB.prepare(
		"SELECT id, title, description, video_id, video_src, category, tags_json, image, image_alt, published_at, author_id FROM video_posts"
	).all();
	const posts = dynamicPosts.results.map(function (row) {
		let tags = [];
		try { tags = JSON.parse(row.tags_json); } catch {}
		return {
			id: row.id, title: row.title, description: row.description, videoId: row.video_id, videoSrc: row.video_src,
			type: "Video", category: row.category, tags: tags, publishedAt: row.published_at,
			image: row.image, imageAlt: row.image_alt, authorId: row.author_id,
			pageUrl: "post.html?id=" + encodeURIComponent(row.id)
		};
	});
	let articlePosts = [];
	try {
		const articleRows = await env.DB.prepare(
			"SELECT id, title, description, category, tags_json, image, image_alt, published_at, author_id FROM articles"
		).all();
		articlePosts = articleRows.results.map(articleCatalogItem);
	} catch (error) {
		console.error("blog-feed: articles table unavailable (has migration 0007 been applied?)", error);
	}
	return staticPosts.filter(function (post) { return !removedIds.has(post.id); }).concat(posts, articlePosts)
		.sort(function (a, b) { return Date.parse(b.publishedAt) - Date.parse(a.publishedAt); });
}

async function readJsonRequest(request, maxBytes) {
	if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
		return { error: "Use a JSON request body.", status: 415 };
	}
	return readJsonBody(request, maxBytes);
}

function accountError(message, status) {
	return jsonResponse({ error: message }, status);
}

async function registerAccount(request, env) {
	const parsed = await readJsonRequest(request);
	if (parsed.error) return accountError(parsed.error, parsed.status);
	const value = parsed.value;
	if (!value || typeof value !== "object" || Array.isArray(value) || !usernameValid(value.username) || !passwordValid(value.password)) {
		return accountError("Use a 3–32 character username and a password of 12–128 characters.", 400);
	}
	const id = crypto.randomUUID();
	const password = await hashPassword(value.password);
	const now = Date.now();
	const token = encodeHex(crypto.getRandomValues(new Uint8Array(32)));
	try {
		await env.DB.batch([
			env.DB.prepare("INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'reader', ?)")
				.bind(id, value.username, password, now),
			env.DB.prepare("INSERT INTO account_sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
				.bind(await hashAddress(token), id, now + SESSION_LIFETIME_MS, now)
		]);
		const response = jsonResponse({ account: accountView({
			id: id, username: value.username, role: "reader", display_name: "", profile_image: ""
		}) }, 201);
		return withSessionCookie(response, token, SESSION_LIFETIME_MS / 1000);
	} catch (error) {
		if (String(error.message).includes("UNIQUE")) return accountError("That username is already in use.", 409);
		throw error;
	}
}

async function accountApi(request, env, path) {
	if (!["GET", "POST", "PATCH"].includes(request.method)) return accountError("Method not allowed.", 405);
	if (request.method !== "GET" && !validOrigin(request)) return accountError("This origin cannot change accounts.", 403);

	if (path === "/api/accounts/register" && request.method === "POST") return registerAccount(request, env);
	if (path === "/api/accounts/login" && request.method === "POST") {
		const parsed = await readJsonRequest(request);
		if (parsed.error) return accountError(parsed.error, parsed.status);
		const value = parsed.value;
		if (!value || typeof value.username !== "string" || typeof value.password !== "string") return accountError("Username and password are required.", 400);
		const windowStart = Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS;
		const ipHash = await hashAddress(request.headers.get("CF-Connecting-IP") || "unknown");
		await env.DB.prepare("DELETE FROM login_rate_limits WHERE window_start < ?").bind(windowStart - RATE_WINDOW_MS).run();
		const result = await env.DB.prepare(
			"INSERT INTO login_rate_limits (ip_hash, window_start, attempt_count) VALUES (?, ?, 1) " +
			"ON CONFLICT (ip_hash, window_start) DO UPDATE SET attempt_count = attempt_count + 1 RETURNING attempt_count"
		).bind(ipHash, windowStart).first();
		if (result.attempt_count > 10) return accountError("Too many sign-in attempts. Try again later.", 429);
		const account = await env.DB.prepare("SELECT id, username, password_hash, display_name, profile_image, role FROM accounts WHERE username = ? COLLATE NOCASE")
			.bind(value.username).first();
		if (!account || !await verifyPassword(value.password, account.password_hash)) return accountError("Username or password is incorrect.", 401);
		const token = await createSession(account.id, env);
		return withSessionCookie(jsonResponse({ account: accountView(account) }, 200), token, SESSION_LIFETIME_MS / 1000);
	}
	if (path === "/api/accounts/logout" && request.method === "POST") {
		const token = readCookie(request, "dsdk_session");
		if (token) await env.DB.prepare("DELETE FROM account_sessions WHERE token_hash = ?").bind(await hashAddress(token)).run();
		return withSessionCookie(jsonResponse({ ok: true }, 200), "", 0);
	}
	if (path === "/api/accounts/me" && request.method === "GET") {
		const account = await currentAccount(request, env);
		return account ? jsonResponse({ account: accountView(account) }, 200) : accountError("Sign in required.", 401);
	}
	if (path === "/api/accounts/me" && request.method === "PATCH") {
		const account = await currentAccount(request, env);
		if (!account) return accountError("Sign in required.", 401);
		const parsed = await readJsonRequest(request, MAX_PROFILE_REQUEST_BYTES);
		if (parsed.error) return accountError(parsed.error, parsed.status);
		const value = parsed.value;
		if (!value || typeof value !== "object" || Array.isArray(value)) return accountError("The profile request is invalid.", 400);
		if (value.displayName !== undefined && typeof value.displayName !== "string") return accountError("Display name must be text.", 400);
		const displayName = value.displayName === undefined ? account.display_name : normalizeText(value.displayName, true);
		const profileImage = value.profileImage === undefined ? account.profile_image : value.profileImage;
		if (Array.from(displayName).length > 50) return accountError("Display name must be 50 characters or fewer.", 400);
		if (!validProfileImage(profileImage)) return accountError("Profile image must be an HTTPS URL or a supported image data URL.", 400);
		await env.DB.prepare("UPDATE accounts SET display_name = ?, profile_image = ? WHERE id = ?")
			.bind(displayName, profileImage, account.id).run();
		return jsonResponse({ account: accountView(Object.assign({}, account, {
			display_name: displayName, profile_image: profileImage
		})) }, 200);
	}
	return accountError("Not found.", 404);
}

function videoIdFrom(value) {
	if (typeof value !== "string") return "";
	if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
	try {
		const url = new URL(value);
		if (["www.youtube-nocookie.com", "youtube-nocookie.com", "www.youtube.com", "youtube.com"].includes(url.hostname) && url.pathname.startsWith("/embed/")) {
			const id = url.pathname.slice(7).split("/")[0];
			return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
		}
	} catch {}
	return "";
}

function videoSourceFrom(value) {
	const videoId = videoIdFrom(value);
	if (videoId) return { videoId: videoId, videoSrc: "" };
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
			!/\.(mp4|m4v|webm|ogv|ogg)$/i.test(url.pathname)) return null;
		return { videoId: "", videoSrc: url.href };
	} catch {
		return null;
	}
}

function validImage(value) {
	if (value === undefined || value === "") return true;
	if (typeof value !== "string" || value.length > 500 || value.indexOf("\\") !== -1) return false;
	return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || /^https:\/\//i.test(value);
}

function validProfileImage(value) {
	if (value === "") return true;
	if (typeof value !== "string") return false;
	if (value.indexOf("data:") === 0) {
		return value.length <= MAX_PROFILE_IMAGE_LENGTH && /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
	}
	if (value.length > 500) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
	} catch {
		return false;
	}
}

async function postsApi(request, env, path) {
	if (path === "/api/posts" && request.method === "GET") {
		try { return jsonResponse({ posts: await readCatalog(env) }, 200); }
		catch (error) {
			console.error("blog-feed: failed to load post catalog", error);
			return accountError("Posts could not be loaded.", 503);
		}
	}
	if (request.method !== "GET" && !validOrigin(request)) return accountError("This origin cannot change posts.", 403);
	if (path === "/api/posts" && request.method === "POST") {
		const account = await currentAccount(request, env);
		if (!hasRole(account, "publisher")) return accountError("Video publishing access is required.", account ? 403 : 401);
		const parsed = await readJsonRequest(request);
		if (parsed.error) return accountError(parsed.error, parsed.status);
		const value = parsed.value || {};
		const media = videoSourceFrom(value.videoSource || value.videoId || value.embedSrc);
		const tags = Array.isArray(value.tags) ? value.tags : [];
		const cleanTags = tags.map(function (tag) { return typeof tag === "string" ? tag.trim() : tag; });
		if (typeof value.id !== "string" || !POST_ID_PATTERN.test(value.id) || typeof value.title !== "string" || !value.title.trim() || value.title.length > 160 ||
			typeof value.description !== "string" || !value.description.trim() || value.description.length > 1000 || !media ||
			typeof value.category !== "string" || !value.category.trim() || value.category.length > 50 || tags.length > 10 ||
			!cleanTags.every(function (tag) { return typeof tag === "string" && tag && tag.length <= 30; }) || !validImage(value.image) ||
			(value.imageAlt !== undefined && value.imageAlt !== "" && (typeof value.imageAlt !== "string" || value.imageAlt.length > 200))) {
			return accountError("Provide a slug, title, description, YouTube ID/embed or HTTPS video file URL, category, and up to 10 valid tags.", 400);
		}
		if ((await readCatalog(env)).some(function (post) { return post.id === value.id; })) return accountError("A post already uses that slug.", 409);
		const publishedAt = new Date().toISOString();
		try {
			await env.DB.prepare(
				"INSERT INTO video_posts (id, title, description, video_id, video_src, category, tags_json, image, image_alt, published_at, author_id) " +
				"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
			).bind(value.id, value.title.trim(), value.description.trim(), media.videoId, media.videoSrc, value.category.trim(), JSON.stringify(cleanTags),
				value.image || "", value.imageAlt || "", publishedAt, account.id).run();
		} catch (error) {
			if (String(error.message).includes("UNIQUE")) return accountError("A post already uses that slug.", 409);
			throw error;
		}
		return jsonResponse({ post: { id: value.id, title: value.title.trim(), description: value.description.trim(), videoId: media.videoId, videoSrc: media.videoSrc,
			type: "Video", category: value.category.trim(), tags: cleanTags, publishedAt: publishedAt, image: value.image || "",
			imageAlt: value.imageAlt || "", authorId: account.id, pageUrl: "post.html?id=" + encodeURIComponent(value.id) } }, 201);
	}
	const deleteMatch = path.match(/^\/api\/posts\/([a-z0-9][a-z0-9-]{0,63})$/);
	if (deleteMatch && request.method === "DELETE") {
		const account = await currentAccount(request, env);
		if (!hasRole(account, "publisher")) return accountError("Video deletion access is required.", account ? 403 : 401);
		const post = await env.DB.prepare("SELECT id, author_id FROM video_posts WHERE id = ?").bind(deleteMatch[1]).first();
		if (!post) {
			const article = await env.DB.prepare("SELECT id, author_id FROM articles WHERE id = ?").bind(deleteMatch[1]).first().catch(function () { return null; });
			if (article) {
				if (article.author_id !== account.id && !hasRole(account, "editor")) return accountError("You can only delete articles you published.", 403);
				await env.DB.batch([
					env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(article.id),
					env.DB.prepare("DELETE FROM threads WHERE post_id = ?").bind(article.id),
					env.DB.prepare("DELETE FROM articles WHERE id = ?").bind(article.id)
				]);
				return jsonResponse({ ok: true }, 200);
			}
			const catalogPost = (await readCatalog(env)).find(function (item) { return item.id === deleteMatch[1]; });
			if (!catalogPost || !(catalogPost.videoId || catalogPost.videoSrc)) return accountError("Video not found.", 404);
			if (!hasRole(account, "editor")) return accountError("Only editors can remove existing site videos.", 403);
			await env.DB.batch([
				env.DB.prepare("INSERT INTO removed_posts (post_id, removed_at, removed_by) VALUES (?, ?, ?)").bind(catalogPost.id, Date.now(), account.id),
				env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(catalogPost.id),
				env.DB.prepare("DELETE FROM threads WHERE post_id = ?").bind(catalogPost.id)
			]);
			return jsonResponse({ ok: true }, 200);
		}
		if (post.author_id !== account.id && !hasRole(account, "editor")) return accountError("You can only delete videos you published.", 403);
		await env.DB.batch([
			env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(post.id),
			env.DB.prepare("DELETE FROM threads WHERE post_id = ?").bind(post.id),
			env.DB.prepare("DELETE FROM video_posts WHERE id = ?").bind(post.id)
		]);
		return jsonResponse({ ok: true }, 200);
	}
	return accountError("Not found.", 404);
}

function toComment(row) {
	return {
		id: row.id,
		author: row.display_name || row.username || row.author,
		accountId: row.account_id || "",
		profileImage: row.profile_image || "",
		body: row.body,
		createdAt: new Date(row.created_at).toISOString(),
		parentCommentId: row.parent_comment_id || null,
		pinned: Boolean(row.pinned),
		reactions: row.reactions || []
	};
}

function threadView(row) {
	const off = row.mode === "off";
	return {
		postId: row.post_id,
		title: row.title,
		createdAt: new Date(row.created_at).toISOString(),
		mode: row.mode || "default",
		closesAt: off ? null : new Date(row.closes_at).toISOString(),
		closed: off ? false : Date.now() >= row.closes_at
	};
}

async function getPost(postId, env) {
	if (!POST_ID_PATTERN.test(postId)) {
		return { error: "A valid postId is required.", status: 400 };
	}

	try {
		const posts = await readCatalog(env);
		const post = posts.find(function (item) { return item.id === postId; });
		if (!post) return { error: "This blog post does not exist.", status: 404 };
		const createdAt = Date.parse(post.publishedAt);
		if (!Number.isFinite(createdAt)) throw new Error("Post has an invalid publishedAt date");

		await env.DB.prepare(
			"INSERT OR IGNORE INTO threads (post_id, title, created_at, closes_at) VALUES (?, ?, ?, ?)"
		).bind(post.id, post.title, createdAt, createdAt + THREAD_LIFETIME_MS).run();
		const thread = await env.DB.prepare(
			"SELECT post_id, title, created_at, closes_at, mode FROM threads WHERE post_id = ?"
		).bind(post.id).first();
		if (!thread) throw new Error("Thread initialization did not produce a row");
		return { post: post, thread: threadView(thread) };
	} catch (error) {
		console.error("blog-feed: failed to initialize thread", error);
		return { error: "This discussion could not be loaded. Try again shortly.", status: 503 };
	}
}

async function listComments(request, env) {
	const postId = new URL(request.url).searchParams.get("postId") || "";
	const threadResult = await getPost(postId, env);
	if (threadResult.error) return jsonResponse({ error: threadResult.error }, threadResult.status);

	try {
		const account = await currentAccount(request, env);
		const [comments, count, reactions] = await Promise.all([
			env.DB.prepare(
				"SELECT comments.id, comments.author, comments.account_id, comments.parent_comment_id, comments.pinned, " +
				"comments.body, comments.created_at, accounts.username, accounts.display_name, accounts.profile_image " +
				"FROM comments LEFT JOIN accounts ON accounts.id = comments.account_id " +
				"WHERE comments.post_id = ? ORDER BY comments.pinned DESC, comments.created_at ASC, comments.id ASC LIMIT 500"
			).bind(postId).all(),
			env.DB.prepare("SELECT COUNT(*) AS count FROM comments WHERE post_id = ?").bind(postId).first(),
			env.DB.prepare(
				"SELECT comment_id, emoji, COUNT(*) AS count, " +
				"SUM(CASE WHEN account_id = ? THEN 1 ELSE 0 END) AS mine " +
				"FROM comment_reactions WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?) " +
				"GROUP BY comment_id, emoji"
			).bind(account ? account.id : "", postId).all()
		]);
		const reactionMap = new Map();
		reactions.results.forEach(function (row) {
			if (!reactionMap.has(row.comment_id)) reactionMap.set(row.comment_id, []);
			reactionMap.get(row.comment_id).push({ emoji: row.emoji, count: row.count, mine: row.mine > 0 });
		});
		const items = comments.results.map(function (row) {
			row.reactions = reactionMap.get(row.id) || [];
			return toComment(row);
		});
		return jsonResponse({
			comments: items,
			totalCount: count.count,
			account: account ? accountView(account) : null,
			thread: threadResult.thread
		}, 200);
	} catch (error) {
		console.error("blog-feed: failed to list comments", error);
		return jsonResponse({ error: "Comments could not be loaded. Try again shortly." }, 503);
	}
}

async function createComment(request, env) {
	const origin = request.headers.get("Origin");
	if (origin && !ALLOWED_ORIGINS.includes(origin)) {
		return jsonResponse({ error: "Comments can only be submitted from this site." }, 403);
	}
	const account = await currentAccount(request, env);
	if (!account) return jsonResponse({ error: "Sign in to join the conversation." }, 401);
	if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
		return jsonResponse({ error: "Use a JSON request to submit a comment." }, 415);
	}

	const parsed = await readJsonBody(request);
	if (parsed.error) return jsonResponse({ error: parsed.error }, parsed.status);
	if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
		return jsonResponse({ error: "The comment request is invalid." }, 400);
	}

	const postId = typeof parsed.value.postId === "string" ? parsed.value.postId : "";
	const body = typeof parsed.value.body === "string" ? normalizeText(parsed.value.body, false) : "";
	const parentCommentId = typeof parsed.value.parentCommentId === "string" ? parsed.value.parentCommentId : "";
	if (!POST_ID_PATTERN.test(postId)) {
		return jsonResponse({ error: "A valid postId is required." }, 400);
	}
	if (!body || Array.from(body).length > MAX_BODY_LENGTH) {
		return jsonResponse({ error: "Comment is required and must be 1,000 characters or fewer." }, 400);
	}

	const threadResult = await getPost(postId, env);
	if (threadResult.error) return jsonResponse({ error: threadResult.error }, threadResult.status);
	if (threadResult.thread.closed) {
		return jsonResponse({
			error: "Comments for this thread are now closed.",
			thread: threadResult.thread
		}, 409);
	}
	if (parentCommentId) {
		const parent = await env.DB.prepare("SELECT id, parent_comment_id FROM comments WHERE id = ? AND post_id = ?")
			.bind(parentCommentId, postId).first();
		if (!parent) return jsonResponse({ error: "The comment you replied to no longer exists." }, 404);
		if (parent.parent_comment_id) return jsonResponse({ error: "Replies can only be nested one level deep." }, 400);
	}

	const now = Date.now();
	const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
	const address = request.headers.get("CF-Connecting-IP") || "unknown";
	const ipHash = await hashAddress(address);
	const author = account.display_name || account.username;
	const comment = {
		id: crypto.randomUUID(),
		author: author,
		account_id: account.id,
		username: account.username,
		display_name: account.display_name,
		profile_image: account.profile_image,
		parent_comment_id: parentCommentId || null,
		pinned: 0,
		body: body,
		created_at: now
	};

	try {
		const results = await env.DB.batch([
			env.DB.prepare("DELETE FROM comment_rate_limits WHERE window_start < ?")
				.bind(windowStart - RATE_WINDOW_MS),
			env.DB.prepare(
				"INSERT INTO comment_rate_limits (ip_hash, window_start, comment_count) VALUES (?, ?, 1) " +
				"ON CONFLICT (ip_hash, window_start) DO UPDATE SET comment_count = MIN(comment_count + 1, ?) " +
				"RETURNING comment_count"
			).bind(ipHash, windowStart, COMMENTS_PER_HOUR + 1),
			env.DB.prepare(
				"INSERT INTO comments (id, post_id, author, body, created_at, ip_hash, account_id, parent_comment_id) " +
				"SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (" +
				"SELECT 1 FROM comment_rate_limits WHERE ip_hash = ? AND window_start = ? AND comment_count <= ?) " +
				"AND EXISTS (SELECT 1 FROM threads WHERE post_id = ? AND (mode = 'off' OR closes_at > ?))"
			).bind(
				comment.id, postId, comment.author, comment.body, comment.created_at, ipHash, account.id, parentCommentId || null,
				ipHash, windowStart, COMMENTS_PER_HOUR, postId, Date.now()
			)
		]);

		if (!results[2].meta.changes) {
			const currentThread = await env.DB.prepare(
				"SELECT closes_at, mode FROM threads WHERE post_id = ?"
			).bind(postId).first();
			if (!currentThread || (currentThread.mode !== "off" && Date.now() >= currentThread.closes_at)) {
				const closedThread = threadResult.thread;
				closedThread.closed = true;
				return jsonResponse({
					error: "Comments for this thread are now closed.",
					thread: closedThread
				}, 409);
			}
			const retryAfter = Math.max(1, Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000));
			return new Response(JSON.stringify({
				error: "You’ve reached the limit of five comments per hour. Please try again later."
			}), {
				status: 429,
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "no-store",
					"Retry-After": String(retryAfter)
				}
			});
		}

		return jsonResponse({ comment: toComment(comment) }, 201);
	} catch (error) {
		console.error("blog-feed: failed to save comment", error);
		return jsonResponse({ error: "Your comment could not be saved. Try again shortly." }, 503);
	}
}

async function setCommentReaction(request, env) {
	if (!validOrigin(request)) return accountError("This origin cannot react to comments.", 403);
	const account = await currentAccount(request, env);
	if (!account) return accountError("Sign in to react to comments.", 401);
	const parsed = await readJsonRequest(request);
	if (parsed.error) return accountError(parsed.error, parsed.status);
	const value = parsed.value;
	const postId = value && typeof value.postId === "string" ? value.postId : "";
	const commentId = value && typeof value.commentId === "string" ? value.commentId : "";
	const rawEmoji = value && typeof value.emoji === "string" ? value.emoji : "";
	const emoji = rawEmoji ? REACTION_BY_BASE.get(rawEmoji.replace(/\uFE0F/g, "")) || "" : "";
	if (!POST_ID_PATTERN.test(postId) || !commentId || (rawEmoji && !emoji)) {
		return accountError("Choose a valid comment reaction.", 400);
	}
	const comment = await env.DB.prepare("SELECT id FROM comments WHERE id = ? AND post_id = ?")
		.bind(commentId, postId).first();
	if (!comment) return accountError("The comment no longer exists.", 404);
	if (!emoji) {
		await env.DB.prepare("DELETE FROM comment_reactions WHERE comment_id = ? AND account_id = ?")
			.bind(commentId, account.id).run();
		return jsonResponse({ ok: true, emoji: "" }, 200);
	}
	await env.DB.prepare(
		"INSERT INTO comment_reactions (comment_id, account_id, emoji, created_at) VALUES (?, ?, ?, ?) " +
		"ON CONFLICT (comment_id, account_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at"
	).bind(commentId, account.id, emoji, Date.now()).run();
	return jsonResponse({ ok: true, emoji: emoji }, 200);
}

async function pinComment(request, env, commentId) {
	if (!validOrigin(request)) return accountError("This origin cannot pin comments.", 403);
	const account = await currentAccount(request, env);
	if (!hasRole(account, "admin")) return accountError("Administrator access required.", account ? 403 : 401);
	const parsed = await readJsonRequest(request);
	if (parsed.error) return accountError(parsed.error, parsed.status);
	if (!parsed.value || typeof parsed.value.pinned !== "boolean") return accountError("Choose whether to pin this comment.", 400);
	const result = await env.DB.prepare("UPDATE comments SET pinned = ? WHERE id = ?")
		.bind(parsed.value.pinned ? 1 : 0, commentId).run();
	if (!result.meta.changes) return accountError("The comment no longer exists.", 404);
	return jsonResponse({ ok: true, pinned: parsed.value.pinned }, 200);
}

/* ------------------------------------------------------------------ discussion timer */

async function threadApi(request, env) {
	if (!validOrigin(request)) return accountError("This origin cannot change discussions.", 403);
	const account = await currentAccount(request, env);
	if (!hasRole(account, "editor")) return accountError("Editor access is required.", account ? 403 : 401);
	const parsed = await readJsonRequest(request);
	if (parsed.error) return accountError(parsed.error, parsed.status);
	const value = parsed.value;
	if (!value || typeof value !== "object" || Array.isArray(value)) return accountError("The request is invalid.", 400);
	const postId = typeof value.postId === "string" ? value.postId : "";
	const mode = value.mode;
	if (mode !== "default" && mode !== "off" && mode !== "custom") return accountError("Choose default, off or custom.", 400);
	const found = await getPost(postId, env);
	if (found.error) return accountError(found.error, found.status);

	let closesAt = Date.parse(found.post.publishedAt) + THREAD_LIFETIME_MS;
	if (mode === "custom") {
		closesAt = typeof value.closesAt === "string" ? Date.parse(value.closesAt) : NaN;
		if (!Number.isFinite(closesAt)) return accountError("Pick a date and time for the discussion to close.", 400);
		if (closesAt <= Date.now()) return accountError("Pick a date and time in the future.", 400);
		if (closesAt > Date.now() + 10 * 365 * 24 * 60 * 60 * 1000) return accountError("Pick a date within the next 10 years.", 400);
	}
	if (mode === "off") {
		await env.DB.prepare("UPDATE threads SET mode = 'off' WHERE post_id = ?").bind(postId).run();
	} else {
		await env.DB.prepare("UPDATE threads SET mode = ?, closes_at = ? WHERE post_id = ?").bind(mode, closesAt, postId).run();
	}
	const row = await env.DB.prepare("SELECT post_id, title, created_at, closes_at, mode FROM threads WHERE post_id = ?").bind(postId).first();
	return jsonResponse({ thread: threadView(row) }, 200);
}

/* ------------------------------------------------------------------ on-site text + picture editing */

function contentValueValid(entry) {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
	if (typeof entry.value !== "string") return null;
	if (entry.type === "text") {
		const text = normalizeText(entry.value, false);
		return text.length <= 4000 ? { type: "text", value: text, alt: "" } : null;
	}
	if (entry.type === "image") {
		const alt = entry.alt === undefined || entry.alt === null ? "" : entry.alt;
		if (typeof alt !== "string" || alt.length > 200) return null;
		const value = entry.value.trim();
		return value && validImage(value) ? { type: "image", value: value, alt: normalizeText(alt, true) } : null;
	}
	return null;
}

async function contentApi(request, env) {
	if (request.method === "GET") {
		try {
			const rows = await env.DB.prepare("SELECT key, type, value, alt FROM site_content").all();
			const content = {};
			rows.results.forEach(function (row) { content[row.key] = { type: row.type, value: row.value, alt: row.alt }; });
			return jsonResponse({ content: content }, 200);
		} catch (error) {
			console.error("blog-feed: failed to read site content", error);
			return accountError("Site content could not be loaded.", 503);
		}
	}
	if (request.method !== "PUT") return accountError("Method not allowed.", 405);
	if (!validOrigin(request)) return accountError("This origin cannot change the site.", 403);
	const account = await currentAccount(request, env);
	if (!hasRole(account, "admin")) return accountError("Administrator access required.", account ? 403 : 401);
	const parsed = await readJsonRequest(request, 400000);
	if (parsed.error) return accountError(parsed.error, parsed.status);
	const value = parsed.value;
	if (!value || typeof value !== "object" || Array.isArray(value)) return accountError("The request is invalid.", 400);
	const changes = value.changes === undefined ? {} : value.changes;
	const resets = value.reset === undefined ? [] : value.reset;
	if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Array.isArray(resets)) return accountError("The request is invalid.", 400);
	const keys = Object.keys(changes);
	if (keys.length + resets.length > MAX_CONTENT_CHANGES) return accountError("Too many changes at once. Save in smaller batches.", 400);
	const now = Date.now();
	const statements = [];
	for (const key of keys) {
		const clean = CONTENT_KEY_PATTERN.test(key) ? contentValueValid(changes[key]) : null;
		if (!clean) return accountError("Change “" + key.slice(0, 60) + "” is not valid (text up to 4,000 characters; pictures need an https:// or site address).", 400);
		statements.push(env.DB.prepare(
			"INSERT INTO site_content (key, type, value, alt, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) " +
			"ON CONFLICT (key) DO UPDATE SET type = excluded.type, value = excluded.value, alt = excluded.alt, " +
			"updated_at = excluded.updated_at, updated_by = excluded.updated_by"
		).bind(key, clean.type, clean.value, clean.alt, now, account.id));
	}
	for (const key of resets) {
		if (typeof key !== "string" || !CONTENT_KEY_PATTERN.test(key)) return accountError("A reset key is not valid.", 400);
		statements.push(env.DB.prepare("DELETE FROM site_content WHERE key = ?").bind(key));
	}
	if (statements.length) await env.DB.batch(statements);
	return jsonResponse({ ok: true }, 200);
}

/* ------------------------------------------------------------------ Page lab (custom HTML + CSS per page / post / whole site) */

function customView(row) {
	return row ? { html: row.html, css: row.css, mode: row.mode, enabled: Boolean(row.enabled), updatedAt: new Date(row.updated_at).toISOString() } : null;
}

async function customApi(request, env) {
	const url = new URL(request.url);
	const target = url.searchParams.get("target") || "";
	if (request.method === "GET") {
		if (!CUSTOM_TARGET_PATTERN.test(target)) return accountError("A valid target is required.", 400);
		try {
			const rows = await env.DB.prepare("SELECT target, html, css, mode, enabled, updated_at FROM custom_pages WHERE target IN (?, 'site:global')").bind(target).all();
			const byTarget = {};
			rows.results.forEach(function (row) { byTarget[row.target] = row; });
			return jsonResponse({ custom: customView(byTarget[target]), global: customView(byTarget["site:global"]) }, 200);
		} catch (error) {
			console.error("blog-feed: failed to read custom pages", error);
			return accountError("Custom page code could not be loaded.", 503);
		}
	}
	if (request.method !== "PUT" && request.method !== "DELETE") return accountError("Method not allowed.", 405);
	if (!validOrigin(request)) return accountError("This origin cannot change the site.", 403);
	const account = await currentAccount(request, env);
	if (!hasRole(account, "admin")) return accountError("Administrator access required.", account ? 403 : 401);

	if (request.method === "DELETE") {
		if (!CUSTOM_TARGET_PATTERN.test(target)) return accountError("A valid target is required.", 400);
		await env.DB.prepare("DELETE FROM custom_pages WHERE target = ?").bind(target).run();
		return jsonResponse({ ok: true }, 200);
	}
	const parsed = await readJsonRequest(request, 400000);
	if (parsed.error) return accountError(parsed.error, parsed.status);
	const value = parsed.value;
	if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.target !== "string" || !CUSTOM_TARGET_PATTERN.test(value.target)) {
		return accountError("A valid target is required.", 400);
	}
	const mode = value.mode === undefined ? "below" : value.mode;
	if (mode !== "above" && mode !== "below" && mode !== "replace") return accountError("Choose above, below or replace.", 400);
	if (value.enabled !== undefined && typeof value.enabled !== "boolean") return accountError("Enabled must be true or false.", 400);
	const rawHtml = value.html === undefined ? "" : value.html;
	const rawCss = value.css === undefined ? "" : value.css;
	if (typeof rawHtml !== "string" || typeof rawCss !== "string") return accountError("HTML and CSS must be text.", 400);
	if (rawHtml.length > MAX_CUSTOM_HTML) return accountError("The HTML is too long (200,000 characters at most).", 413);
	if (rawCss.length > MAX_CSS_LENGTH) return accountError("The CSS is too long (60,000 characters at most).", 413);
	const html = value.target === "site:global" ? "" : sanitizeHtml(rawHtml, { allowStyle: true });
	const css = sanitizeCss(rawCss);
	await env.DB.prepare(
		"INSERT INTO custom_pages (target, html, css, mode, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?) " +
		"ON CONFLICT (target) DO UPDATE SET html = excluded.html, css = excluded.css, mode = excluded.mode, enabled = excluded.enabled, " +
		"updated_at = excluded.updated_at, updated_by = excluded.updated_by"
	).bind(value.target, html, css, mode, value.enabled === false ? 0 : 1, Date.now(), account.id).run();
	return jsonResponse({ ok: true }, 200);
}

/* ------------------------------------------------------------------ articles */

function articleView(row) {
	let tags = [];
	try { tags = JSON.parse(row.tags_json); } catch {}
	return {
		id: row.id, title: row.title, description: row.description, category: row.category, tags: tags,
		image: row.image, imageAlt: row.image_alt, bodyHtml: row.body_html, css: row.css,
		publishedAt: row.published_at, updatedAt: row.updated_at, authorId: row.author_id
	};
}

/* Validates the shared article fields; returns { error } or { value } */
function readArticleFields(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "The article request is invalid." };
	const tags = Array.isArray(value.tags) ? value.tags : [];
	const cleanTags = tags.map(function (tag) { return typeof tag === "string" ? tag.trim() : tag; });
	if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 160 ||
		typeof value.description !== "string" || !value.description.trim() || value.description.length > 1000 ||
		(value.category !== undefined && value.category !== "" && (typeof value.category !== "string" || value.category.length > 50)) ||
		tags.length > 10 || !cleanTags.every(function (tag) { return typeof tag === "string" && tag && tag.length <= 30; }) ||
		!validImage(value.image) ||
		(value.imageAlt !== undefined && value.imageAlt !== "" && (typeof value.imageAlt !== "string" || value.imageAlt.length > 200))) {
		return { error: "Provide a title, a short summary, a category, up to 10 valid tags and a valid cover picture address." };
	}
	if (typeof value.bodyHtml !== "string" || value.bodyHtml.length > MAX_ARTICLE_HTML) return { error: "The article text is missing or too long." };
	if (value.css !== undefined && (typeof value.css !== "string" || value.css.length > MAX_CSS_LENGTH)) return { error: "The article CSS must be text of 60,000 characters or fewer." };
	const bodyHtml = sanitizeHtml(value.bodyHtml, { allowStyle: true });
	if (!/[^\s]/.test(bodyHtml.replace(/<[^>]*>/g, "")) && !/<(?:img|video|iframe)\b/.test(bodyHtml)) return { error: "The article is empty." };
	return { value: {
		title: value.title.trim(), description: value.description.trim(), category: (value.category || "Articles").trim() || "Articles",
		tags: cleanTags, image: value.image || "", imageAlt: value.imageAlt || "", bodyHtml: bodyHtml, css: sanitizeCss(value.css || "")
	} };
}

async function articlesApi(request, env, path) {
	const match = path.match(/^\/api\/articles(?:\/([a-z0-9][a-z0-9-]{0,63}))?$/);
	if (!match) return accountError("Not found.", 404);
	const id = match[1] || "";

	if (id && request.method === "GET") {
		const row = await env.DB.prepare("SELECT * FROM articles WHERE id = ?").bind(id).first().catch(function (error) {
			console.error("blog-feed: failed to read article", error);
			return undefined;
		});
		if (row === undefined) return accountError("The article could not be loaded.", 503);
		return row ? jsonResponse({ article: articleView(row) }, 200) : accountError("Article not found.", 404);
	}
	if (request.method !== "POST" && request.method !== "PUT") return accountError("Method not allowed.", 405);
	if (!validOrigin(request)) return accountError("This origin cannot change articles.", 403);
	const account = await currentAccount(request, env);
	if (!hasRole(account, "publisher")) return accountError("Article publishing access is required.", account ? 403 : 401);
	const parsed = await readJsonRequest(request, MAX_ARTICLE_REQUEST_BYTES);
	if (parsed.error) return accountError(parsed.error, parsed.status);
	const fields = readArticleFields(parsed.value);
	if (fields.error) return accountError(fields.error, 400);
	const clean = fields.value;

	if (request.method === "POST") {
		if (id) return accountError("Method not allowed.", 405);
		const slug = parsed.value.id;
		if (typeof slug !== "string" || !POST_ID_PATTERN.test(slug)) return accountError("Use a slug of lowercase letters, numbers and hyphens.", 400);
		if ((await readCatalog(env)).some(function (post) { return post.id === slug; })) return accountError("A post already uses that slug.", 409);
		const now = new Date().toISOString();
		try {
			await env.DB.prepare(
				"INSERT INTO articles (id, title, description, category, tags_json, image, image_alt, body_html, css, published_at, updated_at, author_id) " +
				"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
			).bind(slug, clean.title, clean.description, clean.category, JSON.stringify(clean.tags), clean.image, clean.imageAlt, clean.bodyHtml, clean.css, now, now, account.id).run();
		} catch (error) {
			if (String(error.message).includes("UNIQUE")) return accountError("A post already uses that slug.", 409);
			throw error;
		}
		return jsonResponse({ post: articleCatalogItem({
			id: slug, title: clean.title, description: clean.description, category: clean.category, tags_json: JSON.stringify(clean.tags),
			image: clean.image, image_alt: clean.imageAlt, published_at: now, author_id: account.id
		}) }, 201);
	}

	if (!id) return accountError("Method not allowed.", 405);
	const existing = await env.DB.prepare("SELECT id, author_id, published_at FROM articles WHERE id = ?").bind(id).first();
	if (!existing) return accountError("Article not found.", 404);
	if (existing.author_id !== account.id && !hasRole(account, "editor")) return accountError("You can only edit articles you published.", 403);
	await env.DB.prepare(
		"UPDATE articles SET title = ?, description = ?, category = ?, tags_json = ?, image = ?, image_alt = ?, body_html = ?, css = ?, updated_at = ? WHERE id = ?"
	).bind(clean.title, clean.description, clean.category, JSON.stringify(clean.tags), clean.image, clean.imageAlt, clean.bodyHtml, clean.css, new Date().toISOString(), id).run();
	return jsonResponse({ post: articleCatalogItem({
		id: id, title: clean.title, description: clean.description, category: clean.category, tags_json: JSON.stringify(clean.tags),
		image: clean.image, image_alt: clean.imageAlt, published_at: existing.published_at, author_id: existing.author_id
	}) }, 200);
}

/* ------------------------------------------------------------------ picture uploads (R2) */

function imageKind(bytes) {
	if (bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: "image/png", ext: "png" };
	if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
	if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return { type: "image/gif", ext: "gif" };
	if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
		bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { type: "image/webp", ext: "webp" };
	return null;
}

async function readBytes(request, maxBytes) {
	const tooLarge = { error: "That picture is too large (6 MB at most).", status: 413 };
	const length = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(length) && length > maxBytes) return tooLarge;
	if (!request.body) return { error: "A picture is required.", status: 400 };
	const reader = request.body.getReader();
	const chunks = [];
	let total = 0;
	for (;;) {
		const part = await reader.read();
		if (part.done) break;
		total += part.value.byteLength;
		if (total > maxBytes) { await reader.cancel(); return tooLarge; }
		chunks.push(part.value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return { bytes: bytes };
}

async function uploadsApi(request, env, path) {
	if (!env.UPLOADS) return accountError("Picture storage is not set up on the server.", 503);

	if (path === "/api/uploads" && request.method === "POST") {
		if (!validOrigin(request)) return accountError("This origin cannot upload pictures.", 403);
		const account = await currentAccount(request, env);
		if (!hasRole(account, "publisher")) return accountError("Picture upload access is required.", account ? 403 : 401);
		const read = await readBytes(request, MAX_UPLOAD_BYTES);
		if (read.error) return accountError(read.error, read.status);
		const kind = imageKind(read.bytes);
		if (!kind) return accountError("Upload a PNG, JPEG, GIF or WebP picture.", 415);
		const when = new Date();
		const key = "img/" + when.getUTCFullYear() + "/" + String(when.getUTCMonth() + 1).padStart(2, "0") + "/" + crypto.randomUUID() + "." + kind.ext;
		await env.UPLOADS.put(key, read.bytes, { httpMetadata: { contentType: kind.type }, customMetadata: { uploader: account.id } });
		return jsonResponse({ url: "/api/uploads/" + key }, 201);
	}

	if (path.indexOf("/api/uploads/") === 0 && (request.method === "GET" || request.method === "HEAD")) {
		const key = path.slice("/api/uploads/".length);
		if (!UPLOAD_KEY_PATTERN.test(key)) return accountError("Not found.", 404);
		const object = await env.UPLOADS.get(key);
		if (!object) return accountError("Not found.", 404);
		const headers = new Headers();
		headers.set("Content-Type", (object.httpMetadata && object.httpMetadata.contentType) || "application/octet-stream");
		headers.set("Cache-Control", "public, max-age=31536000, immutable");
		headers.set("X-Content-Type-Options", "nosniff");
		headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
		return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers: headers });
	}
	return path === "/api/uploads" ? accountError("Method not allowed.", 405) : accountError("Not found.", 404);
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const origin = request.headers.get("Origin");
		let response;

		try {
		if (request.method === "OPTIONS") {
			response = new Response(null, { status: 204 });
		} else if (url.pathname === "/api/blog-feed/thread" && request.method === "PATCH") {
			response = await threadApi(request, env);
		} else if (url.pathname === "/api/content") {
			response = await contentApi(request, env);
		} else if (url.pathname === "/api/custom") {
			response = await customApi(request, env);
		} else if (url.pathname === "/api/articles" || url.pathname.startsWith("/api/articles/")) {
			response = await articlesApi(request, env, url.pathname);
		} else if (url.pathname === "/api/uploads" || url.pathname.startsWith("/api/uploads/")) {
			response = await uploadsApi(request, env, url.pathname);
		} else if (url.pathname === "/api/blog-feed" && origin && !ALLOWED_ORIGINS.includes(origin)) {
			response = jsonResponse({ error: "This origin cannot access the comment service." }, 403);
		} else if (url.pathname === "/api/blog-feed" && request.method === "GET") {
			response = await listComments(request, env);
		} else if (url.pathname === "/api/blog-feed" && request.method === "POST") {
			response = await createComment(request, env);
		} else if (url.pathname === "/api/blog-feed/reactions" && request.method === "POST") {
			response = await setCommentReaction(request, env);
		} else if (url.pathname.startsWith("/api/blog-feed/comments/") && url.pathname.endsWith("/pin") && request.method === "PATCH") {
			const match = url.pathname.match(/^\/api\/blog-feed\/comments\/([0-9a-f-]+)\/pin$/);
			response = match ? await pinComment(request, env, match[1]) : jsonResponse({ error: "Not found." }, 404);
		} else if (url.pathname.startsWith("/api/accounts/")) {
			response = await accountApi(request, env, url.pathname);
		} else if (url.pathname === "/api/posts" || url.pathname.startsWith("/api/posts/")) {
			response = await postsApi(request, env, url.pathname);
		} else {
			response = jsonResponse({ error: "Not found." }, 404);
		}
		} catch (error) {
			console.error("blog-feed: unhandled error on " + request.method + " " + url.pathname, error);
			response = jsonResponse({ error: "Something went wrong on the server. Try again shortly." }, 500);
		}

		return addCorsHeaders(request, response);
	}
};
