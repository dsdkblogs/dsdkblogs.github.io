/* Direct page editing for admin accounts.
   - Any element with data-edit="some.key" is editable text; data-edit-img="some.key" is an editable picture.
   - Saved overrides are loaded from GET /api/content on every page (only when features.content is on) and applied over the
     defaults written in the HTML, so the HTML itself stays the fallback.
   - Admins get a small floating bar: "Edit text & images" (click text to type, click a picture to swap it), save, discard, reset.
   - With features.content OFF the editor still works as a preview, but nothing is published (the bar says so).
   Server contract: see commands.txt ("BACKEND CONTRACT"). */
(function () {
	var D = window.DSDK;
	if (!D) return;

	var live = D.feature('content');
	var textNodes = [].slice.call(document.querySelectorAll('[data-edit]'));
	var imgNodes = [].slice.call(document.querySelectorAll('[data-edit-img]'));
	var customTarget = (document.body.getAttribute('data-custom-target') || '').replace('post:*', function () {
		var id = new URLSearchParams(location.search).get('id');
		return id ? 'post:' + id : '';
	});

	/* ---------- remember defaults so "reset" can restore them ---------- */
	textNodes.forEach(function (node) {
		node.__def = node.textContent;
		node.__defI18n = node.getAttribute('data-i18n');
		node.__saved = null;                      /* last value that exists on the server (null = default) */
	});
	imgNodes.forEach(function (node) {
		node.__defRole = node.getAttribute('role');
		node.__defLabel = node.getAttribute('aria-label');
		node.__saved = null;
	});

	function keyOf(node) { return node.getAttribute('data-edit') || node.getAttribute('data-edit-img'); }

	function setText(node, value) {
		node.removeAttribute('data-i18n');         /* otherwise the language switch would overwrite it */
		node.textContent = value;
	}
	function resetText(node) {
		if (node.__defI18n) node.setAttribute('data-i18n', node.__defI18n);
		node.textContent = node.__defI18n && D.t ? D.t(node.__defI18n) : node.__def;
	}

	function setImage(node, src, alt) {
		var safe = D.safeUrl ? D.safeUrl(src, 'image') : src;
		if (!safe) return false;
		var url = D.assetUrl ? D.assetUrl(safe) : safe;
		if (node.tagName === 'IMG') { node.src = url; node.alt = alt || ''; return true; }
		var img = node.querySelector('img[data-edit-made]');
		if (!img) {
			img = document.createElement('img');
			img.setAttribute('data-edit-made', '');
			img.loading = 'lazy';
			node.appendChild(img);
		}
		img.src = url;
		img.alt = alt || '';
		node.removeAttribute('role');
		node.removeAttribute('aria-label');
		return true;
	}
	function resetImage(node) {
		var made = node.querySelector('img[data-edit-made]');
		if (made) made.remove();
		if (node.__defRole) node.setAttribute('role', node.__defRole);
		if (node.__defLabel) node.setAttribute('aria-label', node.__defLabel);
	}

	function applyOverrides(map) {
		Object.keys(map || {}).forEach(function (key) {
			var item = map[key];
			if (!item || typeof item.value !== 'string') return;
			if (item.type === 'image') {
				[].forEach.call(document.querySelectorAll('[data-edit-img="' + cssEscape(key) + '"]'), function (node) {
					if (setImage(node, item.value, item.alt)) node.__saved = { type: 'image', value: item.value, alt: item.alt || '' };
				});
			} else {
				[].forEach.call(document.querySelectorAll('[data-edit="' + cssEscape(key) + '"]'), function (node) {
					setText(node, item.value);
					node.__saved = { type: 'text', value: item.value };
				});
			}
		});
	}
	function cssEscape(value) { return (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'); }

	if (live && (textNodes.length || imgNodes.length)) {
		D.api('content').then(function (payload) { applyOverrides(payload.content); }).catch(function () {});
	}

	/* ====================================================================== admin bar */
	if (!D.maybeStaff()) return;
	if (!textNodes.length && !imgNodes.length && !customTarget) return;

	var editing = false;
	var changes = {};              /* key -> { type, value, alt } waiting to be saved */
	var resets = {};               /* key -> true: delete the saved override */
	var bar, toggleBtn, labLink, panel, saveBtn, discardBtn, resetBtn, doneBtn, statusEl, dialog;

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}
	function dirtyCount() { return Object.keys(changes).length + Object.keys(resets).length; }
	function say(message, isError) {
		statusEl.textContent = message || '';
		statusEl.classList.toggle('is-error', Boolean(isError));
	}
	function refresh() {
		saveBtn.textContent = dirtyCount() ? 'Save changes (' + dirtyCount() + ')' : 'Save changes';
		saveBtn.disabled = !dirtyCount();
		discardBtn.disabled = !dirtyCount();
	}

	function buildBar() {
		bar = el('div', 'admin-bar');
		bar.setAttribute('role', 'region');
		bar.setAttribute('aria-label', 'Site editing tools');

		var row = el('div', 'admin-bar__row');
		toggleBtn = el('button', 'btn btn--small', 'Edit text & images');
		toggleBtn.type = 'button';
		toggleBtn.setAttribute('aria-pressed', 'false');
		toggleBtn.addEventListener('click', function () { setEditing(!editing); });
		if (textNodes.length || imgNodes.length) row.appendChild(toggleBtn);

		if (customTarget) {
			labLink = el('a', 'btn btn--ghost btn--small', 'Page lab (HTML & CSS)');
			labLink.href = D.root + 'editor.html?target=' + encodeURIComponent(customTarget);
			row.appendChild(labLink);
		}
		bar.appendChild(row);

		panel = el('div', 'admin-bar__panel');
		panel.hidden = true;
		var help = el('p', 'admin-bar__help', 'Editing is on: click any dashed text to type, or press “Change image” on a picture.');
		saveBtn = el('button', 'btn btn--small', 'Save changes');
		saveBtn.type = 'button';
		saveBtn.addEventListener('click', save);
		discardBtn = el('button', 'btn btn--ghost btn--small', 'Discard');
		discardBtn.type = 'button';
		discardBtn.addEventListener('click', discard);
		resetBtn = el('button', 'link-btn', 'Reset this page to defaults');
		resetBtn.type = 'button';
		resetBtn.addEventListener('click', resetAll);
		doneBtn = el('button', 'link-btn', 'Done');
		doneBtn.type = 'button';
		doneBtn.addEventListener('click', function () {
			if (dirtyCount() && !window.confirm('You have unsaved changes. Leave editing mode and keep them on this page only until you reload?')) return;
			setEditing(false);
		});
		statusEl = el('p', 'admin-bar__status');
		statusEl.setAttribute('role', 'status');
		var actions = el('div', 'admin-bar__row');
		[saveBtn, discardBtn, resetBtn, doneBtn].forEach(function (b) { actions.appendChild(b); });
		panel.appendChild(help);
		if (!live) {
			panel.appendChild(el('p', 'admin-bar__warn', 'Preview mode: the backend for page editing is not connected yet (features.content in config.js), so nothing can be published. Your edits last until you reload.'));
		}
		panel.appendChild(actions);
		panel.appendChild(statusEl);
		bar.appendChild(panel);
		document.body.appendChild(bar);
		refresh();
	}

	/* ---------- text editing ---------- */
	function onInput(event) {
		var node = event.currentTarget;
		var key = keyOf(node);
		var value = node.textContent.replace(/\s+/g, ' ').trim();
		/* the same key can appear more than once (e.g. footer): keep copies in sync */
		[].forEach.call(document.querySelectorAll('[data-edit="' + cssEscape(key) + '"]'), function (other) { if (other !== node) { other.removeAttribute('data-i18n'); other.textContent = value; } });
		delete resets[key];
		changes[key] = { type: 'text', value: value };
		refresh();
	}
	function onKeydown(event) { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }
	function onPaste(event) {
		event.preventDefault();
		var text = ((event.clipboardData || window.clipboardData).getData('text') || '').replace(/\s+/g, ' ');
		document.execCommand('insertText', false, text);
	}
	function blockLinks(event) {
		if (!editing) return;
		var inside = event.target.closest && event.target.closest('[data-edit], .edit-img-btn');
		if (inside) event.preventDefault();
	}
	document.addEventListener('click', blockLinks, true);

	/* ---------- image editing ---------- */
	function openImageDialog(node) {
		var key = keyOf(node);
		if (!dialog) {
			dialog = document.createElement('dialog');
			dialog.className = 'dlg';
			document.body.appendChild(dialog);
		}
		var current = (changes[key] && changes[key].type === 'image' ? changes[key] : node.__saved) || { value: '', alt: '' };
		dialog.replaceChildren();
		var form = el('form', 'dlg__form');
		form.method = 'dialog';
		form.appendChild(el('h2', '', 'Change picture'));
		var l1 = el('label', '', 'Image address (https://… or a path on this site)');
		var url = document.createElement('input');
		url.type = 'text'; url.value = current.value || ''; url.placeholder = 'https://…';
		l1.appendChild(url);
		var l2 = el('label', '', 'Description for screen readers');
		var alt = document.createElement('input');
		alt.type = 'text'; alt.value = current.alt || ''; alt.maxLength = 200;
		l2.appendChild(alt);
		form.appendChild(l1);
		form.appendChild(l2);
		var msg = el('p', 'auth-status is-error');
		msg.hidden = true;
		msg.setAttribute('role', 'alert');
		if (D.feature('uploads') && D.uploadImage) {
			var l3 = el('label', '', '…or upload a picture');
			var file = document.createElement('input');
			file.type = 'file'; file.accept = 'image/jpeg,image/png,image/webp,image/gif';
			file.addEventListener('change', function () {
				if (!file.files[0]) return;
				msg.hidden = false; msg.classList.remove('is-error'); msg.textContent = 'Uploading…';
				D.uploadImage(file.files[0]).then(function (address) { url.value = address; msg.hidden = true; }, function (error) { msg.classList.add('is-error'); msg.textContent = error.message; });
			});
			l3.appendChild(file);
			form.appendChild(l3);
		}
		form.appendChild(msg);
		var actions = el('div', 'dlg__actions');
		var cancel = el('button', 'link-btn', 'Cancel'); cancel.type = 'button';
		cancel.addEventListener('click', function () { dialog.close(); });
		var def = el('button', 'link-btn', 'Use the default picture'); def.type = 'button';
		def.addEventListener('click', function () {
			resetImage(node); delete changes[key]; resets[key] = true; refresh(); dialog.close();
		});
		var ok = el('button', 'btn', 'Apply'); ok.type = 'submit';
		actions.appendChild(cancel); actions.appendChild(def); actions.appendChild(ok);
		form.appendChild(actions);
		form.addEventListener('submit', function (event) {
			event.preventDefault();
			var value = url.value.trim();
			if (!value || !setImage(node, value, alt.value.trim())) {
				msg.hidden = false; msg.classList.add('is-error'); msg.textContent = 'Enter a valid https:// image address.'; return;
			}
			delete resets[key];
			changes[key] = { type: 'image', value: value, alt: alt.value.trim() };
			refresh();
			dialog.close();
		});
		dialog.appendChild(form);
		dialog.showModal();
		url.focus();
	}

	function setEditing(on) {
		editing = on;
		document.body.classList.toggle('is-editing', on);
		toggleBtn.setAttribute('aria-pressed', String(on));
		toggleBtn.textContent = on ? 'Editing…' : 'Edit text & images';
		panel.hidden = !on;
		textNodes.forEach(function (node) {
			if (on) {
				node.setAttribute('contenteditable', 'plaintext-only');
				if (node.contentEditable !== 'plaintext-only') node.setAttribute('contenteditable', 'true');
				node.setAttribute('spellcheck', 'true');
				node.addEventListener('input', onInput);
				node.addEventListener('keydown', onKeydown);
				node.addEventListener('paste', onPaste);
			} else {
				node.removeAttribute('contenteditable');
				node.removeAttribute('spellcheck');
				node.removeEventListener('input', onInput);
				node.removeEventListener('keydown', onKeydown);
				node.removeEventListener('paste', onPaste);
			}
		});
		[].forEach.call(document.querySelectorAll('.edit-img-btn'), function (b) { b.remove(); });
		if (on) {
			imgNodes.forEach(function (node) {
				var b = el('button', 'edit-img-btn', 'Change image');
				b.type = 'button';
				b.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); openImageDialog(node); });
				node.appendChild(b);
			});
		}
		say('');
	}

	function discard() {
		Object.keys(changes).concat(Object.keys(resets)).forEach(restoreKey);
		changes = {}; resets = {};
		refresh();
		say('Changes discarded.');
	}
	function restoreKey(key) {
		[].forEach.call(document.querySelectorAll('[data-edit="' + cssEscape(key) + '"]'), function (node) {
			if (node.__saved) setText(node, node.__saved.value); else resetText(node);
		});
		[].forEach.call(document.querySelectorAll('[data-edit-img="' + cssEscape(key) + '"]'), function (node) {
			if (node.__saved) setImage(node, node.__saved.value, node.__saved.alt); else resetImage(node);
		});
	}
	function resetAll() {
		if (!window.confirm('Reset every editable text and picture on this page back to the defaults written in the page? Press Save afterwards to publish that.')) return;
		var seen = {};
		textNodes.concat(imgNodes).forEach(function (node) {
			var key = keyOf(node);
			if (seen[key]) return;
			seen[key] = true;
			[].forEach.call(document.querySelectorAll('[data-edit="' + cssEscape(key) + '"]'), resetText);
			[].forEach.call(document.querySelectorAll('[data-edit-img="' + cssEscape(key) + '"]'), resetImage);
			delete changes[key];
			resets[key] = true;
		});
		refresh();
	}

	function save() {
		if (!dirtyCount()) return;
		if (!live) { say('Not published: page editing is not connected to the backend yet.', true); return; }
		saveBtn.disabled = true;
		say('Saving…');
		D.api('content', { method: 'PUT', json: { changes: changes, reset: Object.keys(resets) } }).then(function () {
			Object.keys(changes).forEach(function (key) {
				[].forEach.call(document.querySelectorAll('[data-edit="' + cssEscape(key) + '"], [data-edit-img="' + cssEscape(key) + '"]'), function (node) { node.__saved = changes[key]; });
			});
			Object.keys(resets).forEach(function (key) {
				[].forEach.call(document.querySelectorAll('[data-edit="' + cssEscape(key) + '"], [data-edit-img="' + cssEscape(key) + '"]'), function (node) { node.__saved = null; });
			});
			changes = {}; resets = {};
			refresh();
			say('Saved. Everyone sees the new version now.');
		}).catch(function (error) {
			refresh();
			say(error.offline ? 'The server has no page-editing endpoint yet.' : (error.message || 'Could not save.'), true);
		});
	}

	window.addEventListener('beforeunload', function (event) { if (editing && dirtyCount() && live) { event.preventDefault(); event.returnValue = ''; } });

	/* ---------- show / hide the overlay from the header's "Staff tools" menu (see site.js) ----------
	   Admin-only, exactly like the bar itself. Hiding leaves editing mode first so no dashed, editable text is left on the page;
	   if there are unsaved changes the admin is asked first and the overlay stays open when they say no.
	   The choice is remembered per account in this browser. Opening the page with ?edit=1 (dashboard shortcut) always shows it. */
	var OVERLAY_MIN_ROLE = 'admin';
	function overlayVisible() { return Boolean(bar) && !bar.hidden; }
	function setOverlayVisible(on) {
		if (!bar) return false;
		if (!on) {
			if (editing) {
				if (dirtyCount() && !window.confirm('You have unsaved changes. Hide the editing panel and keep them on this page only until you reload?')) return false;
				setEditing(false);
			}
			if (dialog && dialog.open) dialog.close();
		}
		bar.hidden = !on;
		return true;
	}

	D.me().then(function (account) {
		if (!account || !D.hasRole(account, OVERLAY_MIN_ROLE)) return;
		buildBar();
		var forced = /[?&]edit=1/.test(location.search);
		if (forced) D.setToolPref('overlay', true);
		if (D.toolPref('overlay') === false) bar.hidden = true;
		if (D.registerTool) D.registerTool({
			id: 'overlay', minRole: OVERLAY_MIN_ROLE, labelKey: 'tools.overlay', hintKey: 'tools.overlayHint',
			isOn: overlayVisible, setOn: setOverlayVisible
		});
		if (forced && (textNodes.length || imgNodes.length)) setEditing(true);
	});
})();
