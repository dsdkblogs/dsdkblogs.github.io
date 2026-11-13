/* Account, role, and video management for the DSDK Blogs Worker APIs. */
(function () {
	var D = window.DSDK;
	if (!D) return;

	var ROLE_LEVEL = { reader: 0, publisher: 1, editor: 2, admin: 3 };
	var signedOut = document.getElementById('signed-out');
	var signedIn = document.getElementById('signed-in');
	var status = document.getElementById('manage-status');
	var displayNameInput = document.getElementById('profile-display-name');
	var profileImageInput = document.getElementById('profile-image');
	var profileAvatar = document.getElementById('profile-avatar');
	var profileAvatarImage = null;
	var profileAvatarInitials = document.getElementById('profile-avatar-initials');
	var profileUploadInput = document.getElementById('profile-upload');
	var profileImageStatus = document.getElementById('profile-image-status');
	var cropPanel = document.getElementById('profile-crop-panel');
	var cropCanvas = document.getElementById('profile-crop-canvas');
	var cropApplyButton = document.getElementById('profile-crop-apply');
	var cropper = null;
	var cropImage = null;
	var cropObjectUrl = '';
	var pendingProfileImage = '';
	var MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
	var MAX_PROFILE_DATA_URL_LENGTH = 360000;
	var account = null;

	function say(message, isError) {
		status.textContent = message || '';
		status.classList.toggle('is-error', Boolean(isError));
	}

	async function api(path, options) {
		options = options || {};
		options.credentials = 'same-origin';
		options.headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
		var response = await fetch(D.root + 'api/' + path, options);
		var payload;
		try { payload = await response.json(); } catch (error) { throw new Error('The server returned an invalid response.'); }
		if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'The request could not be completed.');
		return payload;
	}

	function jsonOptions(method, value) {
		return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
	}

	function updateProfilePreview(name, image) {
		var displayName = (name || account && account.username || '?').trim();
		profileAvatarInitials.textContent = displayName.charAt(0).toLocaleUpperCase() || '?';
		if (image) {
			if (!profileAvatarImage) {
				profileAvatarImage = document.createElement('img');
				profileAvatarImage.alt = '';
				profileAvatarImage.addEventListener('error', function () {
					profileAvatarImage.hidden = true;
					profileAvatarInitials.hidden = false;
				});
				profileAvatar.insertBefore(profileAvatarImage, profileAvatarInitials);
			}
			if (profileAvatarImage.getAttribute('src') !== image) profileAvatarImage.src = image;
			profileAvatarImage.hidden = false;
			profileAvatarInitials.hidden = true;
		} else {
			if (profileAvatarImage) {
				profileAvatarImage.remove();
				profileAvatarImage = null;
			}
			profileAvatarInitials.hidden = false;
		}
	}

	function closeCropper() {
		if (cropper) cropper.destroy();
		cropper = null;
		cropImage = null;
		cropCanvas.replaceChildren();
		cropPanel.hidden = true;
		cropApplyButton.disabled = true;
		if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl);
		cropObjectUrl = '';
	}

	function compressedDataUrl(source) {
		var qualities = [0.84, 0.76, 0.68, 0.60, 0.52];
		for (var scale = 1, attempt = 0; attempt < 12; attempt++, scale *= 0.85) {
			var width = Math.max(1, Math.floor(source.width * scale));
			var height = Math.max(1, Math.floor(source.height * scale));
			var canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			var context = canvas.getContext('2d');
			context.fillStyle = '#fff';
			context.fillRect(0, 0, width, height);
			context.drawImage(source, 0, 0, width, height);
			for (var index = 0; index < qualities.length; index++) {
				var dataUrl = canvas.toDataURL('image/webp', qualities[index]);
				if (dataUrl.indexOf('data:image/webp;base64,') !== 0) dataUrl = canvas.toDataURL('image/jpeg', qualities[index]);
				if (dataUrl.length <= MAX_PROFILE_DATA_URL_LENGTH) return dataUrl;
			}
		}
		throw new Error('This image is still too large after compression. Choose a smaller image.');
	}

	function beginCrop(file) {
		if (!file) return;
		if (!window.Cropper) {
			profileImageStatus.textContent = 'The image cropper could not load. Use an HTTPS image URL instead.';
			return;
		}
		if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
			profileImageStatus.textContent = 'Choose a JPEG, PNG, or WebP image.';
			profileUploadInput.value = '';
			return;
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			profileImageStatus.textContent = 'Choose an image smaller than 15 MB.';
			profileUploadInput.value = '';
			return;
		}

		closeCropper();
		cropImage = document.createElement('img');
		cropImage.alt = 'Image crop preview';
		cropImage.addEventListener('load', function () {
			cropper = new window.Cropper(cropImage, {
				aspectRatio: 1,
				viewMode: 1,
				autoCropArea: 0.9,
				background: false,
				responsive: true,
				zoomable: true,
				movable: true
			});
			cropApplyButton.disabled = false;
		}, { once: true });
		cropImage.addEventListener('error', function () {
			profileImageStatus.textContent = 'This image could not be opened.';
			closeCropper();
		}, { once: true });
		cropCanvas.replaceChildren(cropImage);
		cropPanel.hidden = false;
		cropApplyButton.disabled = true;
		cropObjectUrl = URL.createObjectURL(file);
		cropImage.src = cropObjectUrl;
		profileImageStatus.textContent = '';
	}

	function showAccount(nextAccount) {
		account = nextAccount;
		signedOut.hidden = Boolean(account);
		signedIn.hidden = !account;
		if (!account) return;
		document.getElementById('account-name').textContent = account.displayName || account.username;
		document.getElementById('account-username').textContent = '@' + account.username;
		document.getElementById('account-role').textContent = account.role;
		displayNameInput.value = account.displayName === account.username ? '' : account.displayName || '';
		pendingProfileImage = /^data:image\/(?:webp|jpeg|png);base64,/.test(account.profileImage || '') ? account.profileImage : '';
		profileImageInput.value = pendingProfileImage ? '' : account.profileImage || '';
		profileImageStatus.textContent = pendingProfileImage ? 'Uploaded profile image saved.' : '';
		updateProfilePreview(account.displayName || account.username, pendingProfileImage || account.profileImage || '');
		var tools = document.getElementById('tools');
		[].forEach.call(tools.querySelectorAll('[data-min-role]'), function (item) {
			item.hidden = ROLE_LEVEL[account.role] < ROLE_LEVEL[item.getAttribute('data-min-role')];
		});
		tools.hidden = ROLE_LEVEL[account.role] < ROLE_LEVEL.publisher;
		loadVideos();
	}

	async function loadAccount() {
		try {
			var result = await api('accounts/me');
			showAccount(result.account);
		} catch (error) {
			showAccount(null);
		}
	}

	D.auth.mount(document.getElementById('auth-mount'), {
		layout: 'grid',
		onAuth: function (nextAccount) { say(''); showAccount(nextAccount); }
	});

	document.getElementById('logout-button').addEventListener('click', async function () {
		try { await api('accounts/logout', { method: 'POST' }); showAccount(null); say('Signed out.'); }
		catch (error) { say(error.message, true); }
	});

	displayNameInput.addEventListener('input', function () {
		updateProfilePreview(displayNameInput.value || account && account.username, pendingProfileImage || profileImageInput.value.trim());
	});
	profileImageInput.addEventListener('input', function () {
		pendingProfileImage = '';
		updateProfilePreview(displayNameInput.value || account && account.username, profileImageInput.value.trim());
	});
	profileUploadInput.addEventListener('change', function () { beginCrop(profileUploadInput.files[0]); });
	document.getElementById('profile-crop-cancel').addEventListener('click', function () {
		closeCropper();
		profileUploadInput.value = '';
		profileImageStatus.textContent = 'Crop cancelled.';
	});
	cropApplyButton.addEventListener('click', function () {
		if (!cropper) return;
		try {
			var cropped = cropper.getCroppedCanvas({
				maxWidth: 750,
				maxHeight: 750,
				fillColor: '#fff',
				imageSmoothingEnabled: true,
				imageSmoothingQuality: 'high'
			});
			if (!cropped) throw new Error('This image could not be cropped.');
			pendingProfileImage = compressedDataUrl(cropped);
			profileImageInput.value = '';
			profileUploadInput.value = '';
			updateProfilePreview(displayNameInput.value || account.username, pendingProfileImage);
			profileImageStatus.textContent = 'Cropped image ready. Save profile to apply.';
			closeCropper();
		} catch (error) { profileImageStatus.textContent = error.message; }
	});
	document.getElementById('profile-image-remove').addEventListener('click', function () {
		pendingProfileImage = '';
		profileImageInput.value = '';
		profileUploadInput.value = '';
		updateProfilePreview(displayNameInput.value || account.username, '');
		profileImageStatus.textContent = 'Image removal will apply when you save.';
	});
	document.getElementById('profile-form').addEventListener('submit', async function (event) {
		event.preventDefault();
		var form = event.currentTarget;
		if (!form.reportValidity()) return;
		var value = Object.fromEntries(new FormData(form).entries());
		value.profileImage = pendingProfileImage || value.profileImage || '';
		try {
			var result = await api('accounts/me', jsonOptions('PATCH', value));
			showAccount(result.account);
			say('Profile saved.');
		} catch (error) { say(error.message, true); }
	});

	async function loadVideos() {
		var list = document.getElementById('managed-videos');
		list.replaceChildren();
		try {
			var result = await api('posts');
			var posts = result.posts.filter(function (post) { return post.videoId || post.videoSrc || post.type === 'Article'; });
			posts.forEach(function (post) {
				var item = document.createElement('li');
				var link = document.createElement('a');
				link.href = post.pageUrl ? D.root + post.pageUrl : D.postUrl(post);
				link.textContent = post.title;
				item.appendChild(link);
				var meta = document.createElement('span');
				meta.className = 'manage-meta';
				var kind = post.type === 'Article' ? 'article' : 'video';
				meta.textContent = post.authorId ? ' · ' + (post.authorId === account.id ? 'yours' : 'managed ' + kind) : ' · site ' + kind;
				item.appendChild(meta);
				var canDelete = post.authorId
					? post.authorId === account.id || ROLE_LEVEL[account.role] >= ROLE_LEVEL.editor
					: ROLE_LEVEL[account.role] >= ROLE_LEVEL.editor;
				if (post.type === 'Article' && canDelete) {
					var edit = document.createElement('a');
					edit.className = 'link-btn';
					edit.href = D.root + 'write.html?edit=' + encodeURIComponent(post.id);
					edit.textContent = 'Edit';
					item.appendChild(edit);
				}
				if (ROLE_LEVEL[account.role] >= ROLE_LEVEL.admin) {
					var lab = document.createElement('a');
					lab.className = 'link-btn';
					lab.href = D.root + 'editor.html?target=' + encodeURIComponent('post:' + post.id);
					lab.textContent = 'Customize page';
					item.appendChild(lab);
				}
				if (canDelete) {
					var remove = document.createElement('button');
					remove.type = 'button';
					remove.className = 'link-btn manage-delete';
					remove.textContent = 'Delete';
					remove.setAttribute('aria-label', 'Delete ' + post.title);
					remove.addEventListener('click', async function () {
						if (!window.confirm('Delete “' + post.title + '” and its comments?')) return;
						try {
							await api('posts/' + encodeURIComponent(post.id), { method: 'DELETE' });
							item.remove(); say('Post deleted.');
						} catch (error) { say(error.message, true); }
					});
					item.appendChild(remove);
				}
				list.appendChild(item);
			});
			if (!posts.length) {
				var empty = document.createElement('li');
				empty.textContent = 'Nothing has been published yet.';
				list.appendChild(empty);
			}
		} catch (error) { say(error.message, true); }
	}

	loadAccount();
})();
