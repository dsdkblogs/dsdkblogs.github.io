/* Site index search: a retro "wiki index" overlay that searches everything the site knows about
   (site pages + every post in blog-posts.json) entirely in the browser. No backend needed.
   Adds its own header button on every page. Shortcut: "/" opens, Esc closes. */
(function () {
	var D = window.DSDK;
	if (!D) return;
	var t = D.t;

	var tools = document.querySelector('.header-tools');
	var entries = [];       /* every searchable thing */
	var feedOk = true;
	var state = { query: '', letter: '' };
	var opener = null;
	var bodyPaddingBeforeIndex = '';

	/* ---------- index data ---------- */
	var PAGES = [
		{ id: 'home', title: 'nav.home', desc: 'idx.home', hash: '', tags: ['start', 'welcome'] },
		{ id: 'latest', title: 'nav.latest', desc: 'idx.latest', hash: '#latest', tags: ['posts', 'filters'] },
		{ id: 'topics', title: 'nav.topics', desc: 'idx.topics', hash: '#topics', tags: ['tags', 'categories'] },
		{ id: 'about', title: 'nav.about', desc: 'idx.about', hash: '#about', tags: ['dakota', 'kaelyn'] },
		{ id: 'join', title: 'nav.join', desc: 'idx.join', hash: '#conversation', tags: ['comments', 'chat'] },
		{ id: 'recs', title: 'nav.recs', desc: 'idx.recs', file: 'recommendations.html', tags: ['padlet', 'favorites', 'recommendations'] },
		{ id: 'donate', title: 'nav.donate', desc: 'idx.donate', file: 'donate.html', tags: ['ko-fi', 'support', 'tip', 'donation'] },
		{ id: 'contact', title: 'nav.contact', desc: 'idx.contact', file: 'contact.html', tags: ['email', 'commission', 'website', 'questions'] }
	];

	function lower(text) { return String(text || '').toLocaleLowerCase(); }

	function buildEntries(posts) {
		var list = PAGES.map(function (page) {
			return { kind: 'page', page: page, href: D.root + (page.file || 'index.html') + (page.hash || ''), tags: page.tags, date: '' };
		});
		posts.forEach(function (post) {
			list.push({ kind: 'post', post: post, href: D.postUrl(post), tags: post.tags, date: post.publishedAt });
		});
		return list;
	}
	function titleOf(entry) { return entry.kind === 'page' ? t(entry.page.title) : entry.post.title; }
	function descOf(entry) { return entry.kind === 'page' ? t(entry.page.desc) : entry.post.description; }
	function extraOf(entry) {
		if (entry.kind === 'page') return entry.tags.join(' ');
		var p = entry.post;
		return [p.type, p.category, String(new Date(p.publishedAt).getFullYear())].concat(p.tags).join(' ');
	}
	function sortKey(entry) { return lower(titleOf(entry)).replace(/^(the|a|an|el|la|los|las|un|una)\s+/, ''); }
	function firstLetter(entry) {
		var ch = sortKey(entry).charAt(0).toLocaleUpperCase();
		var base = ch.normalize('NFD').charAt(0);
		return /[A-Z]/.test(base) ? base : '#';
	}

	function score(entry, terms) {
		var title = lower(titleOf(entry)), desc = lower(descOf(entry)), extra = lower(extraOf(entry));
		var total = 0;
		for (var i = 0; i < terms.length; i++) {
			var hit = 0;
			if (title.indexOf(terms[i]) !== -1) hit += 4;
			if (desc.indexOf(terms[i]) !== -1) hit += 2;
			if (extra.indexOf(terms[i]) !== -1) hit += 1;
			if (!hit) return 0;          /* every word must match somewhere */
			total += hit;
		}
		return total;
	}

	function search() {
		var terms = lower(state.query).split(/\s+/).filter(Boolean);
		var list = entries.map(function (entry) { return { entry: entry, score: terms.length ? score(entry, terms) : 1 }; });
		list = list.filter(function (r) { return r.score > 0; });
		if (state.letter) list = list.filter(function (r) { return firstLetter(r.entry) === state.letter; });
		list.sort(function (a, b) {
			return (terms.length ? b.score - a.score : 0) || sortKey(a.entry).localeCompare(sortKey(b.entry));
		});
		return { terms: terms, list: list };
	}

	/* ---------- DOM ---------- */
	var dlg, input, meta, azBox, listEl, foot;

	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}

	/* wraps matched words in <mark> using DOM nodes only (no innerHTML) */
	function highlight(parent, text, terms) {
		if (!terms.length) { parent.appendChild(document.createTextNode(text)); return; }
		var low = lower(text);
		var spans = [];
		terms.forEach(function (term) {
			var from = 0, at;
			while ((at = low.indexOf(term, from)) !== -1) { spans.push([at, at + term.length]); from = at + term.length; }
		});
		spans.sort(function (a, b) { return a[0] - b[0]; });
		var pos = 0;
		spans.forEach(function (span) {
			if (span[1] <= pos) return;
			var start = Math.max(span[0], pos);
			if (start > pos) parent.appendChild(document.createTextNode(text.slice(pos, start)));
			parent.appendChild(el('mark', '', text.slice(start, span[1])));
			pos = span[1];
		});
		if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)));
	}

	function build() {
		dlg = el('div', 'idx');
		dlg.id = 'site-index';
		dlg.hidden = true;
		dlg.setAttribute('role', 'dialog');
		dlg.setAttribute('aria-modal', 'true');
		dlg.setAttribute('aria-labelledby', 'idx-title');

		var win = el('div', 'idx__win');
		var bar = el('div', 'idx__bar');
		var title = el('h2', 'idx__title');
		title.id = 'idx-title';
		title.setAttribute('data-i18n', 'idx.title');
		var close = el('button', 'idx__close');
		close.type = 'button';
		close.setAttribute('data-i18n-aria', 'idx.close');
		close.textContent = '[X]';
		close.addEventListener('click', closeIndex);
		bar.appendChild(title); bar.appendChild(close);

		var form = el('form', 'idx__form');
		form.setAttribute('role', 'search');
		var label = el('label', 'idx__label');
		label.setAttribute('for', 'idx-input');
		label.setAttribute('data-i18n', 'idx.label');
		input = el('input', 'idx__input');
		input.id = 'idx-input'; input.type = 'search'; input.autocomplete = 'off';
		input.setAttribute('data-i18n-placeholder', 'idx.placeholder');
		var go = el('button', 'idx__go');
		go.type = 'submit';
		go.setAttribute('data-i18n', 'idx.go');
		form.appendChild(label); form.appendChild(input); form.appendChild(go);
		form.addEventListener('submit', function (event) { event.preventDefault(); });
		input.addEventListener('input', function () { state.query = input.value; render(); });

		meta = el('p', 'idx__meta');
		meta.setAttribute('role', 'status');
		meta.setAttribute('aria-live', 'polite');
		azBox = el('div', 'idx__az');
		azBox.setAttribute('role', 'group');
		azBox.setAttribute('data-i18n-aria', 'idx.az');
		listEl = el('ol', 'idx__list');
		foot = el('p', 'idx__foot');

		win.appendChild(bar); win.appendChild(form); win.appendChild(meta);
		win.appendChild(azBox); win.appendChild(listEl); win.appendChild(foot);
		dlg.appendChild(win);
		document.body.appendChild(dlg);

		dlg.addEventListener('mousedown', function (event) { if (event.target === dlg) closeIndex(); });
		dlg.addEventListener('keydown', function (event) {
			if (event.key === 'Escape') { event.preventDefault(); closeIndex(); return; }
			if (event.key !== 'Tab') return;
			var items = [].filter.call(dlg.querySelectorAll('a[href], button, input'), function (n) { return !n.disabled && n.offsetParent !== null; });
			if (!items.length) return;
			var first = items[0], last = items[items.length - 1];
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		});
		D.onLang(function () { if (!dlg.hidden) render(); });
	}

	function renderAz() {
		azBox.replaceChildren();
		var present = {};
		entries.forEach(function (entry) { present[firstLetter(entry)] = true; });
		var all = el('button', 'idx__letter', t('idx.allLetters'));
		all.type = 'button';
		all.setAttribute('aria-pressed', state.letter ? 'false' : 'true');
		all.addEventListener('click', function () { state.letter = ''; render(); });
		azBox.appendChild(all);
		'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').forEach(function (letter) {
			var b = el('button', 'idx__letter', letter);
			b.type = 'button';
			b.disabled = !present[letter];
			b.setAttribute('aria-pressed', state.letter === letter ? 'true' : 'false');
			b.addEventListener('click', function () { state.letter = state.letter === letter ? '' : letter; render(); });
			azBox.appendChild(b);
		});
	}

	function render() {
		var res = search();
		renderAz();

		var q = state.query.trim();
		if (!res.list.length) meta.textContent = t('idx.none');
		else if (q) meta.textContent = t('idx.found', { n: res.list.length, total: entries.length, q: q });
		else if (state.letter) meta.textContent = t('idx.letter', { l: state.letter, n: res.list.length });
		else meta.textContent = t('idx.all', { n: res.list.length });
		if (!feedOk) meta.textContent += ' ' + t('idx.offline');
		foot.textContent = t('idx.foot', { n: entries.length });

		listEl.replaceChildren();
		res.list.forEach(function (r) {
			var entry = r.entry;
			var li = el('li', 'idx__item');
			var head = el('div', 'idx__head');
			var link = el('a', 'idx__link');
			link.href = entry.href;
			highlight(link, titleOf(entry), res.terms);
			link.addEventListener('click', function () { var u = new URL(entry.href, location.href); if (u.pathname === location.pathname && u.hash) closeIndex(); });
			var kind = el('span', 'idx__kind', '[' + t(entry.kind === 'post' ? 'idx.kindPost' : 'idx.kindPage') + ']');
			head.appendChild(link); head.appendChild(kind);
			if (entry.date) {
				var time = el('time', 'idx__date', D.formatDate(entry.date));
				time.dateTime = entry.date;
				head.appendChild(time);
			}
			var desc = el('p', 'idx__desc');
			highlight(desc, descOf(entry), res.terms);
			li.appendChild(head); li.appendChild(desc);

			if (entry.tags && entry.tags.length) {
				var see = el('p', 'idx__see');
				see.appendChild(el('span', '', t('idx.seeAlso') + ' '));
				entry.tags.forEach(function (tag, i) {
					var b = el('button', 'idx__tag', tag);
					b.type = 'button';
					b.addEventListener('click', function () { state.query = tag; state.letter = ''; input.value = tag; render(); input.focus(); });
					see.appendChild(b);
					if (i < entry.tags.length - 1) see.appendChild(document.createTextNode(', '));
				});
				li.appendChild(see);
			}
			listEl.appendChild(li);
		});
	}

	/* ---------- open / close ---------- */
	function openIndex(from) {
		if (!dlg) build();
		opener = from || document.activeElement;
		bodyPaddingBeforeIndex = document.body.style.paddingRight;
		var scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
		if (scrollbarWidth > 0) {
			var currentPadding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
			document.body.style.paddingRight = currentPadding + scrollbarWidth + 'px';
		}
		dlg.hidden = false;
		document.documentElement.classList.add('idx-open');
		[].forEach.call(document.querySelectorAll('[data-idx-toggle]'), function (b) { b.setAttribute('aria-expanded', 'true'); });
		/* (re)load the posts each time so the index never goes stale */
		render();
		D.loadFeed().then(function (posts) { feedOk = true; entries = buildEntries(posts); }, function () { feedOk = false; entries = buildEntries([]); })
			.then(function () { if (!dlg.hidden) render(); });
		localizeStatic();
		input.focus();
	}
	function closeIndex() {
		if (!dlg || dlg.hidden) return;
		dlg.hidden = true;
		document.documentElement.classList.remove('idx-open');
		document.body.style.paddingRight = bodyPaddingBeforeIndex;
		[].forEach.call(document.querySelectorAll('[data-idx-toggle]'), function (b) { b.setAttribute('aria-expanded', 'false'); });
		if (opener && opener.focus) opener.focus();
	}
	/* the overlay is created after the first language pass, so fill its labelled bits once */
	function localizeStatic() {
		[].forEach.call(dlg.querySelectorAll('[data-i18n]'), function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
		[].forEach.call(dlg.querySelectorAll('[data-i18n-placeholder]'), function (n) { n.setAttribute('placeholder', t(n.getAttribute('data-i18n-placeholder'))); });
		[].forEach.call(dlg.querySelectorAll('[data-i18n-aria]'), function (n) { n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria'))); });
	}

	/* ---------- header button ---------- */
	if (tools) {
		var btn = el('button', 'icon-btn');
		btn.type = 'button';
		btn.id = 'search-toggle';
		btn.setAttribute('data-idx-toggle', '');
		btn.setAttribute('aria-haspopup', 'dialog');
		btn.setAttribute('aria-expanded', 'false');
		btn.setAttribute('aria-controls', 'site-index');
		btn.setAttribute('data-i18n-aria', 'search.open');
		btn.setAttribute('aria-label', t('search.open'));
		btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';
		btn.addEventListener('click', function () { if (dlg && !dlg.hidden) closeIndex(); else openIndex(btn); });
		tools.insertBefore(btn, tools.firstChild);
	}

	document.addEventListener('keydown', function (event) {
		if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
		var tag = (event.target && event.target.tagName) || '';
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (event.target && event.target.isContentEditable)) return;
		event.preventDefault();
		openIndex(document.activeElement);
	});

	window.DSDK.openSearch = function () { openIndex(document.activeElement); };
})();
