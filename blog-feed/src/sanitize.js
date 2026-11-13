/* Server-side allow-list sanitizer for author-written HTML and CSS (articles, Page lab pages).
   Mirrors public/assets/js/sanitize.js, but works without a DOM: the input is tokenized and the output is
   REBUILT from allowed tags and attributes only, so nothing the author typed is ever passed through as-is.
   The browser sanitizes again when it renders; this is the copy that protects the database. */

const ALLOWED = new Set(("a abbr aside article b blockquote br caption cite code col colgroup dd del details div dl dt em figcaption figure " +
	"h1 h2 h3 h4 h5 h6 hr i iframe img ins kbd li mark ol p pre q s section small source span strong sub summary sup table tbody td tfoot " +
	"th thead time tr u ul video").split(" "));
const VOID = new Set(["br", "hr", "img", "col", "source"]);
/* dropped together with everything inside them */
const DROP = new Set(("script style noscript template object embed applet link meta base form input button select textarea svg math title head " +
	"frame frameset canvas audio xmp noembed noframes plaintext").split(" "));
const DROP_VOID = new Set(["link", "meta", "base", "input", "embed", "frame"]);
/* the browser reads their content as raw text, so it must be skipped as raw text */
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noembed", "noframes", "noscript", "iframe", "plaintext"]);

const STYLE_OK = new Set(("color background background-color background-image background-size background-position background-repeat " +
	"font font-family font-size font-style font-weight line-height letter-spacing text-align text-decoration text-transform text-indent " +
	"white-space word-break margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left " +
	"border border-top border-right border-bottom border-left border-color border-width border-style border-radius box-shadow opacity " +
	"width max-width min-width height max-height min-height display gap row-gap column-gap flex flex-direction flex-wrap flex-grow flex-shrink flex-basis " +
	"justify-content align-items align-self align-content grid grid-template-columns grid-template-rows grid-column grid-row " +
	"float clear overflow object-fit object-position aspect-ratio vertical-align list-style columns text-shadow").split(" "));

const CLASS_RE = /^[A-Za-z0-9_\- ]{1,200}$/;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const MAX_DEPTH = 100;
const MAX_ATTRS = 40;
export const MAX_CSS = 60000;

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", tab: "\t", newline: "\n", colon: ":", lpar: "(", rpar: ")", sol: "/", bsol: "\\" };

function decodeEntities(value) {
	return value.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));?/g, function (match, dec, hex, name) {
		if (dec !== undefined || hex !== undefined) {
			const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
			if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
			return String.fromCodePoint(code);
		}
		return Object.prototype.hasOwnProperty.call(NAMED, name) && match.charAt(match.length - 1) === ";" ? NAMED[name] : match;
	});
}

