/* Article composer (write.html): a docs-style page editor for "static" article posts.
   - Write view (rich text) / HTML view / Page CSS view / Preview, all kept in sync and always passed through the sanitizer
   - images by URL or upload, YouTube or raw-video embeds, callout boxes, dividers, links, lists, quotes
   - drafts autosave in this browser; Publish talks to POST/PUT /api/articles (features.articles) when the backend is ready
   Needs a publisher, editor or admin account. */
(function () {
	var D = window.DSDK;
	if (!D) return;
	var $ = function (id) { return document.getElementById(id); };
	var DRAFT_KEY = 'dsdk.article.draft';
	var live = D.feature('articles');
	var params = new URLSearchParams(location.search);
	var editId = params.get('edit') || '';

	var els = {
		auth: $('write-auth-status'), gate: $('write-gate'), gateMsg: $('write-gate-message'), app: $('write-app'), banner: $('write-banner'),
		form: $('article-form'), title: $('a-title'), id: $('a-id'), category: $('a-category'), desc: $('a-desc'), tags: $('a-tags'),
		image: $('a-image'), imageAlt: $('a-image-alt'), imageFile: $('a-image-file'), imageUpload: $('a-image-upload'),
		rte: $('rte'), src: $('src'), css: $('css'), srcWrap: $('src-wrap'), cssWrap: $('css-wrap'), preview: $('preview'), toolbar: $('rte-toolbar'),
		console: $('write-console'), report: $('write-report'), reportCount: $('write-console-count'),
		status: $('write-status'), statusMsg: $('write-status-message'), statusLink: $('write-result-link'),
		publish: $('write-publish'), publishLabel: $('write-publish-label'), spinner: $('write-spinner'),
		saveDraft: $('write-save-draft'), discard: $('write-discard'), heading: $('write-heading'), block: $('rte-block')
	};
	var view = 'write';
	var slugTouched = false;
	var savedRange = null;
	var liveStyle = document.createElement('style');
	liveStyle.id = 'article-live-css';
	document.head.appendChild(liveStyle);

	/* ---------------------------------------------------------------- helpers */
	function slugify(text) { return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }
	function say(message, kind, link) {
		els.status.hidden = !message;
		els.status.className = 'publish-status' + (kind ? ' is-' + kind : '');
		els.statusMsg.textContent = message || '';
		if (link) { els.statusLink.hidden = false; els.statusLink.href = link; els.statusLink.textContent = 'View the article'; }
		else els.statusLink.hidden = true;
	}
	function currentHtml() {
		if (view === 'html') return els.src.value;
		return els.rte.innerHTML;
	}
	function clean() { return D.sanitizeHtml(currentHtml(), { allowStyle: true }); }
	function cleanCss() { return D.sanitizeCss(els.css.value); }
	function hasContent(html) {
		var box = document.createElement('div');
		box.innerHTML = html;
		return Boolean(box.textContent.trim() || box.querySelector('img,video,iframe,hr'));
	}

	/* ---------------------------------------------------------------- code areas */
	function attachCode(wrap) {
		var area = wrap.querySelector('textarea');
		var nums = wrap.querySelector('.code__nums');
		function paint() {
			var count = area.value.split('\n').length;
			var out = '';
			for (var i = 1; i <= count; i++) out += i + '\n';
			nums.textContent = out;
			nums.scrollTop = area.scrollTop;
		}
		area.addEventListener('input', paint);
		area.addEventListener('scroll', function () { nums.scrollTop = area.scrollTop; });
		area.addEventListener('keydown', function (event) {
			if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
				event.preventDefault();
				var start = area.selectionStart, end = area.selectionEnd;
				area.value = area.value.slice(0, start) + '  ' + area.value.slice(end);
				area.selectionStart = area.selectionEnd = start + 2;
				area.dispatchEvent(new Event('input'));
			}
		});
		area.__paint = paint;
		paint();
	}

	/* ---------------------------------------------------------------- views */
	function applyCssPreview() {
		liveStyle.textContent = D.scopeCss(cleanCss().css, '.article-body');
	}
	function lint() {
		var html = clean();
		var css = cleanCss();
		var notes = html.removed.concat(css.removed.map(function (r) { return 'CSS: ' + r; }));
		els.report.replaceChildren();
		notes.forEach(function (n) { var li = document.createElement('li'); li.textContent = 'Removed ' + n; els.report.appendChild(li); });
		els.console.hidden = !notes.length;
		els.reportCount.textContent = notes.length ? '(' + notes.length + ')' : '';
		return html;
	}
	function setView(next) {
		var html = currentHtml();
		var cleaned = D.sanitizeHtml(html, { allowStyle: true }).html;
		if (view === 'write' || view === 'html') {
			els.rte.innerHTML = cleaned;
			els.src.value = cleaned.replace(/></g, '>\n<');
			if (els.src.__paint) els.src.__paint();
		}
		view = next;
		[].forEach.call(document.querySelectorAll('.write-tabs [data-view]'), function (tab) {
			var on = tab.getAttribute('data-view') === next;
			tab.setAttribute('aria-selected', String(on));
			tab.tabIndex = on ? 0 : -1;
		});
		els.rte.hidden = next !== 'write';
		els.toolbar.hidden = next !== 'write';
		els.srcWrap.hidden = next !== 'html';
		els.cssWrap.hidden = next !== 'css';
		els.preview.hidden = next !== 'preview';
		if (next === 'html') els.src.focus();
		if (next === 'css') { els.css.focus(); els.css.__paint && els.css.__paint(); }
		if (next === 'preview') {
			els.preview.innerHTML = '';
			var box = document.createElement('div');
			box.innerHTML = '';
			var title = document.createElement('h1');
			title.textContent = els.title.value || 'Untitled article';
			els.preview.appendChild(title);
			var body = document.createElement('div');
			body.innerHTML = cleaned;
			els.preview.appendChild(body);
			if (D.upgradeVideos) D.upgradeVideos(body);
		}
		applyCssPreview();
		lint();
		autosave();
	}
	[].forEach.call(document.querySelectorAll('.write-tabs [data-view]'), function (tab) {
		tab.addEventListener('click', function () { setView(tab.getAttribute('data-view')); });
	});

	/* ---------------------------------------------------------------- toolbar */
	function rememberSelection() {
		var sel = window.getSelection();
		if (sel.rangeCount && els.rte.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
	}
	function restoreSelection() {
		els.rte.focus();
		if (savedRange) { var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
	}
	document.addEventListener('selectionchange', rememberSelection);
	function insertHtml(html) { restoreSelection(); document.execCommand('insertHTML', false, html); onEdit(); }
	function esc(text) { var d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

	els.toolbar.addEventListener('mousedown', function (event) { if (!event.target.closest('select')) event.preventDefault(); });
	els.toolbar.addEventListener('click', function (event) {
		var btn = event.target.closest('[data-cmd]');
		if (!btn) return;
		var cmd = btn.getAttribute('data-cmd');
		restoreSelection();
		var exec = function (name, value) { document.execCommand(name, false, value || null); onEdit(); };
		if (cmd === 'bold') exec('bold');
		else if (cmd === 'italic') exec('italic');
		else if (cmd === 'underline') exec('underline');
		else if (cmd === 'ul') exec('insertUnorderedList');
		else if (cmd === 'ol') exec('insertOrderedList');
		else if (cmd === 'hr') exec('insertHorizontalRule');
		else if (cmd === 'left') exec('justifyLeft');
		else if (cmd === 'center') exec('justifyCenter');
		else if (cmd === 'clear') { exec('removeFormat'); exec('formatBlock', 'p'); }
		else if (cmd === 'unlink') exec('unlink');
		else if (cmd === 'link') {
			var url = window.prompt('Link address (https://…, mailto:… or #section):', 'https://');
			if (!url) return;
			var safe = D.safeUrl(url.trim(), 'link');
			if (!safe) { say('That link address is not allowed. Use https://, mailto: or tel:.', 'error'); return; }
			exec('createLink', safe);
		}
		else if (cmd === 'callout') insertHtml('<div class="callout"><p>Write your note here.</p></div><p><br></p>');
		else if (cmd === 'image') openImageDialog();
		else if (cmd === 'video') openVideoDialog();
	});
	els.block.addEventListener('change', function () {
		restoreSelection();
		document.execCommand('formatBlock', false, els.block.value === 'p' ? 'p' : els.block.value);
		onEdit();
	});

	els.rte.addEventListener('paste', function (event) {
		event.preventDefault();
		var data = event.clipboardData || window.clipboardData;
		var html = data.getData('text/html');
		if (html) document.execCommand('insertHTML', false, D.sanitizeHtml(html, { allowStyle: false }).html);
		else document.execCommand('insertText', false, data.getData('text'));
		onEdit();
	});
	els.rte.addEventListener('dragover', function (event) { if (event.dataTransfer && [].indexOf.call(event.dataTransfer.types, 'Files') !== -1) event.preventDefault(); });
	els.rte.addEventListener('drop', function (event) {
		var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
		if (!file || !/^image\//.test(file.type)) return;
		event.preventDefault();
		say('Uploading picture…');
		D.uploadImage(file).then(function (url) {
			insertHtml(figureHtml(url, file.name.replace(/\.[^.]+$/, ''), '', 'full'));
			say('');
		}, function (error) { say(error.message, 'error'); });
	});

	function figureHtml(url, alt, caption, size) {
		return '<figure class="fig fig--' + size + '"><img src="' + esc(url).replace(/"/g, '&quot;') + '" alt="' + esc(alt).replace(/"/g, '&quot;') + '">' +
			(caption ? '<figcaption>' + esc(caption) + '</figcaption>' : '') + '</figure><p><br></p>';
	}

	/* ---------------------------------------------------------------- dialogs */
	var dImage = $('dlg-image'), dVideo = $('dlg-video');
	[dImage, dVideo].forEach(function (dlg) {
		dlg.addEventListener('click', function (event) { if (event.target.hasAttribute('data-close')) dlg.close(); });
	});
	function openImageDialog() {
		$('dlg-image-form').reset();
		$('di-status').hidden = true;
		dImage.showModal();
		$('di-url').focus();
	}
	$('dlg-image-form').addEventListener('submit', function (event) {
		event.preventDefault();
		var status = $('di-status');
		var file = $('di-file').files[0];
		var ok = $('di-ok');
		function done(url) {
			var safe = D.safeUrl(url, 'image');
			if (!safe) { status.hidden = false; status.textContent = 'Use an https:// picture address, or upload a picture.'; ok.disabled = false; return; }
			dImage.close();
			ok.disabled = false;
			insertHtml(figureHtml(safe, $('di-alt').value.trim(), $('di-caption').value.trim(), $('di-size').value));
		}
		ok.disabled = true;
		status.hidden = true;
		if (file) {
			D.uploadImage(file).then(done, function (error) { status.hidden = false; status.textContent = error.message; ok.disabled = false; });
		} else done($('di-url').value.trim());
	});

	function openVideoDialog() { $('dlg-video-form').reset(); $('dv-status').hidden = true; dVideo.showModal(); $('dv-url').focus(); }
	$('dlg-video-form').addEventListener('submit', function (event) {
		event.preventDefault();
		var raw = $('dv-url').value.trim();
		var status = $('dv-status');
		var yt = D.youtubeEmbed(raw);
		var html = '';
		if (yt) html = '<figure class="embed"><iframe src="' + yt + '" title="Embedded video" allowfullscreen></iframe></figure><p><br></p>';
		else if (/^https:\/\/\S+\.(mp4|m4v|webm|ogv|ogg)(\?\S*)?$/i.test(raw) && D.safeUrl(raw, 'media')) {
			html = '<figure class="embed"><video src="' + esc(raw).replace(/"/g, '&quot;') + '" controls preload="metadata"></video></figure><p><br></p>';
		}
		if (!html) { status.hidden = false; status.textContent = 'Paste a YouTube link, or an https:// link to a .mp4 / .webm file.'; return; }
		dVideo.close();
		insertHtml(html);
	});

	/* ---------------------------------------------------------------- state: draft + form */
	function collect() {
		return {
			id: els.id.value.trim(), title: els.title.value.trim(), category: els.category.value.trim(), description: els.desc.value.trim(),
			tags: els.tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 12),
			image: els.image.value.trim(), imageAlt: els.imageAlt.value.trim(), html: currentHtml(), css: els.css.value
		};
	}
	function fill(data) {
		els.id.value = data.id || ''; els.title.value = data.title || ''; els.category.value = data.category || 'Articles';
		els.desc.value = data.description || ''; els.tags.value = (data.tags || []).join(', ');
		els.image.value = data.image || ''; els.imageAlt.value = data.imageAlt || '';
		var html = D.sanitizeHtml(data.html || '', { allowStyle: true }).html;
		els.rte.innerHTML = html;
		els.src.value = html.replace(/></g, '>\n<');
		els.css.value = data.css || '';
		[els.src, els.css].forEach(function (a) { a.__paint && a.__paint(); });
		slugTouched = Boolean(data.id);
		applyCssPreview();
	}
	var saveTimer = null;
	function autosave() {
		if (editId) return;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(function () { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); } catch (e) {} }, 400);
	}
	function onEdit() { applyCssPreview(); autosave(); }
	els.rte.addEventListener('input', onEdit);
	els.src.addEventListener('input', autosave);
	els.css.addEventListener('input', function () { applyCssPreview(); autosave(); });
	[els.title, els.category, els.desc, els.tags, els.image, els.imageAlt].forEach(function (n) { n.addEventListener('input', autosave); });
	els.title.addEventListener('input', function () { if (!slugTouched && !editId) els.id.value = slugify(els.title.value); });
	els.id.addEventListener('input', function () { slugTouched = true; });
	els.saveDraft.addEventListener('click', function () {
		try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); say('Draft saved in this browser.', 'success'); } catch (e) { say('This browser would not let the draft be saved.', 'error'); }
	});
	els.discard.addEventListener('click', function () {
		if (!window.confirm('Discard this draft and start over?')) return;
		try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
		fill({}); setView('write'); say('');
	});

	els.imageUpload.addEventListener('click', function () { els.imageFile.click(); });
	els.imageFile.addEventListener('change', function () {
		var file = els.imageFile.files[0];
		if (!file) return;
		say('Uploading cover picture…');
		D.uploadImage(file).then(function (url) { els.image.value = url; say(''); autosave(); }, function (error) { say(error.message, 'error'); });
		els.imageFile.value = '';
	});

	/* ---------------------------------------------------------------- publish */
	function busy(on) {
		els.publish.disabled = on;
		els.spinner.hidden = !on;
		els.publish.setAttribute('aria-busy', String(on));
	}
	els.form.addEventListener('submit', function (event) {
		event.preventDefault();
		if (els.publish.disabled) return;
		var data = collect();
		var html = clean();
		var css = cleanCss().css;
		lint();
		if (data.title.length < 3) { say('Give the article a title (at least 3 characters).', 'error'); els.title.focus(); return; }
		if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(data.id)) { say('The link slug can use lowercase letters, numbers and hyphens (it must start with a letter or number).', 'error'); els.id.focus(); return; }
		if (!data.description) { say('Add a short summary: it appears on the post card.', 'error'); els.desc.focus(); return; }
		if (!hasContent(html.html)) { say('The article is empty. Write something first.', 'error'); return; }
		if (data.image && !D.safeUrl(data.image, 'image')) { say('The cover picture must be an https:// address or an uploaded picture.', 'error'); els.image.focus(); return; }
		try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
		if (!live) { say('Draft saved in this browser. Publishing switches on once the article backend is connected (features.articles in config.js).', 'success'); return; }
		busy(true);
		say('Publishing…');
		var body = { id: data.id, title: data.title, description: data.description, category: data.category || 'Articles', tags: data.tags, image: data.image, imageAlt: data.imageAlt, bodyHtml: html.html, css: css };
		D.api(editId ? 'articles/' + encodeURIComponent(editId) : 'articles', { method: editId ? 'PUT' : 'POST', json: body }).then(function (result) {
			if (!editId) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
			var post = result.post || result.article || { id: data.id };
			say(editId ? 'Article updated.' : 'Article published.', 'success', D.root + 'post.html?id=' + encodeURIComponent(post.id || data.id));
		}).catch(function (error) {
			say(error.status === 409 ? 'An article or video with that slug already exists. Pick another slug.' : (error.offline ? 'The server has no article endpoint yet.' : error.message), 'error');
		}).then(function () { busy(false); });
	});

	/* ---------------------------------------------------------------- start */
	attachCode(els.srcWrap);
	attachCode(els.cssWrap);
	els.gate.hidden = true;

	function startApp() {
		els.app.hidden = false;
		els.auth.hidden = true;
		if (!live) {
			els.banner.hidden = false;
			els.banner.textContent = 'The article backend is not connected yet. You can write, style and preview everything; drafts are kept in this browser, and Publish turns on once features.articles is enabled.';
		}
		if (editId) {
			els.heading.textContent = 'Edit article';
			els.publishLabel.textContent = 'Save changes';
			els.id.readOnly = true;
			if (live) {
				D.api('articles/' + encodeURIComponent(editId)).then(function (payload) {
					var a = payload.article || {};
					fill({ id: a.id, title: a.title, category: a.category, description: a.description, tags: a.tags, image: a.image, imageAlt: a.imageAlt, html: a.bodyHtml, css: a.css });
				}).catch(function () { say('That article could not be loaded.', 'error'); });
			} else say('Editing existing articles needs the backend. Open this page again after it is connected.', 'error');
			return;
		}
		var draft = null;
		try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) {}
		if (draft && typeof draft === 'object') { fill(draft); say('Restored your saved draft.', 'success'); }
	}

	D.me().then(function (account) {
		if (!account) {
			els.auth.hidden = true; els.gate.hidden = false;
			els.gateMsg.textContent = 'Sign in with a publisher, editor or admin account to write articles.';
		} else if (!D.hasRole(account, 'publisher')) {
			els.auth.hidden = true; els.gate.hidden = false;
			els.gateMsg.textContent = 'Your account can comment and react, but publishing needs a publisher, editor or admin role.';
		} else startApp();
	});
})();
