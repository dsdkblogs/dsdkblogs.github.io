/* Contact page: "copy address" buttons and a form that opens the visitor's own email app (mailto:).
   No server involved; nothing is sent from the website. Addresses come from assets/js/config.js. */
(function () {
	var D = window.DSDK;
	if (!D) return;
	var emails = (D.cfg && D.cfg.email) || {};

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
		return new Promise(function (resolve, reject) {
			var area = document.createElement('textarea');
			area.value = text;
			area.setAttribute('readonly', '');
			area.style.position = 'fixed';
			area.style.opacity = '0';
			document.body.appendChild(area);
			area.select();
			var ok = false;
			try { ok = document.execCommand('copy'); } catch (e) {}
			area.remove();
			ok ? resolve() : reject(new Error('copy failed'));
		});
	}

	[].forEach.call(document.querySelectorAll('[data-copy]'), function (button) {
		button.addEventListener('click', function () {
			var address = button.getAttribute('data-copy');
			copyText(address).then(function () {
				button.removeAttribute('data-i18n');
				button.textContent = D.t('contact.copied');
				setTimeout(function () { button.setAttribute('data-i18n', 'contact.copy'); button.textContent = D.t('contact.copy'); }, 1800);
			}, function () { window.prompt('Copy this address:', address); });
		});
	});

	var form = document.getElementById('contact-form');
	if (!form) return;
	var status = document.getElementById('c-status');
	var SUBJECTS = {
		blog: 'A question about DSDK Blogs',
		commission: 'Commission inquiry',
		site: 'I would like a website of my own',
		other: 'Hello from the DSDK Blogs site'
	};

	form.addEventListener('submit', function (event) {
		event.preventDefault();
		var name = form.elements.name.value.trim();
		var email = form.elements.email.value.trim();
		var topic = form.elements.topic.value;
		var message = form.elements.message.value.trim();
		if (!message) {
			status.textContent = D.t('contact.needMessage');
			status.hidden = false;
			form.elements.message.focus();
			return;
		}
		status.hidden = true;
		var to = topic === 'blog' || topic === 'other' ? emails.blog : emails.studio;
		var signature = (name ? '\n\n— ' + name : '') + (email ? '\nReply to: ' + email : '');
		window.location.href = 'mailto:' + to + '?subject=' + encodeURIComponent(SUBJECTS[topic] || SUBJECTS.other) +
			'&body=' + encodeURIComponent(message + signature);
	});
})();
