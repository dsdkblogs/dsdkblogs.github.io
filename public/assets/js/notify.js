/* Web notifications, no backend and no email.
   - A bell in the header opens a panel with two tabs: Alerts (recent new posts) and Settings (toggles).
   - While the site is open, blog-posts.json is re-checked every minute (and when the tab regains focus).
     Every post id that has not been seen before becomes an alert: a pop-up card with the cover image
     (or placeholder), title and short description, plus an optional browser notification.
   - Choices and the alert list live in this browser's localStorage only.

   Alerts to people who do NOT have the site open (true push) need a server: see HANDOFF.md. */
(function () {
	var D = window.DSDK;
	if (!D) return;
	var t = D.t;

	var POLL_MS = 60 * 1000;
	var MAX_LIST = 20;
	var MAX_TOASTS = 3;
	var KEY = { on: 'dsdk.notify.on', browser: 'dsdk.notify.browser', known: 'dsdk.notify.known', inbox: 'dsdk.notify.inbox', read: 'dsdk.notify.read' };

	function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
	function getList(k) { try { var v = JSON.parse(get(k)); return Array.isArray(v) ? v : null; } catch (e) { return null; } }
	function setList(k, v) { set(k, JSON.stringify(v)); }

	var enabled = get(KEY.on) !== '0';           /* in-site alerts default to on */
	var browserOn = get(KEY.browser) === '1';
	var inbox = getList(KEY.inbox) || [];        /* ids, newest first */
	var readIds = getList(KEY.read) || [];
	var posts = [];                              /* latest feed, newest first */
	var timer = null;
	var opener = null;

	var supportsNative = typeof window.Notification === 'function';
	function permission() { return supportsNative ? Notification.permission : 'denied'; }

	function byId(id) { return posts.filter(function (p) { return p.id === id; })[0]; }
	function unreadCount() { return inbox.filter(function (id) { return readIds.indexOf(id) === -1 && byId(id); }).length; }

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	/* image or placeholder thumbnail; same look as the post cards */
	function thumb(post) {
		if ((post.videoId || post.embedSrc || post.videoSrc) && !post.image) return null;
		var m = el('div', 'media media--square notif__thumb');
		m.setAttribute('data-tint', D.tintFor(post.id));
		if (post.image) {
			var img = document.createElement('img');
			img.src = D.assetUrl(post.image);
			img.alt = post.imageAlt || '';
			img.loading = 'lazy';
			m.appendChild(img);
		}
		return m;
	}

	/* ---------- header bell ---------- */
	var tools = document.querySelector('.header-tools');
	var bell, badge;
	if (tools) {
		bell = el('button', 'icon-btn bell-btn');
		bell.type = 'button';
		bell.id = 'notify-toggle';
		bell.setAttribute('aria-haspopup', 'dialog');
		bell.setAttribute('aria-expanded', 'false');
		bell.setAttribute('aria-controls', 'notify-panel');
		bell.setAttribute('data-i18n-aria', 'notify.open');
		bell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>';
		badge = el('span', 'bell-badge');
		badge.setAttribute('aria-hidden', 'true');
		badge.hidden = true;
		bell.appendChild(badge);
		var after = document.getElementById('search-toggle');
		if (after && after.parentNode === tools) after.insertAdjacentElement('afterend', bell); else tools.insertBefore(bell, tools.firstChild);
		bell.addEventListener('click', function () { if (panel && !panel.hidden) closePanel(); else openPanel(bell); });
	}

	function updateBell() {
		if (!bell) return;
		var n = enabled ? unreadCount() : 0;
		badge.hidden = n === 0;
		badge.textContent = n > 9 ? '9+' : String(n);
		var label = t('notify.open') + (n ? ' (' + t('notify.unread', { n: n }) + ')' : '');
		bell.setAttribute('aria-label', label);
		bell.classList.toggle('is-off', !enabled);
	}

	/* ---------- toasts ---------- */
	var toastBox;
	function ensureToastBox() {
		if (toastBox) return toastBox;
		toastBox = el('div', 'toasts');
		toastBox.setAttribute('role', 'region');
		toastBox.setAttribute('aria-live', 'polite');
		toastBox.setAttribute('aria-label', t('notify.title'));
		document.body.appendChild(toastBox);
		return toastBox;
	}

	function showToast(post) {
		var box = ensureToastBox();
		while (box.children.length >= MAX_TOASTS) box.removeChild(box.firstChild);

		var card = el('article', 'toast');
		var link = el('a', 'toast__main');
		link.href = D.postUrl(post);
		var thumbnail = thumb(post);
		if (thumbnail) link.appendChild(thumbnail);
		var body = el('div', 'toast__body');
		body.appendChild(el('p', 'toast__eyebrow', t('notify.new')));
		body.appendChild(el('h3', 'toast__title', post.title));
		body.appendChild(el('p', 'toast__desc', post.description));
		link.appendChild(body);
		link.addEventListener('click', function () { markRead(post.id); });

		var x = el('button', 'toast__close', '×');
		x.type = 'button';
		x.setAttribute('aria-label', t('notify.dismiss'));
		function remove() { clearTimeout(life); if (card.parentNode) card.parentNode.removeChild(card); }
		x.addEventListener('click', remove);
		card.appendChild(link); card.appendChild(x);
		box.appendChild(card);

		var life = setTimeout(remove, 10000);
		card.addEventListener('mouseenter', function () { clearTimeout(life); });
		card.addEventListener('mouseleave', function () { life = setTimeout(remove, 4000); });
		card.addEventListener('focusin', function () { clearTimeout(life); });
	}

	function nativeNotify(post) {
		if (!browserOn || permission() !== 'granted') return;
		try {
			var n = new Notification(t('notify.new') + ': ' + post.title, {
				body: post.description,
				icon: post.image ? D.assetUrl(post.image) : undefined,
				tag: 'dsdk-' + post.id
			});
			n.onclick = function () { window.focus(); location.href = D.postUrl(post); n.close(); };
		} catch (e) { /* some mobile browsers only allow notifications from a service worker */ }
	}

	/* ---------- feed checking ---------- */
	function markRead(id) {
		if (readIds.indexOf(id) === -1) { readIds.push(id); setList(KEY.read, readIds.slice(-200)); }
		updateBell(); renderAlerts();
	}

	function sortNewest(list) { return list.slice().sort(function (a, b) { return Date.parse(b.publishedAt) - Date.parse(a.publishedAt); }); }

	function baseline() { setList(KEY.known, posts.map(function (p) { return p.id; })); }

	function check(fresh) {
		return D.loadFeed(fresh).then(function (feed) {
			posts = sortNewest(feed);
			if (!enabled) { updateBell(); renderAlerts(); return; }
			var known = getList(KEY.known);
			if (!known) { baseline(); updateBell(); renderAlerts(); return; }   /* first visit: nothing is "new" yet */
			var added = posts.filter(function (p) { return known.indexOf(p.id) === -1; });
			if (added.length) {
				added.slice().reverse().forEach(function (p) { if (inbox.indexOf(p.id) === -1) inbox.unshift(p.id); });
				inbox = inbox.slice(0, MAX_LIST);
				setList(KEY.inbox, inbox);
				baseline();
				added.slice(0, MAX_TOASTS).forEach(function (p) {
					if (document.hidden) nativeNotify(p); else showToast(p);
				});
			}
			updateBell(); renderAlerts();
		}).catch(function () { /* offline or feed unreachable: try again next tick */ });
	}

	function startPolling() {
		stopPolling();
		if (!enabled) return;
		timer = setInterval(function () { if (!document.hidden) check(true); }, POLL_MS);
	}
	function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

	document.addEventListener('visibilitychange', function () { if (!document.hidden && enabled) check(true); });
	window.addEventListener('storage', function (event) {
		if (event.key && event.key.indexOf('dsdk.notify.') !== 0) return;
		enabled = get(KEY.on) !== '0'; browserOn = get(KEY.browser) === '1';
		inbox = getList(KEY.inbox) || []; readIds = getList(KEY.read) || [];
		updateBell(); renderAlerts(); syncSettings();
	});

	/* ---------- panel ---------- */
	var panel, tabAlerts, tabSettings, paneAlerts, paneSettings, listEl, emptyEl, actionsEl;
	var swAlerts, swBrowser, hintBrowser, markBtn, clearBtn;

	function buildSwitch(id, labelKey, hintKey) {
		var row = el('div', 'setting');
		var text = el('div', 'setting__text');
		var label = el('label', 'setting__label');
		label.setAttribute('for', id);
		label.setAttribute('data-i18n', labelKey);
		label.textContent = t(labelKey);
		var hint = el('p', 'setting__hint');
		hint.id = id + '-hint';
		hint.setAttribute('data-i18n', hintKey);
		hint.textContent = t(hintKey);
		text.appendChild(label); text.appendChild(hint);
		var sw = el('button', 'switch');
		sw.type = 'button'; sw.id = id;
		sw.setAttribute('role', 'switch');
		sw.setAttribute('aria-checked', 'false');
		sw.setAttribute('aria-describedby', id + '-hint');
		sw.appendChild(el('span', 'switch__knob'));
		row.appendChild(text); row.appendChild(sw);
		return { row: row, sw: sw, hint: hint };
	}

	function buildPanel() {
		panel = el('div', 'notify');
		panel.id = 'notify-panel';
		panel.hidden = true;
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-modal', 'true');
		panel.setAttribute('aria-labelledby', 'notify-title');

		var sheet = el('div', 'notify__sheet');
		var head = el('div', 'notify__head');
		var h = el('h2', 'notify__title');
		h.id = 'notify-title';
		h.setAttribute('data-i18n', 'notify.title');
		h.textContent = t('notify.title');
		var close = el('button', 'icon-btn notify__close', '×');
		close.type = 'button';
		close.setAttribute('data-i18n-aria', 'notify.close');
		close.setAttribute('aria-label', t('notify.close'));
		close.addEventListener('click', closePanel);
		head.appendChild(h); head.appendChild(close);

		var tabs = el('div', 'notify__tabs');
		tabs.setAttribute('role', 'tablist');
		tabAlerts = el('button', 'notify__tab');
		tabSettings = el('button', 'notify__tab');
		[[tabAlerts, 'alerts', 'notify.tabAlerts'], [tabSettings, 'settings', 'notify.tabSettings']].forEach(function (d) {
			d[0].type = 'button'; d[0].id = 'notify-tab-' + d[1];
			d[0].setAttribute('role', 'tab');
			d[0].setAttribute('aria-controls', 'notify-pane-' + d[1]);
			d[0].setAttribute('data-i18n', d[2]);
			d[0].textContent = t(d[2]);
			d[0].addEventListener('click', function () { selectTab(d[1]); });
			d[0].addEventListener('keydown', function (event) {
				if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
					event.preventDefault();
					var other = d[1] === 'alerts' ? 'settings' : 'alerts';
					selectTab(other, true);
				}
			});
			tabs.appendChild(d[0]);
		});

		/* alerts pane */
		paneAlerts = el('div', 'notify__pane');
		paneAlerts.id = 'notify-pane-alerts';
		paneAlerts.setAttribute('role', 'tabpanel');
		paneAlerts.setAttribute('aria-labelledby', 'notify-tab-alerts');
		actionsEl = el('div', 'notify__actions');
		markBtn = el('button', 'link-btn');
		markBtn.type = 'button'; markBtn.setAttribute('data-i18n', 'notify.markRead'); markBtn.textContent = t('notify.markRead');
		markBtn.addEventListener('click', function () {
			inbox.forEach(function (id) { if (readIds.indexOf(id) === -1) readIds.push(id); });
			setList(KEY.read, readIds.slice(-200)); updateBell(); renderAlerts();
		});
		clearBtn = el('button', 'link-btn');
		clearBtn.type = 'button'; clearBtn.setAttribute('data-i18n', 'notify.clear'); clearBtn.textContent = t('notify.clear');
		clearBtn.addEventListener('click', function () { inbox = []; setList(KEY.inbox, inbox); updateBell(); renderAlerts(); });
		actionsEl.appendChild(markBtn); actionsEl.appendChild(clearBtn);
		emptyEl = el('p', 'notify__empty');
		listEl = el('ul', 'notify__list');
		paneAlerts.appendChild(actionsEl); paneAlerts.appendChild(emptyEl); paneAlerts.appendChild(listEl);

		/* settings pane */
		paneSettings = el('div', 'notify__pane');
		paneSettings.id = 'notify-pane-settings';
		paneSettings.setAttribute('role', 'tabpanel');
		paneSettings.setAttribute('aria-labelledby', 'notify-tab-settings');
		var a = buildSwitch('set-alerts', 'notify.setAlerts', 'notify.setAlertsHint');
		var b = buildSwitch('set-browser', 'notify.setBrowser', 'notify.setBrowserHint');
		swAlerts = a.sw; swBrowser = b.sw; hintBrowser = b.hint;
		swAlerts.addEventListener('click', function () { setEnabled(!enabled); });
		swBrowser.addEventListener('click', function () { setBrowser(!browserOn); });
		var test = el('button', 'btn btn--ghost notify__test');
		test.type = 'button'; test.setAttribute('data-i18n', 'notify.test'); test.textContent = t('notify.test');
		test.addEventListener('click', function () {
			var latest = posts[0];
			if (!latest) { testMsg.textContent = t('notify.testNone'); return; }
			testMsg.textContent = '';
			showToast(latest);
		});
		var testMsg = el('p', 'notify__msg');
		testMsg.setAttribute('role', 'status');
		var note = el('p', 'notify__note');
		note.setAttribute('data-i18n', 'notify.note'); note.textContent = t('notify.note');
		paneSettings.appendChild(a.row); paneSettings.appendChild(b.row);
		paneSettings.appendChild(test); paneSettings.appendChild(testMsg); paneSettings.appendChild(note);

		sheet.appendChild(head); sheet.appendChild(tabs); sheet.appendChild(paneAlerts); sheet.appendChild(paneSettings);
		panel.appendChild(sheet);
		document.body.appendChild(panel);

		panel.addEventListener('mousedown', function (event) { if (event.target === panel) closePanel(); });
		panel.addEventListener('keydown', function (event) {
			if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
			if (event.key !== 'Tab') return;
			var items = [].filter.call(panel.querySelectorAll('a[href], button:not([disabled])'), function (n) { return n.offsetParent !== null; });
			if (!items.length) return;
			var first = items[0], last = items[items.length - 1];
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		});
		D.onLang(function () { updateBell(); renderAlerts(); syncSettings(); });
	}

	function selectTab(name, focus) {
		var isAlerts = name === 'alerts';
		tabAlerts.setAttribute('aria-selected', isAlerts ? 'true' : 'false');
		tabSettings.setAttribute('aria-selected', isAlerts ? 'false' : 'true');
		tabAlerts.tabIndex = isAlerts ? 0 : -1;
		tabSettings.tabIndex = isAlerts ? -1 : 0;
		paneAlerts.hidden = !isAlerts;
		paneSettings.hidden = isAlerts;
		if (focus) (isAlerts ? tabAlerts : tabSettings).focus();
	}

	function renderAlerts() {
		if (!panel) return;
		listEl.replaceChildren();
		var items = inbox.map(byId).filter(Boolean);
		emptyEl.hidden = items.length > 0;
		emptyEl.textContent = enabled ? t('notify.empty') : t('notify.off');
		actionsEl.hidden = items.length === 0;
		items.forEach(function (post) {
			var unread = readIds.indexOf(post.id) === -1;
			var li = el('li', 'notif' + (unread ? ' is-unread' : ''));
			var link = el('a', 'notif__link');
			link.href = D.postUrl(post);
			var thumbnail = thumb(post);
			if (thumbnail) link.appendChild(thumbnail);
			var body = el('div', 'notif__body');
			var meta = el('p', 'notif__meta');
			if (unread) meta.appendChild(el('span', 'notif__dot'));
			meta.appendChild(el('span', '', t('notify.new')));
			var time = el('time', '', D.formatDate(post.publishedAt));
			time.dateTime = post.publishedAt;
			meta.appendChild(time);
			body.appendChild(meta);
			body.appendChild(el('h3', 'notif__title', post.title));
			body.appendChild(el('p', 'notif__desc', post.description));
			link.appendChild(body);
			link.addEventListener('click', function () { markRead(post.id); });
			li.appendChild(link);
			listEl.appendChild(li);
		});
	}

	function syncSettings() {
		if (!panel) return;
		swAlerts.setAttribute('aria-checked', String(enabled));
		var perm = permission();
		var blocked = !supportsNative || perm === 'denied';
		swBrowser.disabled = !enabled || blocked;
		swBrowser.setAttribute('aria-checked', String(browserOn && !blocked && enabled));
		hintBrowser.textContent = !supportsNative ? t('notify.unsupported') : perm === 'denied' ? t('notify.denied') : t('notify.setBrowserHint');
	}

	function setEnabled(on) {
		enabled = on;
		set(KEY.on, on ? '1' : '0');
		if (on) {
			/* start fresh from "now" so old posts don't flood the list */
			if (posts.length) baseline(); else { try { localStorage.removeItem(KEY.known); } catch (e) {} }
			startPolling();
			check(true);
		} else {
			stopPolling();
		}
		updateBell(); renderAlerts(); syncSettings();
	}

	function setBrowser(on) {
		if (!on) { browserOn = false; set(KEY.browser, '0'); syncSettings(); return; }
		if (!supportsNative) return;
		var done = function (result) {
			browserOn = result === 'granted';
			set(KEY.browser, browserOn ? '1' : '0');
			syncSettings();
		};
		if (Notification.permission === 'granted') { done('granted'); return; }
		if (Notification.permission === 'denied') { done('denied'); return; }
		try {
			var req = Notification.requestPermission(done);
			if (req && typeof req.then === 'function') req.then(done);
		} catch (e) { done('denied'); }
	}

	function openPanel(from) {
		if (!panel) buildPanel();
		opener = from || document.activeElement;
		panel.hidden = false;
		document.documentElement.classList.add('notify-open');
		if (bell) bell.setAttribute('aria-expanded', 'true');
		selectTab('alerts');
		renderAlerts(); syncSettings();
		tabAlerts.focus();
		if (enabled) check(true);
	}
	function closePanel() {
		if (!panel || panel.hidden) return;
		panel.hidden = true;
		document.documentElement.classList.remove('notify-open');
		if (bell) bell.setAttribute('aria-expanded', 'false');
		if (opener && opener.focus) opener.focus();
	}

	window.DSDK.openNotifications = function () { openPanel(document.activeElement); };

	/* ---------- go ---------- */
	updateBell();
	check(false);
	startPolling();
})();
