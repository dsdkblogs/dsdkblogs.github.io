/* Page lab (editor.html), admin only.
   A small "Neocities / GitHub Pages" style editor: write HTML + CSS for any page, any post, or the whole site.
   - live preview in a sandboxed iframe (scripts can never run there or on the real page)
   - debug console lists everything the sanitizer removed, so nothing disappears silently
   - Publish -> PUT /api/custom (features.custom). Until then drafts live in this browser (localStorage).
   Targets: page:home | page:donate | page:recommendations | page:contact | post:<id> | site:global (CSS for every page) */
(function () {
	var D = window.DSDK;
	if (!D) return;
	var $ = function (id) { return document.getElementById(id); };
	var live = D.feature('custom');
	var KEY = function (target) { return 'dsdk.lab.' + target; };

	var els = {
		auth: $('lab-auth-status'), gate: $('lab-gate'), gateMsg: $('lab-gate-message'), app: $('lab-app'), banner: $('lab-banner'),
		target: $('lab-target'), mode: $('lab-mode'), snippet: $('lab-snippet'), enabled: $('lab-enabled'), open: $('lab-open'),
		html: $('lab-html'), css: $('lab-css'), htmlWrap: $('lab-html-wrap'), cssWrap: $('lab-css-wrap'), counts: $('lab-counts'),
		frame: $('lab-frame'), theme: $('lab-theme'), report: $('lab-report'), reportCount: $('lab-report-count'),
		status: $('lab-status'), statusMsg: $('lab-status-message'),
		draft: $('lab-draft'), publish: $('lab-publish'), publishLabel: $('lab-publish-label'), spinner: $('lab-spinner'), revert: $('lab-revert'), remove: $('lab-remove')
	};
	var PAGES = [
		['page:home', 'Home page', 'index.html'], ['page:donate', 'Donate page', 'donate.html'],
		['page:recommendations', 'Recommendations page', 'recommendations.html'], ['page:contact', 'Contact page', 'contact.html']
	];
	var SNIPPETS = {
		hero: '<section class="lab-hero">\n  <h2>A big, friendly headline</h2>\n  <p>One or two lines that tell people what this page is about.</p>\n  <a class="btn" href="index.html#latest">See the latest</a>\n</section>',
		columns: '<div class="lab-columns">\n  <div>\n    <h3>Left column</h3>\n    <p>Text goes here.</p>\n  </div>\n  <div>\n    <h3>Right column</h3>\n    <p>More text goes here.</p>\n  </div>\n</div>',
		callout: '<div class="callout">\n  <p><strong>Heads up!</strong> Something worth noticing.</p>\n</div>',
		image: '<figure class="fig fig--full">\n  <img src="https://" alt="Describe the picture">\n  <figcaption>Caption</figcaption>\n</figure>',
		youtube: '<figure class="embed">\n  <iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" title="Embedded video" allowfullscreen></iframe>\n</figure>',
		video: '<figure class="embed">\n  <video src="https://example.com/clip.mp4" controls preload="metadata"></video>\n</figure>',
		button: '<p><a class="btn" href="https://example.com">A button</a></p>'
	};
	var CSS_STARTER = '/* Your CSS for this target. Examples:\n\n.lab-hero { text-align: center; padding: 3rem 1rem; background: var(--accent-soft); border-radius: 1rem; }\n.lab-columns { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }\n*/\n';

	var current = { target: '', saved: null };
	var previewDark = false;
	var feedPosts = [];
	var timer = null;

	Object.keys(SNIPPETS).forEach(function (k) {
		var o = document.createElement('option');
		o.value = k;
		o.textContent = { hero: 'Hero banner', columns: 'Two columns', callout: 'Callout box', image: 'Picture with caption', youtube: 'YouTube video', video: 'Video file', button: 'Button' }[k];
		els.snippet.appendChild(o);
	});

	/* ---------------------------------------------------------------- code areas */
	function attachCode(wrap) {
		var area = wrap.querySelector('textarea');
		var nums = wrap.querySelector('.code__nums');
		function paint() {
			var n = area.value.split('\n').length, out = '';
			for (var i = 1; i <= n; i++) out += i + '\n';
			nums.textContent = out;
			nums.scrollTop = area.scrollTop;
		}
		area.addEventListener('input', paint);
		area.addEventListener('scroll', function () { nums.scrollTop = area.scrollTop; });
		area.addEventListener('keydown', function (event) {
			if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
				event.preventDefault();
				var s = area.selectionStart, e = area.selectionEnd;
				area.value = area.value.slice(0, s) + '  ' + area.value.slice(e);
				area.selectionStart = area.selectionEnd = s + 2;
				area.dispatchEvent(new Event('input'));
			}
		});
		area.__paint = paint;
		paint();
	}
	attachCode(els.htmlWrap);
	attachCode(els.cssWrap);

	[].forEach.call(document.querySelectorAll('.write-tabs [data-view]'), function (tab) {
		tab.addEventListener('click', function () {
			var v = tab.getAttribute('data-view');
			[].forEach.call(document.querySelectorAll('.write-tabs [data-view]'), function (t) {
				var on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
			});
			els.htmlWrap.hidden = v !== 'html';
			els.cssWrap.hidden = v !== 'css';
			(v === 'html' ? els.html : els.css).__paint();
			(v === 'html' ? els.html : els.css).focus();
		});
	});

	/* ---------------------------------------------------------------- preview + debug console */
	function say(message, kind) {
		els.status.hidden = !message;
		els.status.className = 'publish-status' + (kind ? ' is-' + kind : '');
		els.statusMsg.textContent = message || '';
	}
	function isGlobal() { return current.target === 'site:global'; }

	function render() {
		var html = isGlobal() ? { html: '', removed: [] } : D.sanitizeHtml(els.html.value, { allowStyle: true });
		var css = D.sanitizeCss(els.css.value);
		var notes = html.removed.concat(css.removed.map(function (r) { return 'CSS: ' + r; }));
		els.report.replaceChildren();
		if (!notes.length) {
			var ok = document.createElement('li');
			ok.className = 'is-ok';
			ok.textContent = 'Nothing was removed. Your code is clean.';
			els.report.appendChild(ok);
		}
		notes.forEach(function (n) { var li = document.createElement('li'); li.textContent = 'Removed ' + n; els.report.appendChild(li); });
		els.reportCount.textContent = notes.length ? '(' + notes.length + ' removed)' : '';
		els.counts.textContent = els.html.value.length + ' characters of HTML · ' + els.css.value.length + ' of CSS (CSS limit 60,000)';

		var base = new URL('./', location.href).href;
		var theme = previewDark ? ' data-theme="dark"' : '';
		var body = isGlobal()
			? '<main class="lab-sample"><section class="section"><div class="wrap"><h1>Sample heading</h1><p class="lead">This preview shows your site-wide CSS on sample content.</p><p><a class="btn" href="#">A button</a> <a class="btn btn--ghost" href="#">Another</a></p><article class="card"><div class="card__body"><h2 class="card__title">A sample card</h2><p class="card__excerpt">Cards, buttons and headings pick up your changes.</p></div></article></div></section></main>'
			: '<main class="custom-html">' + html.html + '</main>';
		els.frame.srcdoc = '<!DOCTYPE html><html' + theme + '><head><meta charset="utf-8"><base href="' + base + '" target="_blank">' +
			'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Nunito:wght@400;600;700&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap">' +
			'<link rel="stylesheet" href="assets/css/styles.css"><style>' + css.css.replace(/<\//g, '<\\/') + '</style></head><body>' + body + '</body></html>';
	}
	function schedule() { clearTimeout(timer); timer = setTimeout(render, 250); dirty(); }
	els.html.addEventListener('input', schedule);
	els.css.addEventListener('input', schedule);
	els.theme.addEventListener('click', function () {
		previewDark = !previewDark;
		els.theme.textContent = previewDark ? 'Light preview' : 'Dark preview';
		render();
	});
	els.snippet.addEventListener('change', function () {
		var code = SNIPPETS[els.snippet.value];
		if (!code) return;
		var area = els.html;
		var s = area.selectionStart || area.value.length;
		area.value = area.value.slice(0, s) + (s && area.value.charAt(s - 1) !== '\n' ? '\n' : '') + code + '\n' + area.value.slice(area.selectionEnd || s);
		els.snippet.value = '';
		area.__paint();
		schedule();
	});

	/* ---------------------------------------------------------------- loading / saving */
	function state() { return { html: els.html.value, css: els.css.value, mode: els.mode.value, enabled: els.enabled.checked }; }
	function same(a, b) { return a && b && a.html === b.html && a.css === b.css && a.mode === b.mode && a.enabled === b.enabled; }
	function dirty() { window.__labDirty = !same(state(), current.saved); }
	window.addEventListener('beforeunload', function (event) { if (window.__labDirty) { event.preventDefault(); event.returnValue = ''; } });

	function setState(data) {
		els.html.value = data.html || '';
		els.css.value = data.css || '';
		els.mode.value = data.mode || 'below';
		els.enabled.checked = data.enabled !== false;
		els.html.__paint(); els.css.__paint();
		var global = current.target === 'site:global';
		els.html.disabled = global; els.mode.disabled = global; els.snippet.disabled = global;
		if (global && !els.html.value) els.html.value = '';
		render();
	}
	function localDraft(target) { try { return JSON.parse(localStorage.getItem(KEY(target))); } catch (e) { return null; } }

	function pageUrl(target) {
		if (target === 'site:global') return 'index.html';
		if (target.indexOf('post:') === 0) return 'post.html?id=' + encodeURIComponent(target.slice(5));
		var p = PAGES.filter(function (x) { return x[0] === target; })[0];
		return p ? p[2] : 'index.html';
	}

	function load(target) {
		current = { target: target, saved: null };
		els.open.href = D.root + pageUrl(target);
		say('');
		var draft = localDraft(target);
		var starter = { html: '', css: target === 'site:global' ? '/* Site-wide CSS: applies to every public page. */\n' : CSS_STARTER, mode: 'below', enabled: true };
		var apply = function (server) {
			current.saved = server || starter;
			if (draft) { setState(draft); say('Restored your local draft for this target.', 'success'); }
			else setState(current.saved);
			dirty();
		};
		if (!live) { apply(null); return; }
		D.api('custom?target=' + encodeURIComponent(target)).then(function (payload) {
			apply(target === 'site:global' ? (payload.global || payload.custom || null) : payload.custom);
		}).catch(function (error) {
			if (!error.offline) say(error.message, 'error');
			apply(null);
		});
	}

	els.target.addEventListener('change', function () {
		if (window.__labDirty && !window.confirm('Switch targets? Unsaved edits to this one will stay only if you saved a draft.')) { els.target.value = current.target; return; }
		window.__labDirty = false;
		load(els.target.value);
	});
	[els.mode, els.enabled].forEach(function (n) { n.addEventListener('change', function () { render(); dirty(); }); });

	els.draft.addEventListener('click', function () {
		try { localStorage.setItem(KEY(current.target), JSON.stringify(state())); say('Draft saved in this browser.', 'success'); } catch (e) { say('This browser would not let the draft be saved.', 'error'); }
	});
	els.revert.addEventListener('click', function () {
		if (!window.confirm('Throw away your edits and go back to the last published version?')) return;
		try { localStorage.removeItem(KEY(current.target)); } catch (e) {}
		setState(current.saved || { html: '', css: '', mode: 'below', enabled: true });
		dirty();
		say('Reverted.');
	});

	function busy(on) { els.publish.disabled = on; els.remove.disabled = on; els.spinner.hidden = !on; }
	els.publish.addEventListener('click', function () {
		render();
		var data = state();
		var cleaned = isGlobal() ? { html: '' } : D.sanitizeHtml(data.html, { allowStyle: true });
		var css = D.sanitizeCss(data.css).css;
		try { localStorage.setItem(KEY(current.target), JSON.stringify(data)); } catch (e) {}
		if (!live) { say('Saved as a draft in this browser. Publishing switches on once the page-code backend is connected (features.custom in config.js).', 'success'); return; }
		busy(true);
		say('Publishing…');
		D.api('custom', { method: 'PUT', json: { target: current.target, html: cleaned.html, css: css, mode: data.mode, enabled: data.enabled } }).then(function () {
			try { localStorage.removeItem(KEY(current.target)); } catch (e) {}
			current.saved = data;
			dirty();
			say('Published. Open the page to see it.', 'success');
		}).catch(function (error) {
			say(error.offline ? 'The server has no page-code endpoint yet.' : error.message, 'error');
		}).then(function () { busy(false); });
	});
	els.remove.addEventListener('click', function () {
		if (!window.confirm('Remove all custom HTML and CSS for this target?')) return;
		try { localStorage.removeItem(KEY(current.target)); } catch (e) {}
		var blank = { html: '', css: '', mode: 'below', enabled: true };
		if (!live) { setState(blank); current.saved = blank; dirty(); say('Local draft cleared.', 'success'); return; }
		busy(true);
		D.api('custom?target=' + encodeURIComponent(current.target), { method: 'DELETE' }).then(function () {
			setState(blank); current.saved = blank; dirty(); say('Custom code removed.', 'success');
		}).catch(function (error) { say(error.message, 'error'); }).then(function () { busy(false); });
	});

	/* ---------------------------------------------------------------- start */
	function start() {
		els.auth.hidden = true;
		els.app.hidden = false;
		if (!live) {
			els.banner.hidden = false;
			els.banner.textContent = 'The page-code backend is not connected yet (features.custom in config.js). Everything here works as a local draft with a live preview; Publish turns on once the backend is deployed.';
		}
		function option(group, value, label) {
			var o = document.createElement('option'); o.value = value; o.textContent = label; group.appendChild(o);
		}
		var g1 = document.createElement('optgroup'); g1.label = 'Whole site';
		option(g1, 'site:global', 'Site-wide CSS (every page)');
		var g2 = document.createElement('optgroup'); g2.label = 'Pages';
		PAGES.forEach(function (p) { option(g2, p[0], p[1]); });
		els.target.appendChild(g1); els.target.appendChild(g2);

		var wanted = new URLSearchParams(location.search).get('target') || 'page:home';
		D.loadFeed().then(function (feed) { feedPosts = feed.posts || []; }, function () { feedPosts = []; }).then(function () {
			var g3 = document.createElement('optgroup'); g3.label = 'Posts';
			feedPosts.forEach(function (post) { option(g3, 'post:' + post.id, post.title); });
			if (feedPosts.length) els.target.appendChild(g3);
			if (wanted.indexOf('post:') === 0 && !els.target.querySelector('option[value="' + wanted.replace(/"/g, '') + '"]')) option(g3, wanted, 'Post: ' + wanted.slice(5)), els.target.appendChild(g3);
			if (!els.target.querySelector('option[value="' + wanted.replace(/"/g, '') + '"]')) wanted = 'page:home';
			els.target.value = wanted;
			load(wanted);
		});
	}

	D.me().then(function (account) {
		if (!account || !D.hasRole(account, 'admin')) {
			els.auth.hidden = true;
			els.gate.hidden = false;
			els.gateMsg.textContent = account ? 'The Page lab is for admin accounts.' : 'Sign in with an admin account to use the Page lab.';
			return;
		}
		start();
	});
})();
