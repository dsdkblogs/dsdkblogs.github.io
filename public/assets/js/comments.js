(function () {
	var endpoint = location.protocol === 'file:'
		? 'https://blog.ankomstudios.com/api/blog-feed'
		: '/api/blog-feed';
	var REACTIONS = ['👍', '❤️', '😂', '🤔'];
	var ROLE_LEVEL = { reader: 0, publisher: 1, editor: 2, admin: 3 };
	var D = window.DSDK;

	function setStatus(element, message, isError) {
		element.textContent = message;
		element.classList.toggle('is-error', Boolean(isError));
		element.hidden = !message;
	}

	function readJsonResponse(response, fallbackMessage) {
		var contentType = (response.headers.get('Content-Type') || '')
			.split(';')[0]
			.trim()
			.toLowerCase();
		var isJson = contentType === 'application/json' || contentType.endsWith('+json');
		var nonJsonMessage = 'The comment service returned a non-JSON response (HTTP ' + response.status +
			'). Check that the blog-site Worker routes /api/blog-feed to the blog-feed Worker.';

		return response.text().then(function (text) {
			var payload = null;
			if (text) {
				try {
					payload = JSON.parse(text);
				} catch (error) {
					if (!isJson) throw new Error(nonJsonMessage);
					throw new Error('The comment service returned invalid JSON (HTTP ' + response.status + ').');
				}
			}
			if (!response.ok) {
				var error = new Error(payload && typeof payload.error === 'string'
					? payload.error
					: (!isJson || !text ? nonJsonMessage : fallbackMessage));
				error.status = response.status;
				error.payload = payload;
				throw error;
			}
			if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
				throw new Error('The comment service returned an empty or invalid JSON response.');
			}
			return payload;
		});
	}

	function relativeTime(value) {
		var timestamp = new Date(value).getTime();
		if (!Number.isFinite(timestamp)) return '';
		var seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
		if (seconds < 60) return 'just now';
		if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
		if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
		var days = Math.floor(seconds / 86400);
		if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
		var months = Math.floor(days / 30);
		if (months < 12) return months + (months === 1 ? ' month ago' : ' months ago');
		var years = Math.floor(months / 12);
		return years + (years === 1 ? ' year ago' : ' years ago');
	}

	/* ---- discussion timer helpers. A thread may have no deadline at all (timer switched off). ---- */
	function hasDeadline(thread) {
		return Boolean(thread && thread.closesAt && thread.mode !== 'off' && Number.isFinite(Date.parse(thread.closesAt)));
	}
	function pad(n) { return (n < 10 ? '0' : '') + n; }
	function toLocalInput(iso) {
		var d = new Date(iso);
		if (!Number.isFinite(d.getTime())) return '';
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
	}

	function createAvatar(author, image) {
		var avatar = document.createElement('span');
		avatar.className = 'comment-avatar';
		avatar.setAttribute('aria-hidden', 'true');
		if (image) {
			var img = document.createElement('img');
			img.src = image;
			img.alt = '';
			img.addEventListener('error', function () { img.remove(); avatar.textContent = (author || '?').trim().charAt(0).toLocaleUpperCase() || '?'; });
			avatar.appendChild(img);
		} else {
			avatar.textContent = (author || '?').trim().charAt(0).toLocaleUpperCase() || '?';
		}
		return avatar;
	}

	function makeReaction(comment, emoji, account, sendReaction) {
		var item = (comment.reactions || []).filter(function (reaction) { return reaction.emoji === emoji; })[0];
		var button = document.createElement('button');
		button.type = 'button';
		button.className = 'comment-reaction' + (item && item.mine ? ' is-selected' : '');
		button.setAttribute('aria-pressed', String(Boolean(item && item.mine)));
		button.setAttribute('aria-label', emoji + ' ' + (item ? item.count : 0));
		button.disabled = !account;
		var icon = document.createElement('span');
		icon.setAttribute('aria-hidden', 'true');
		icon.textContent = emoji;
		var count = document.createElement('span');
		count.textContent = String(item ? item.count : 0);
		button.appendChild(icon);
		button.appendChild(count);
		button.addEventListener('click', function () { sendReaction(comment, item && item.mine ? '' : emoji); });
		return button;
	}

	function nestComments(comments) {
		var byId = new Map();
		comments.forEach(function (comment) { comment.replies = []; byId.set(comment.id, comment); });
		var roots = [];
		comments.forEach(function (comment) {
			var parent = comment.parentCommentId && byId.get(comment.parentCommentId);
			if (parent) parent.replies.push(comment); else roots.push(comment);
		});
		return roots;
	}

	function closeThread(thread, banner, form, notice, authGate, deadline) {
		banner.hidden = false;
		form.hidden = true;
		authGate.hidden = true;
		notice.hidden = true;
		if (deadline) deadline.textContent = hasDeadline(thread) ? 'Comments closed ' + relativeTime(thread.closesAt) + '.' : 'Comments are closed.';
	}

	window.initCommentThread = function (section) {
		var postId = section.getAttribute('data-post-id');
		var banner = section.querySelector('.thread-closed-banner');
		var count = section.querySelector('.comment-count');
		var countLabel = section.querySelector('.comment-count-label');
		var deadline = section.querySelector('.comment-deadline');
		var header = section.querySelector('.comment-header');
		var list = section.querySelector('.comment-list');
		var notice = section.querySelector('.comment-notice');
		var authGate = section.querySelector('#comment-auth');
		var authMount = section.querySelector('#comment-auth-mount');
		var form = section.querySelector('.comment-form');
		var composerId = section.querySelector('#composer-id');
		var status = section.querySelector('#blog-post-status');
		var threadState = null;
		var account = null;
		var deadlineTimer = null;
		var settingsBox = null;

		function canModerate() { return account && ROLE_LEVEL[account.role] >= ROLE_LEVEL.admin; }
		function canSetTimer() { return account && ROLE_LEVEL[account.role] >= ROLE_LEVEL.editor; }

		function requestJson(url, options, fallback) {
			options = options || {};
			options.credentials = 'same-origin';
			options.headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
			return fetch(url, options).then(function (response) {
				return readJsonResponse(response, fallback);
			});
		}

		function isClosed() {
			return !threadState || threadState.closed || (hasDeadline(threadState) && Date.parse(threadState.closesAt) <= Date.now());
		}

		function sendComment(body, parentCommentId, button, replyForm) {
			if (isClosed()) {
				if (threadState) closeThread(threadState, banner, form, notice, authGate, deadline);
				setStatus(status, 'This discussion is closed.', true);
				return Promise.resolve();
			}
			button.disabled = true;
			setStatus(status, 'Posting…', false);
			return requestJson(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ postId: postId, body: body, parentCommentId: parentCommentId || '' })
			}, 'Your comment could not be posted.').then(function (payload) {
				if (!payload.comment || typeof payload.comment !== 'object') throw new Error('The comment service returned an invalid comment.');
				if (replyForm) replyForm.remove(); else form.reset();
				return loadComments().then(function () { setStatus(status, 'Comment posted.', false); });
			}).catch(function (error) {
				if (error.status === 401) {
					account = null;
					if (D) D.setAccount(null);
					setStatus(status, 'Your session ended. Please sign in again to comment.', true);
					return loadComments().then(function () { setStatus(status, 'Your session ended. Please sign in again to comment.', true); });
				}
				if (error.status === 409 && error.payload && error.payload.thread) {
					threadState = error.payload.thread;
					closeThread(threadState, banner, form, notice, authGate, deadline);
					return;
				}
				setStatus(status, error.message || 'Your comment could not be posted. Please try again.', true);
			}).then(function () { button.disabled = false; });
		}

		function toggleReaction(comment, emoji) {
			return requestJson(endpoint + '/reactions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ postId: postId, commentId: comment.id, emoji: emoji })
			}, 'Your reaction could not be saved.').then(loadComments).catch(function (error) {
				setStatus(status, error.message || 'Your reaction could not be saved.', true);
			});
		}

		function togglePin(comment) {
			return requestJson(endpoint + '/comments/' + encodeURIComponent(comment.id) + '/pin', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pinned: !comment.pinned })
			}, 'The pin could not be changed.').then(loadComments).catch(function (error) {
				setStatus(status, error.message || 'The pin could not be changed.', true);
			});
		}

		function createReplyForm(comment) {
			var replyForm = document.createElement('form');
			replyForm.className = 'reply-form';
			var label = document.createElement('label');
			label.textContent = 'Reply to ' + comment.author;
			var area = document.createElement('textarea');
			area.maxLength = 1000;
			area.rows = 2;
			area.required = true;
			var submit = document.createElement('button');
			submit.type = 'submit';
			submit.className = 'btn btn--ghost';
			submit.textContent = 'Post reply';
			replyForm.appendChild(label);
			replyForm.appendChild(area);
			replyForm.appendChild(submit);
			replyForm.addEventListener('submit', function (event) {
				event.preventDefault();
				if (replyForm.reportValidity()) sendComment(area.value.trim(), comment.id, submit, replyForm);
			});
			return replyForm;
		}

		function createCommentCard(comment, isReply) {
			var item = document.createElement('article');
			item.className = 'comment-item' + (comment.pinned ? ' is-pinned' : '') + (isReply ? ' comment-item--reply' : '');
			item.setAttribute('data-comment-id', comment.id);
			item.appendChild(createAvatar(comment.author, comment.profileImage));

			var content = document.createElement('div');
			content.className = 'comment-content';
			var heading = document.createElement('div');
			heading.className = 'comment-author-row';
			var author = document.createElement('h3');
			author.className = 'comment-author';
			author.textContent = comment.author || 'Reader';
			var date = document.createElement('time');
			date.className = 'comment-date';
			date.dateTime = comment.createdAt;
			date.title = new Date(comment.createdAt).toLocaleString();
			date.textContent = relativeTime(comment.createdAt);
			heading.appendChild(author);
			heading.appendChild(date);
			if (comment.pinned) {
				var pinned = document.createElement('span');
				pinned.className = 'comment-pinned-label';
				pinned.textContent = 'Pinned';
				heading.appendChild(pinned);
			}
			var body = document.createElement('p');
			body.className = 'comment-body';
			body.textContent = comment.body;
			content.appendChild(heading);
			content.appendChild(body);

			var actions = document.createElement('div');
			actions.className = 'comment-actions';
			var reactionList = document.createElement('div');
			reactionList.className = 'comment-reactions';
			reactionList.setAttribute('role', 'group');
			reactionList.setAttribute('aria-label', 'React to comment');
			REACTIONS.forEach(function (emoji) { reactionList.appendChild(makeReaction(comment, emoji, account, toggleReaction)); });
			actions.appendChild(reactionList);
			if (account && !isReply && !isClosed()) {
				var reply = document.createElement('button');
				reply.type = 'button';
				reply.className = 'comment-action';
				reply.textContent = 'Reply';
				reply.addEventListener('click', function () {
					var existing = content.querySelector('.reply-form');
					if (existing) { existing.remove(); return; }
					content.appendChild(createReplyForm(comment));
					content.querySelector('.reply-form textarea').focus();
				});
				actions.appendChild(reply);
			}
			if (canModerate()) {
				var pin = document.createElement('button');
				pin.type = 'button';
				pin.className = 'comment-action comment-pin';
				pin.textContent = comment.pinned ? 'Unpin' : 'Pin';
				pin.setAttribute('aria-pressed', String(comment.pinned));
				pin.addEventListener('click', function () { togglePin(comment); });
				actions.appendChild(pin);
			}
			content.appendChild(actions);

			if (comment.replies && comment.replies.length) {
				var repliesToggle = document.createElement('button');
				repliesToggle.type = 'button';
				repliesToggle.className = 'comment-replies-toggle';
				repliesToggle.textContent = comment.replies.length + (comment.replies.length === 1 ? ' reply' : ' replies');
				repliesToggle.setAttribute('aria-expanded', 'false');
				var replies = document.createElement('div');
				replies.className = 'comment-replies';
				replies.hidden = true;
				comment.replies.forEach(function (replyComment) { replies.appendChild(createCommentCard(replyComment, true)); });
				repliesToggle.addEventListener('click', function () {
					replies.hidden = !replies.hidden;
					repliesToggle.setAttribute('aria-expanded', String(!replies.hidden));
				});
				content.appendChild(repliesToggle);
				content.appendChild(replies);
			}
			item.appendChild(content);
			return item;
		}

		function renderComments(comments, totalCount) {
			list.replaceChildren();
			nestComments(comments).forEach(function (comment) { list.appendChild(createCommentCard(comment, false)); });
			count.textContent = String(Number.isFinite(totalCount) ? totalCount : comments.length);
			countLabel.textContent = totalCount === 1 ? 'Comment' : 'Comments';
			notice.hidden = comments.length !== 0;
			if (!comments.length) notice.textContent = account ? 'Be the first to comment.' : 'No comments yet. Sign in or create an account to start the conversation.';
		}

		/* ---- who is commenting (avatar + name above the box) ---- */
		function renderComposerIdentity() {
			composerId.replaceChildren();
			if (!account) return;
			var name = account.displayName || account.username;
			composerId.appendChild(createAvatar(name, account.profileImage));
			var text = document.createElement('p');
			text.className = 'composer-id__text';
			var lead = document.createElement('span');
			lead.textContent = 'Commenting as ';
			var strong = document.createElement('strong');
			strong.textContent = name;
			text.appendChild(lead);
			text.appendChild(strong);
			if (account.displayName && account.displayName !== account.username) {
				var handle = document.createElement('span');
				handle.className = 'manage-meta';
				handle.textContent = ' @' + account.username;
				text.appendChild(handle);
			}
			composerId.appendChild(text);
			var edit = document.createElement('a');
			edit.className = 'link-btn';
			edit.href = (D ? D.root : '') + 'manage.html';
			edit.textContent = 'Edit profile';
			var out = document.createElement('button');
			out.type = 'button';
			out.className = 'link-btn';
			out.textContent = 'Sign out';
			out.addEventListener('click', function () {
				out.disabled = true;
				D.api('accounts/logout', { method: 'POST' }).catch(function () {}).then(function () {
					D.setAccount(null);
					return loadComments();
				});
			});
			var tools = document.createElement('span');
			tools.className = 'composer-id__tools';
			tools.appendChild(edit);
			tools.appendChild(out);
			composerId.appendChild(tools);
		}

		/* ---- discussion timer ---- */
		function checkDeadline() {
			clearTimeout(deadlineTimer);
			if (!threadState || threadState.closed || !hasDeadline(threadState)) return;
			var remaining = Date.parse(threadState.closesAt) - Date.now();
			if (remaining <= 0) {
				threadState.closed = true;
				closeThread(threadState, banner, form, notice, authGate, deadline);
			} else deadlineTimer = window.setTimeout(checkDeadline, Math.min(remaining + 25, 2147483647));
		}

		function deadlineText() {
			if (threadState.closed) return 'This discussion has ended.';
			if (!hasDeadline(threadState)) return 'This discussion has no closing date.';
			return 'This discussion closes ' + new Date(threadState.closesAt).toLocaleDateString() + '.';
		}

		function renderTimerSettings() {
			var wasOpen = Boolean(settingsBox && settingsBox.open);
			if (settingsBox) { settingsBox.remove(); settingsBox = null; }
			if (!canSetTimer() || !threadState) return;
			var live = Boolean(D && D.feature('threadTimer'));
			var mode = threadState.mode || (hasDeadline(threadState) ? 'default' : 'off');

			settingsBox = document.createElement('details');
			settingsBox.className = 'thread-settings';
			settingsBox.open = wasOpen;
			var summary = document.createElement('summary');
			summary.textContent = 'Discussion timer (admin)';
			settingsBox.appendChild(summary);

			var f = document.createElement('form');
			f.className = 'thread-settings__form';
			var options = [
				['default', 'Default: close 14 days after the post was published'],
				['off', 'No timer: this discussion never closes'],
				['custom', 'Close on a date I choose (also reopens a closed discussion)']
			];
			options.forEach(function (opt) {
				var row = document.createElement('label');
				row.className = 'auth-check';
				var radio = document.createElement('input');
				radio.type = 'radio';
				radio.name = 'timer-mode';
				radio.value = opt[0];
				radio.checked = opt[0] === mode;
				row.appendChild(radio);
				row.appendChild(document.createTextNode(' ' + opt[1]));
				f.appendChild(row);
			});
			var dateLabel = document.createElement('label');
			dateLabel.textContent = 'Close date and time';
			dateLabel.htmlFor = 'timer-custom-date';
			var date = document.createElement('input');
			date.type = 'datetime-local';
			date.id = 'timer-custom-date';
			date.value = hasDeadline(threadState) ? toLocalInput(threadState.closesAt) : '';
			f.appendChild(dateLabel);
			f.appendChild(date);
			var save = document.createElement('button');
			save.type = 'submit';
			save.className = 'btn btn--ghost';
			save.textContent = 'Save timer';
			save.disabled = !live;
			f.appendChild(save);
			var note = document.createElement('p');
			note.className = 'manage-meta';
			note.setAttribute('role', 'status');
			note.textContent = live ? '' : 'Timer controls switch on once the backend update is deployed (see features.threadTimer in config.js).';
			f.appendChild(note);
			function syncDate() {
				var chosen = f.querySelector('input[name="timer-mode"]:checked');
				var custom = chosen && chosen.value === 'custom';
				date.disabled = !custom;
				dateLabel.classList.toggle('is-disabled', !custom);
			}
			f.addEventListener('change', syncDate);
			syncDate();
			f.addEventListener('submit', function (event) {
				event.preventDefault();
				var chosen = f.querySelector('input[name="timer-mode"]:checked');
				var picked = chosen ? chosen.value : 'default';
				var payload = { postId: postId, mode: picked };
				if (picked === 'custom') {
					var when = new Date(date.value);
					if (!date.value || !Number.isFinite(when.getTime())) { note.textContent = 'Choose a close date and time.'; return; }
					if (when.getTime() <= Date.now()) { note.textContent = 'Pick a date and time in the future.'; return; }
					payload.closesAt = when.toISOString();
				}
				save.disabled = true;
				note.textContent = 'Saving…';
				requestJson(endpoint + '/thread', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				}, 'The timer could not be saved.').then(function (result) {
					if (result.thread) threadState = result.thread;
					return loadComments().then(function () { setStatus(status, 'Discussion timer saved.', false); });
				}).catch(function (error) {
					note.textContent = error.message || 'The timer could not be saved.';
					save.disabled = false;
				});
			});
			settingsBox.appendChild(f);
			header.appendChild(settingsBox);
		}

		function loadComments() {
			setStatus(status, 'Loading discussion…', false);
			return requestJson(endpoint + '?postId=' + encodeURIComponent(postId), null, 'Comments could not be loaded.')
				.then(function (payload) {
					if (!Array.isArray(payload.comments) || !payload.thread) throw new Error('The comment service returned an invalid thread.');
					threadState = payload.thread;
					account = payload.account || null;
					if (D) D.setAccount(account);
					renderComments(payload.comments, payload.totalCount);
					renderComposerIdentity();
					deadline.textContent = deadlineText();
					if (threadState.closed) closeThread(threadState, banner, form, notice, authGate, deadline);
					else {
						banner.hidden = true;
						form.hidden = !account;
						authGate.hidden = Boolean(account);
						checkDeadline();
					}
					renderTimerSettings();
					setStatus(status, '', false);
				}).catch(function (error) {
					setStatus(status, error.message || 'Comments could not be loaded. Please refresh to try again.', true);
				});
		}

		if (authMount && D && D.auth) {
			D.auth.mount(authMount, {
				layout: 'tabs',
				start: 'signup',
				onAuth: function () { loadComments().then(function () { setStatus(status, 'You’re in! Say something nice.', false); status.classList.remove('is-error'); var box = form.querySelector('textarea'); if (box && !form.hidden) box.focus(); }); }
			});
		}

		form.addEventListener('submit', function (event) {
			event.preventDefault();
			if (form.reportValidity()) sendComment(form.elements.body.value.trim(), '', form.querySelector('button[type="submit"]'), null);
		});

		loadComments();
	};
})();
