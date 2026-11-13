/* Allow-list sanitizer used for every piece of author-written HTML / CSS shown on the site
   (articles, Page lab custom pages, previews). Nothing here executes script.
   The Worker must ALSO validate before saving; this file is the browser-side safety net.

   DSDK.sanitizeHtml(html, { allowStyle: true })  -> { html, removed: [ 'what was stripped', ... ] }
   DSDK.sanitizeCss(css)                          -> { css, removed: [...] }
   DSDK.scopeCss(css, '.article-body')            -> css with every selector limited to that scope
   DSDK.youtubeEmbed(urlOrId)                     -> embed URL or ''                                   */
(function () {
	var D = window.DSDK;
	if (!D) return;

	var ALLOWED = ('a abbr aside article b blockquote br caption cite code col colgroup dd del details div dl dt em figcaption figure ' +
		'h1 h2 h3 h4 h5 h6 hr i iframe img ins kbd li mark ol p pre q s section small source span strong sub summary sup table tbody td tfoot ' +
		'th thead time tr u ul video').split(' ');
	var DROP = ('script style noscript template object embed applet link meta base form input button select textarea svg math title head ' +
		'frame frameset canvas audio').split(' ');
	var ALLOW_SET = {}; ALLOWED.forEach(function (n) { ALLOW_SET[n] = true; });
	var DROP_SET = {}; DROP.forEach(function (n) { DROP_SET[n] = true; });

	var STYLE_PROPS = ('color background background-color background-image background-size background-position background-repeat ' +
		'font font-family font-size font-style font-weight line-height letter-spacing text-align text-decoration text-transform text-indent ' +
		'white-space word-break margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left ' +
		'border border-top border-right border-bottom border-left border-color border-width border-style border-radius box-shadow opacity ' +
		'width max-width min-width height max-height min-height display gap row-gap column-gap flex flex-direction flex-wrap flex-grow flex-shrink flex-basis ' +
		'justify-content align-items align-self align-content grid grid-template-columns grid-template-rows grid-column grid-row ' +
		'float clear overflow object-fit object-position aspect-ratio vertical-align list-style columns text-shadow').split(' ');
	var STYLE_OK = {}; STYLE_PROPS.forEach(function (n) { STYLE_OK[n] = true; });

	function uniq(list) {
		var seen = {}, out = [];
		list.forEach(function (item) { if (!seen[item]) { seen[item] = 1; out.push(item); } });
		return out;
	}

	/* ---------- URLs ---------- */
	function safeUrl(value, kind) {
		var v = String(value || '').trim();
		if (!v) return '';
		if (v.charAt(0) === '#') return kind === 'link' ? v : '';
		if (kind === 'image' && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(v) && v.length < 400000) return v;
		var url;
		try { url = new URL(v, 'https://relative.invalid/'); } catch (e) { return ''; }
		if (url.protocol === 'https:') return v;
		if (kind === 'link' && (url.protocol === 'mailto:' || url.protocol === 'tel:' || url.protocol === 'http:')) return v;
		return '';
	}

	function youtubeId(value) {
		var v = String(value || '').trim();
		if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
		try {
			var url = new URL(v);
			var host = url.hostname.replace(/^www\./, '');
			if (host === 'youtu.be') { var a = url.pathname.slice(1).split('/')[0]; return /^[A-Za-z0-9_-]{11}$/.test(a) ? a : ''; }
			if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
				var id = url.searchParams.get('v');
				if (!id) {
					var m = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
					id = m ? m[1] : '';
				}
				return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : '';
			}
		} catch (e) {}
		return '';
	}
	function youtubeEmbed(value) {
		var id = youtubeId(value);
		return id ? 'https://www.youtube-nocookie.com/embed/' + id : '';
	}
	function iframeSrcOk(value) {
		try {
			var url = new URL(value);
			if (url.protocol !== 'https:') return '';
			if ((url.hostname === 'www.youtube-nocookie.com' || url.hostname === 'www.youtube.com') && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) {
				return 'https://www.youtube-nocookie.com' + url.pathname;
			}
			if (url.hostname === 'player.vimeo.com' && /^\/video\/\d+$/.test(url.pathname)) return url.origin + url.pathname;
		} catch (e) {}
		return '';
	}

	/* ---------- inline style attribute ---------- */
	function cleanStyle(value, removed) {
		var out = [];
		String(value || '').split(';').forEach(function (decl) {
			var at = decl.indexOf(':');
			if (at < 1) return;
			var prop = decl.slice(0, at).trim().toLowerCase();
			var val = decl.slice(at + 1).trim();
			if (!STYLE_OK[prop]) { removed.push('style property "' + prop + '"'); return; }
			if (/url\s*\(|expression|javascript:|@import|behavior|binding|\\/i.test(val)) { removed.push('unsafe value in style "' + prop + '"'); return; }
			out.push(prop + ': ' + val);
		});
		return out.join('; ');
	}

	/* ---------- attributes ---------- */
	var CLASS_RE = /^[A-Za-z0-9_\- ]{1,200}$/;
	var ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;

	function cleanAttributes(el, tag, opts, removed) {
		[].slice.call(el.attributes).forEach(function (attr) {
			var name = attr.name.toLowerCase();
			var val = attr.value;
			var keep = false;
			var next = val;

			if (name === 'class') keep = CLASS_RE.test(val);
			else if (name === 'id') keep = ID_RE.test(val) && !document.getElementById(val);
			else if (name === 'title' || name === 'lang' || name === 'dir') keep = val.length < 300;
			else if (name === 'aria-label' || name === 'aria-hidden' || name === 'aria-describedby') keep = val.length < 300;
			else if (name === 'style') { next = opts.allowStyle === false ? '' : cleanStyle(val, removed); keep = Boolean(next); }
			else if (tag === 'a' && name === 'href') { next = safeUrl(val, 'link'); keep = Boolean(next); }
			else if (tag === 'a' && name === 'target') keep = val === '_blank';
			else if (tag === 'a' && name === 'rel') keep = false;
			else if (tag === 'img' && name === 'src') { next = safeUrl(val, 'image'); keep = Boolean(next); }
			else if (tag === 'img' && (name === 'alt' || name === 'width' || name === 'height')) keep = val.length < 300;
			else if (tag === 'img' && name === 'loading') keep = val === 'lazy' || val === 'eager';
			else if (tag === 'video' && name === 'src') { next = safeUrl(val, 'media'); keep = Boolean(next); }
			else if (tag === 'video' && name === 'poster') { next = safeUrl(val, 'image'); keep = Boolean(next); }
			else if (tag === 'video' && /^(controls|loop|muted|playsinline|preload|width|height)$/.test(name)) keep = true;
			else if (tag === 'source' && name === 'src') { next = safeUrl(val, 'media'); keep = Boolean(next); }
			else if (tag === 'source' && name === 'type') keep = /^video\/[a-z0-9.+-]+$/i.test(val);
			else if (tag === 'iframe' && name === 'src') { next = iframeSrcOk(val); keep = Boolean(next); }
			else if (tag === 'iframe' && (name === 'title' || name === 'width' || name === 'height' || name === 'allowfullscreen' || name === 'loading')) keep = true;
			else if ((tag === 'td' || tag === 'th') && (name === 'colspan' || name === 'rowspan')) keep = /^\d{1,2}$/.test(val);
			else if (tag === 'ol' && (name === 'start' || name === 'type')) keep = val.length < 8;
			else if (tag === 'time' && name === 'datetime') keep = val.length < 40;
			else if (tag === 'details' && name === 'open') keep = true;

			if (keep) { if (next !== val) el.setAttribute(attr.name, next); }
			else {
				el.removeAttribute(attr.name);
				if (/^on/.test(name)) removed.push('event handler "' + name + '"');
				else if (name !== 'rel' && name !== 'style') removed.push('attribute "' + name + '" on <' + tag + '>');
			}
		});

		if (tag === 'a') {
			if (el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer');
		}
		if (tag === 'iframe') {
			if (!el.getAttribute('src')) return false;
			el.setAttribute('allow', 'accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share');
			el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
			el.setAttribute('allowfullscreen', '');
			if (!el.getAttribute('title')) el.setAttribute('title', 'Embedded video');
			el.setAttribute('loading', 'lazy');
		}
		if (tag === 'video') {
			if (!el.getAttribute('src') && !el.querySelector('source')) return false;
			if (!el.hasAttribute('preload')) el.setAttribute('preload', 'metadata');
		}
		if (tag === 'img' && !el.getAttribute('src')) return false;
		return true;
	}

	function walk(parent, opts, removed) {
		[].slice.call(parent.childNodes).forEach(function (node) {
			if (node.nodeType === 3) return;
			if (node.nodeType !== 1) { parent.removeChild(node); return; }
			var tag = node.tagName.toLowerCase();
			if (DROP_SET[tag]) { removed.push('<' + tag + '> element'); parent.removeChild(node); return; }
			if (!ALLOW_SET[tag]) {
				removed.push('<' + tag + '> tag (kept its text)');
				walk(node, opts, removed);
				while (node.firstChild) parent.insertBefore(node.firstChild, node);
				parent.removeChild(node);
				return;
			}
			if (!cleanAttributes(node, tag, opts, removed)) {
				removed.push('<' + tag + '> without a valid source');
				parent.removeChild(node);
				return;
			}
			walk(node, opts, removed);
		});
	}

	function sanitizeHtml(html, opts) {
		opts = opts || {};
		var removed = [];
		var doc = new DOMParser().parseFromString('<!DOCTYPE html><html><body>' + String(html || '') + '</body></html>', 'text/html');
		walk(doc.body, opts, removed);
		return { html: doc.body.innerHTML, removed: uniq(removed) };
	}

	/* ---------- CSS ---------- */
	var MAX_CSS = 60000;
	function sanitizeCss(css) {
		var removed = [];
		var out = String(css || '');
		if (out.length > MAX_CSS) { out = out.slice(0, MAX_CSS); removed.push('CSS cut to ' + MAX_CSS + ' characters'); }
		out = out.replace(/<\/?\s*style[^>]*>/gi, function () { removed.push('<style> tag'); return ''; });
		out = out.replace(/@import[^;{]*;?/gi, function () { removed.push('@import'); return ''; });
		out = out.replace(/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding\s*:/gi, function (m) { removed.push('"' + m.trim() + '"'); return 'blocked'; });
		out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, function (match, quote, address) {
			var a = address.trim();
			var ok = /^https:\/\//i.test(a) || /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(a) ||
				(a && !/^[a-z][a-z0-9+.-]*:/i.test(a) && a.indexOf('\\') === -1 && a.indexOf('//') !== 0);
			if (ok) return match;
			removed.push('url() with an unsafe address');
			return 'url("")';
		});
		return { css: out, removed: uniq(removed) };
	}

	/* Prefixes every selector so author CSS can only affect its own container. */
	function scopeCss(css, scope) {
		var i = 0, n = css.length, out = '';

		function skipString(start) {
			var q = css.charAt(start), j = start + 1;
			while (j < n && css.charAt(j) !== q) { if (css.charAt(j) === '\\') j++; j++; }
			return j + 1;
		}
		function block(start) {                       /* start at '{' -> index after matching '}' */
			var depth = 0, j = start;
			while (j < n) {
				var c = css.charAt(j);
				if (c === '"' || c === "'") { j = skipString(j); continue; }
				if (c === '{') depth++;
				if (c === '}') { depth--; if (depth === 0) return j + 1; }
				j++;
			}
			return n;
		}
		function splitSelectors(text) {
			var parts = [], depth = 0, last = 0;
			for (var j = 0; j < text.length; j++) {
				var c = text.charAt(j);
				if (c === '(' || c === '[') depth++;
				else if (c === ')' || c === ']') depth--;
				else if (c === ',' && depth === 0) { parts.push(text.slice(last, j)); last = j + 1; }
			}
			parts.push(text.slice(last));
			return parts;
		}
		function scopeSelector(sel) {
			sel = sel.trim();
			if (!sel) return '';
			if (/^(html|body|:root)\b/i.test(sel)) return sel.replace(/^(html|body|:root)\b/i, scope);
			return scope + ' ' + sel;
		}
		function run(text) {
			var pos = 0, len = text.length, result = '';
			while (pos < len) {
				var open = text.indexOf('{', pos);
				if (open === -1) break;
				var prelude = text.slice(pos, open);
				var save = css, saveN = n;
				css = text; n = len;
				var end = block(open);
				var inner = text.slice(open + 1, end - 1);
				css = save; n = saveN;
				var head = prelude.trim();
				if (/^@(media|supports|container|layer)\b/i.test(head)) result += head + '{' + run(inner) + '}';
				else if (/^@/.test(head)) result += head + '{' + inner + '}';
				else result += splitSelectors(head).map(scopeSelector).filter(Boolean).join(',') + '{' + inner + '}';
				pos = end;
			}
			return result;
		}
		/* strip comments first so they cannot hide braces */
		return run(css.replace(/\/\*[\s\S]*?\*\//g, ''));
	}

	D.sanitizeHtml = sanitizeHtml;
	D.sanitizeCss = sanitizeCss;
	D.scopeCss = scopeCss;
	D.youtubeEmbed = youtubeEmbed;
	D.youtubeId = youtubeId;
	D.safeUrl = safeUrl;
})();