function escapeAttr(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeText(value) {
	return value.replace(/&(?!(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeUrl(raw, kind) {
	const v = decodeEntities(String(raw || "")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
	if (!v || v.length > 2000) return "";
	if (v.charAt(0) === "#") return kind === "link" ? v : "";
	if (kind === "image" && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(v)) return v.length < 400000 ? v : "";
	if (v.indexOf("\\") !== -1) return "";
	let url;
	try { url = new URL(v, "https://relative.invalid/"); } catch { return ""; }
	if (url.protocol === "https:") return v;
	if (kind === "link" && (url.protocol === "mailto:" || url.protocol === "tel:" || url.protocol === "http:")) return v;
	return "";
}

function iframeSrc(raw) {
	try {
		const url = new URL(decodeEntities(String(raw || "")).trim());
		if (url.protocol !== "https:") return "";
		if ((url.hostname === "www.youtube-nocookie.com" || url.hostname === "www.youtube.com") && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) {
			return "https://www.youtube-nocookie.com" + url.pathname;
		}
		if (url.hostname === "player.vimeo.com" && /^\/video\/\d+$/.test(url.pathname)) return url.origin + url.pathname;
	} catch {}
	return "";
}

function cleanStyle(raw) {
	const out = [];
	decodeEntities(String(raw || "")).split(";").forEach(function (declaration) {
		const at = declaration.indexOf(":");
		if (at < 1) return;
		const prop = declaration.slice(0, at).trim().toLowerCase();
		const value = declaration.slice(at + 1).trim();
		if (!STYLE_OK.has(prop) || !value || value.length > 300) return;
		if (/url\s*\(|expression|javascript:|@import|behavior|binding|[\\<>]/i.test(value)) return;
		out.push(prop + ": " + value);
	});
	return out.join("; ");
}

/* returns the attribute string to emit, or null when the whole element must be dropped */
function buildAttributes(tag, attrs, allowStyle) {
	const seen = new Set();
	const kept = [];
	let target = "";
	let hasSrc = false;
	let iframeTitle = "";
	for (const pair of attrs) {
		const name = pair[0].toLowerCase();
		if (seen.has(name)) continue;
		seen.add(name);
		const value = decodeEntities(pair[1]);
		let next = null;
		if (name === "class") { if (CLASS_RE.test(value)) next = value; }
		else if (name === "id") { if (ID_RE.test(value)) next = value; }
		else if (name === "title" || name === "lang" || name === "dir" || name === "aria-label" || name === "aria-hidden" || name === "aria-describedby") {
			if (value.length < 300 && (name !== "dir" || /^(ltr|rtl|auto)$/i.test(value))) next = value;
			if (tag === "iframe" && name === "title" && next !== null) { iframeTitle = next; continue; }
		}
		else if (name === "style") { if (allowStyle) { const style = cleanStyle(pair[1]); if (style) next = style; } }
		else if (tag === "a" && name === "href") { const url = safeUrl(pair[1], "link"); if (url) next = url; }
		else if (tag === "a" && name === "target") { if (value === "_blank") target = "_blank"; continue; }
		else if (tag === "img" && name === "src") { const url = safeUrl(pair[1], "image"); if (url) { next = url; hasSrc = true; } }
		else if (tag === "img" && name === "alt") { if (value.length < 300) next = value; }
		else if ((tag === "img" || tag === "video" || tag === "iframe") && (name === "width" || name === "height")) { if (/^\d{1,4}%?$/.test(value)) next = value; }
		else if (tag === "img" && name === "loading") { if (value === "lazy" || value === "eager") next = value; }
		else if (tag === "video" && name === "src") { const url = safeUrl(pair[1], "media"); if (url) { next = url; hasSrc = true; } }
		else if (tag === "video" && name === "poster") { const url = safeUrl(pair[1], "image"); if (url) next = url; }
		else if (tag === "video" && /^(controls|loop|muted|playsinline)$/.test(name)) { kept.push(name); continue; }
		else if (tag === "video" && name === "preload") { if (/^(none|metadata|auto)$/.test(value)) next = value; }
		else if (tag === "source" && name === "src") { const url = safeUrl(pair[1], "media"); if (url) { next = url; hasSrc = true; } }
		else if (tag === "source" && name === "type") { if (/^video\/[a-z0-9.+-]+$/i.test(value)) next = value; }
		else if (tag === "iframe" && name === "src") { const url = iframeSrc(pair[1]); if (url) { next = url; hasSrc = true; } }
		else if ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan")) { if (/^\d{1,2}$/.test(value)) next = value; }
		else if (tag === "ol" && (name === "start" || name === "type")) { if (value.length < 8 && /^[0-9aAiI]*$/.test(value)) next = value; }
		else if (tag === "time" && name === "datetime") { if (value.length < 40) next = value; }
		else if (tag === "details" && name === "open") { kept.push("open"); continue; }
		if (next !== null) kept.push(name + '="' + escapeAttr(next) + '"');
	}
	if ((tag === "img" || tag === "source" || tag === "iframe") && !hasSrc) return null;
	if (tag === "a" && target) kept.push('target="_blank"', 'rel="noopener noreferrer"');
	if (tag === "iframe") {
		kept.push('title="' + escapeAttr(iframeTitle || "Embedded video") + '"',
			'allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share"',
			'referrerpolicy="strict-origin-when-cross-origin"', "allowfullscreen", 'loading="lazy"');
	}
	if (tag === "video" && !seen.has("preload")) kept.push('preload="metadata"');
	return kept.length ? " " + kept.join(" ") : "";
}

/* s[start] is "<" followed by a letter. Returns { name, attrs, end } (end = index after ">"), or null when the tag never closes. */
function parseStartTag(s, start) {
	const n = s.length;
	let i = start + 1;
	let name = "";
	while (i < n && !/[\s/>]/.test(s.charAt(i))) name += s.charAt(i++);
	const attrs = [];
	for (;;) {
		while (i < n && /[\s/]/.test(s.charAt(i))) i++;
		if (i >= n) return null;
		if (s.charAt(i) === ">") return { name: name.toLowerCase(), attrs: attrs, end: i + 1 };
		let attrName = "";
		while (i < n && !/[\s/>=]/.test(s.charAt(i))) attrName += s.charAt(i++);
		if (!attrName) { i++; continue; }
		while (i < n && /\s/.test(s.charAt(i))) i++;
		let value = "";
		if (s.charAt(i) === "=") {
			i++;
			while (i < n && /\s/.test(s.charAt(i))) i++;
			const quote = s.charAt(i);
			if (quote === '"' || quote === "'") {
				const close = s.indexOf(quote, i + 1);
				if (close === -1) return null;
				value = s.slice(i + 1, close);
				i = close + 1;
			} else {
				while (i < n && !/[\s>]/.test(s.charAt(i))) value += s.charAt(i++);
			}
		}
		if (attrs.length < MAX_ATTRS) attrs.push([attrName, value]);
	}
}

function skipRaw(s, from, name) {
	if (name === "plaintext") return s.length;
	const re = new RegExp("</" + name + "(?=[\\s/>])", "ig");
	re.lastIndex = from;
	const match = re.exec(s);
	if (!match) return s.length;
	const close = s.indexOf(">", match.index);
	return close === -1 ? s.length : close + 1;
}

export function sanitizeHtml(input, options) {
	const allowStyle = !options || options.allowStyle !== false;
	const s = String(input || "").replace(/\u0000/g, "");
	const n = s.length;
	const out = [];
	const stack = [];
	let skipName = "";
	let skipDepth = 0;
	let i = 0;

	while (i < n) {
		const lt = s.indexOf("<", i);
		if (lt === -1) { if (!skipName) out.push(escapeText(s.slice(i))); break; }
		if (lt > i && !skipName) out.push(escapeText(s.slice(i, lt)));
		i = lt;
		const next = s.charAt(i + 1);

		if (s.startsWith("<!--", i)) {
			const close = s.indexOf("-->", i + 4);
			i = close === -1 ? n : close + 3;
			continue;
		}
		if (next === "!" || next === "?") {
			const close = s.indexOf(">", i);
			i = close === -1 ? n : close + 1;
			continue;
		}
		if (next === "/" && /[A-Za-z]/.test(s.charAt(i + 2))) {
			const close = s.indexOf(">", i);
			const end = close === -1 ? n : close + 1;
			const name = s.slice(i + 2, close === -1 ? n : close).split(/[\s/]/)[0].toLowerCase();
			i = end;
			if (skipName) {
				if (name === skipName && --skipDepth === 0) skipName = "";
			} else if (ALLOWED.has(name) && !VOID.has(name)) {
				const at = stack.lastIndexOf(name);
				if (at !== -1) while (stack.length > at) out.push("</" + stack.pop() + ">");
			}
			continue;
		}
		if (!/[A-Za-z]/.test(next)) {
			if (!skipName) out.push("&lt;");
			i++;
			continue;
		}

		const tag = parseStartTag(s, i);
		if (!tag) break;
		i = tag.end;
		const name = tag.name;

		if (skipName) {
			if (name === skipName) skipDepth++;
			continue;
		}
		if (RAW.has(name)) {
			const rawEnd = skipRaw(s, i, name);
			if (name === "iframe" && ALLOWED.has("iframe") && stack.length < MAX_DEPTH) {
				const attrs = buildAttributes("iframe", tag.attrs, allowStyle);
				if (attrs !== null) out.push("<iframe" + attrs + "></iframe>");
			}
			i = rawEnd;
			continue;
		}
		if (DROP.has(name)) {
			if (!DROP_VOID.has(name)) { skipName = name; skipDepth = 1; }
			continue;
		}
		if (!ALLOWED.has(name)) continue;
		if (stack.length >= MAX_DEPTH) continue;
		const attrs = buildAttributes(name, tag.attrs, allowStyle);
		if (attrs === null) continue;
		out.push("<" + name + attrs + ">");
		if (!VOID.has(name)) stack.push(name);
	}
	while (stack.length) out.push("</" + stack.pop() + ">");
	return out.join("");
}

function stripOutsideStrings(css) {
	let out = "";
	let quote = "";
	for (let i = 0; i < css.length; i++) {
		const c = css.charAt(i);
		if (quote) {
			out += c;
			if (c === "\\") { out += css.charAt(i + 1); i++; }
			else if (c === quote) quote = "";
		} else if (c === '"' || c === "'") { quote = c; out += c; }
		else if (c === "\\") { /* CSS escapes outside strings can hide url()/expression(): drop the backslash */ }
		else out += c;
	}
	return out;
}

export function sanitizeCss(input) {
	let css = String(input || "").replace(/\u0000/g, "");
	if (css.length > MAX_CSS) css = css.slice(0, MAX_CSS);
	css = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
	css = stripOutsideStrings(css);
	css = css.replace(/<\/?\s*style[^>]*>/gi, "");
	css = css.replace(/[<>]/g, "");
	css = css.replace(/@(?:import|charset|namespace)[^;{]*;?/gi, "");
	css = css.replace(/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding\s*:/gi, "blocked");
	css = css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, function (match, quote, address) {
		const a = address.trim();
		const ok = /^https:\/\//i.test(a) || /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(a) ||
			(a && !/^[a-z][a-z0-9+.-]*:/i.test(a) && a.indexOf("\\") === -1 && a.indexOf("//") !== 0);
		return ok ? match : 'url("")';
	});
	/* a url( that the pattern above could not parse (unbalanced quotes, nested parens) is removed outright */
	css = css.replace(/url\s*\((?![^)]*\))/gi, 'url("")');
	return css;
}
