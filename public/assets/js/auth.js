/* Sign in / create account forms, shared by the Account page and the comment section.

   Why sign-up used to "do nothing": the server only accepts usernames of 3-32 letters, numbers, "_" or "-",
   but the form allowed anything. Rejections were shown once, in a status line above both forms (often off-screen),
   and showed a vague message. These forms now check the rules in the browser, explain them next to the field,
   show the result right under the button, and disable the button while the request runs.

   DSDK.auth.mount(container, { layout: 'grid' | 'tabs', start: 'signin' | 'signup', onAuth: function (account) {} }) */
(function () {
	var D = window.DSDK;
	if (!D) return;

	var USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$/;
	var USERNAME_HINT = '3–32 characters: letters, numbers, underscores or hyphens. No spaces or dots.';
	var PASSWORD_HINT = 'At least 12 characters.';
	var uid = 0;

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	function field(form, spec) {
		var id = 'auth-' + (++uid) + '-' + spec.name;
		var wrap = el('div', 'auth-field');
		var label = el('label', '', spec.label);
		label.htmlFor = id;
		var input = document.createElement('input');
		input.id = id;
		input.name = spec.name;
		input.type = spec.type || 'text';
		input.required = true;
		input.autocomplete = spec.autocomplete;
		if (spec.maxLength) input.maxLength = spec.maxLength;
		if (spec.name === 'username') { input.autocapitalize = 'none'; input.spellcheck = false; input.setAttribute('autocorrect', 'off'); }
		wrap.appendChild(label);
		wrap.appendChild(input);
		if (spec.hint) {
			var hint = el('p', 'auth-hint', spec.hint);
			hint.id = id + '-hint';
			input.setAttribute('aria-describedby', hint.id);
			wrap.appendChild(hint);
		}
		form.appendChild(wrap);
		return { wrap: wrap, input: input };
	}

	function showPasswordToggle(form, passwordInput) {
		var row = el('label', 'auth-check');
		var box = document.createElement('input');
		box.type = 'checkbox';
		box.addEventListener('change', function () { passwordInput.type = box.checked ? 'text' : 'password'; });
		row.appendChild(box);
		row.appendChild(document.createTextNode(' Show password'));
		form.appendChild(row);
	}

	function buildForm(kind, onAuth) {
		var signup = kind === 'signup';
		var form = el('form', 'manage-form auth-form');
		form.noValidate = true;                                  /* we show our own, visible messages */
		form.setAttribute('data-auth', kind);
		form.appendChild(el('h2', '', signup ? 'Create an account' : 'Sign in'));
		if (signup) form.appendChild(el('p', 'auth-intro', 'Free, takes a few seconds. Your username and profile picture appear next to your comments.'));

		var user = field(form, { name: 'username', label: 'Username', autocomplete: 'username', maxLength: 32, hint: signup ? USERNAME_HINT : '' });
		var pass = field(form, { name: 'password', label: signup ? 'Password' : 'Password', type: 'password', autocomplete: signup ? 'new-password' : 'current-password', maxLength: 128, hint: signup ? PASSWORD_HINT : '' });
		showPasswordToggle(form, pass.input);

		var submit = el('button', 'btn' + (signup ? '' : ' btn--ghost'));
		submit.type = 'submit';
		var label = el('span', '', signup ? 'Create account' : 'Sign in');
		var spinner = el('span', 'publish-spinner');
		spinner.setAttribute('aria-hidden', 'true');
		spinner.hidden = true;
		submit.appendChild(label);
		submit.appendChild(spinner);
		form.appendChild(submit);

		var status = el('p', 'auth-status');
		status.setAttribute('role', 'alert');
		status.hidden = true;
		form.appendChild(status);

		function say(message, isError) {
			status.textContent = message || '';
			status.hidden = !message;
			status.classList.toggle('is-error', Boolean(isError));
			if (message && isError && status.scrollIntoView) status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
		function busy(on) {
			submit.disabled = on;
			submit.setAttribute('aria-busy', on ? 'true' : 'false');
			spinner.hidden = !on;
			label.textContent = on ? (signup ? 'Creating account…' : 'Signing in…') : (signup ? 'Create account' : 'Sign in');
		}
		function invalid(input, message) {
			input.setAttribute('aria-invalid', 'true');
			say(message, true);
			input.focus();
		}
		[user.input, pass.input].forEach(function (input) {
			input.addEventListener('input', function () { input.removeAttribute('aria-invalid'); if (status.classList.contains('is-error')) say(''); });
		});
		if (signup) {
			user.input.addEventListener('input', function () {
				var v = user.input.value;
				user.wrap.classList.toggle('is-bad', v.length > 0 && !USERNAME_RE.test(v));
			});
		}

		form.addEventListener('submit', function (event) {
			event.preventDefault();
			if (submit.disabled) return;
			var username = user.input.value.trim();
			var password = pass.input.value;
			user.input.value = username;
			if (!username) return invalid(user.input, 'Enter a username.');
			if (signup && !USERNAME_RE.test(username)) return invalid(user.input, 'That username won’t work. ' + USERNAME_HINT);
			if (!password) return invalid(pass.input, 'Enter a password.');
			if (signup && (password.length < 12 || password.length > 128)) return invalid(pass.input, 'Passwords need 12 to 128 characters.');
			busy(true);
			say('');
			D.api(signup ? 'accounts/register' : 'accounts/login', { method: 'POST', json: { username: username, password: password } })
				.then(function (payload) {
					form.reset();
					D.setAccount(payload.account);
					say(signup ? 'Welcome! Your account is ready.' : 'Signed in.', false);
					if (onAuth) onAuth(payload.account, kind);
				})
				.catch(function (error) {
					var message = error.message;
					if (error.status === 400 && signup) message = 'That didn’t go through. ' + USERNAME_HINT + ' Passwords need 12 to 128 characters.';
					else if (error.status === 409) message = 'That username is taken. Try another one, or sign in if it’s yours.';
					else if (error.status === 401) message = 'Username or password is incorrect.';
					else if (error.status === 429) message = 'Too many attempts. Please wait a bit and try again.';
					else if (error.offline) message = 'We couldn’t reach the server. Check your connection and try again.';
					say(message, true);
				})
				.then(function () { busy(false); });
		});
		return form;
	}

	function mount(container, options) {
		options = options || {};
		container.replaceChildren();
		var signin = buildForm('signin', options.onAuth);
		var signup = buildForm('signup', options.onAuth);

		if (options.layout === 'tabs') {
			var box = el('div', 'auth-tabs');
			var list = el('div', 'auth-tablist');
			list.setAttribute('role', 'tablist');
			var tabs = {};
			function select(which) {
				Object.keys(tabs).forEach(function (key) {
					var on = key === which;
					tabs[key].btn.setAttribute('aria-selected', String(on));
					tabs[key].btn.tabIndex = on ? 0 : -1;
					tabs[key].form.hidden = !on;
				});
			}
			[['signin', 'Sign in', signin], ['signup', 'Create account', signup]].forEach(function (item) {
				var btn = el('button', 'auth-tab', item[1]);
				btn.type = 'button';
				btn.setAttribute('role', 'tab');
				btn.addEventListener('click', function () { select(item[0]); });
				list.appendChild(btn);
				tabs[item[0]] = { btn: btn, form: item[2] };
				item[2].setAttribute('role', 'tabpanel');
			});
			list.addEventListener('keydown', function (event) {
				if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
				var next = tabs.signin.btn.getAttribute('aria-selected') === 'true' ? 'signup' : 'signin';
				select(next);
				tabs[next].btn.focus();
			});
			box.appendChild(list);
			box.appendChild(signin);
			box.appendChild(signup);
			container.appendChild(box);
			select(options.start === 'signup' ? 'signup' : 'signin');
		} else {
			var grid = el('div', 'manage-auth-grid');
			grid.appendChild(signin);
			grid.appendChild(signup);
			container.appendChild(grid);
		}
	}

	D.auth = { mount: mount, USERNAME_RE: USERNAME_RE };
})();
