/* Renders what the admin wrote in the Page lab (editor.html) for the current page:
     - site-wide CSS (target "site:global", returned as `global` with every request)
     - per-page / per-post CSS and HTML, placed above, below, or instead of the normal content.
   Runs only when features.custom is on. HTML goes through the allow-list sanitizer (no scripts, ever);
   CSS has @import / unsafe url() removed. The Worker must validate the same way before saving.
   GET /api/custom?target=page:home -> { custom: { html, css, mode, enabled } | null, global: { css, enabled } | null } */
(function () {
	var D = window.DSDK;
	if (!D || !D.feature('custom') || !D.sanitizeHtml) return;

	var target = document.body.getAttribute('data-custom-target') || '';
	if (target === 'post:*') {
		var id = new URLSearchParams(location.search).get('id');
		target = id ? 'post:' + id : '';
	}
	if (!target) return;

	function addStyle(id, css) {
		var old = document.getElementById(id);
		if (old) old.remove();
		if (!css) return;
		var style = document.createElement('style');
		style.id = id;
		style.textContent = D.sanitizeCss(css).css;
		document.head.appendChild(style);
	}

	D.api('custom?target=' + encodeURIComponent(target)).then(function (payload) {
		var globalCss = payload.global && payload.global.enabled !== false ? payload.global.css : '';
		addStyle('dsdk-global-css', globalCss);

		var custom = payload.custom;
		if (!custom || custom.enabled === false) return;
		addStyle('dsdk-custom-css', custom.css);

		if (!custom.html) return;
		var host = document.getElementById('main');
		if (!host) return;
		var wrap = document.createElement('section');
		wrap.className = 'custom-html';
		wrap.setAttribute('data-custom-region', target);
		wrap.innerHTML = D.sanitizeHtml(custom.html, { allowStyle: true }).html;
		if (D.upgradeVideos) D.upgradeVideos(wrap);

		if (custom.mode === 'replace') {
			[].forEach.call(host.children, function (child) { child.classList.add('custom-hidden'); });
			host.appendChild(wrap);
		} else if (custom.mode === 'above') host.insertBefore(wrap, host.firstChild);
		else host.appendChild(wrap);
	}).catch(function () { /* no custom code (or backend not ready): the normal page stays as it is */ });
})();
