/* Dedicated role-gated video publishing flow. */
(function () {
	var D = window.DSDK;
	if (!D) return;

	var ROLE_LEVEL = { reader: 0, publisher: 1, editor: 2, admin: 3 };
	var authStatus = document.getElementById('publish-auth-status');
	var gate = document.getElementById('publish-gate');
	var gateMessage = document.getElementById('publish-gate-message');
	var form = document.getElementById('post-form');
	var status = document.getElementById('publish-status');
	var statusMark = document.getElementById('publish-status-mark');
	var statusMessage = document.getElementById('publish-status-message');
	var resultLink = document.getElementById('publish-result-link');
	var submit = document.getElementById('publish-submit');
	var submitLabel = document.getElementById('publish-submit-label');
	var spinner = document.getElementById('publish-spinner');
	var titleInput = document.getElementById('post-title');
	var idInput = document.getElementById('post-id');
	var active = false;

	function showStatus(kind, message, post) {
		status.hidden = false;
		status.className = 'publish-status is-' + kind;
		statusMessage.textContent = message;
		statusMark.textContent = '';
		resultLink.hidden = !post;
		resultLink.removeAttribute('href');
		if (post) {
			resultLink.href = D.root + (post.pageUrl || 'post.html?id=' + encodeURIComponent(post.id));
			resultLink.textContent = 'View published post';
		}
	}

	function resetButton() {
		submit.disabled = false;
		submit.setAttribute('aria-busy', 'false');
		spinner.hidden = true;
		submitLabel.textContent = 'Publish video';
		submit.classList.remove('is-success');
	}

	async function loadPublishingAccess() {
		try {
			var response = await fetch(D.root + 'api/accounts/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
			var payload = await response.json();
			if (!response.ok || !payload.account) {
				gateMessage.textContent = 'Sign in with a publishing-enabled account to create a post.';
				gate.hidden = false;
				return;
			}
			if (ROLE_LEVEL[payload.account.role] < ROLE_LEVEL.publisher) {
				gateMessage.textContent = 'Your account does not have video publishing access.';
				gate.hidden = false;
				return;
			}
			form.hidden = false;
		} catch (error) {
			gateMessage.textContent = 'Could not verify publishing access. Refresh the page to try again.';
			gate.hidden = false;
		} finally {
			authStatus.hidden = true;
		}
	}

	titleInput.addEventListener('input', function () {
		idInput.value = titleInput.value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
	});

	form.addEventListener('input', function () {
		if (status.classList.contains('is-success')) {
			status.hidden = true;
			resetButton();
		}
	});

	form.addEventListener('submit', async function (event) {
		event.preventDefault();
		if (active || !form.reportValidity()) return;
		var value = Object.fromEntries(new FormData(form).entries());
		value.tags = value.tags.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
		status.hidden = true;
		resultLink.hidden = true;
		active = true;
		submit.disabled = true;
		submit.setAttribute('aria-busy', 'true');
		submitLabel.textContent = 'Publishing…';
		spinner.hidden = false;
		try {
			const response = await fetch(D.root + 'api/posts', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				body: JSON.stringify(value)
			});
			var payload;
			try { payload = await response.json(); }
			catch (error) { throw new Error('The server returned an invalid response. Refresh and try again.'); }
			if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'The post could not be published. Try again.');
			form.reset();
			idInput.value = '';
			showStatus('success', 'Your video is published.', payload.post);
			submit.disabled = false;
			submit.setAttribute('aria-busy', 'false');
			spinner.hidden = true;
			submitLabel.textContent = 'Published';
			submit.classList.add('is-success');
		} catch (error) {
			showStatus('error', error.message || 'The post could not be published. Try again.');
			resetButton();
		} finally {
			active = false;
		}
	});

	loadPublishingAccess();
})();
