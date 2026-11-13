/* Themed player for raw video files (.mp4 / .webm / .ogv ...) - the ones that are NOT YouTube embeds.
   - big play button, themed control bar (play, scrub with buffer, time, volume, speed, fullscreen)
   - frame takes the video's own shape (vertical clips are no longer squashed into 16:9)
   - keyboard: Space/K play, Left/Right +-5s, Up/Down volume, M mute, F fullscreen
   - friendly message + direct link if the file cannot be played
   DSDK.createVideoPlayer({ src, title, poster }) -> element
   DSDK.upgradeVideos(container)                  -> swaps plain <video src> tags (e.g. inside articles) for this player */
(function () {
	var D = window.DSDK;
	if (!D) return;

	var SPEEDS = [0.75, 1, 1.25, 1.5, 2];
	var ICON = {
		play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
		pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
		replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.6 9.3" class="stroke"/><path d="M5 3.5v5h5" class="stroke"/></svg>',
		vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5z"/><path class="stroke" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/></svg>',
		mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5z"/><path class="stroke" d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
		full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="stroke" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
		exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="stroke" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
	};

	function el(tag, cls, html) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (html) n.innerHTML = html;
		return n;
	}
	function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
	function put(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
	function clock(seconds) {
		if (!isFinite(seconds) || seconds < 0) seconds = 0;
		var s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
		return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
	}
	function button(cls, label, icon) {
		var b = el('button', 'vp__btn ' + cls, icon);
		b.type = 'button';
		b.setAttribute('aria-label', label);
		b.title = label;
		return b;
	}

	function createVideoPlayer(options) {
		var root = el('div', 'vp');
		root.tabIndex = 0;
		root.setAttribute('role', 'group');
		root.setAttribute('aria-label', (options.title || 'Video') + ' player');
		root.setAttribute('data-state', 'paused');

		var video = document.createElement('video');
		video.className = 'vp__video';
		video.preload = 'metadata';
		video.playsInline = true;
		video.setAttribute('playsinline', '');
		video.setAttribute('aria-label', options.title || 'Video');
		if (options.poster) video.poster = options.poster;
		video.src = options.src;

		var big = button('vp__big', 'Play video', ICON.play);
		var spinner = el('span', 'vp__spinner');
		spinner.setAttribute('aria-hidden', 'true');
		var err = el('div', 'vp__error');
		err.setAttribute('role', 'alert');
		err.hidden = true;
		err.innerHTML = '<p>This video could not be played here.</p>';
		var errLink = document.createElement('a');
		errLink.href = options.src;
		errLink.target = '_blank';
		errLink.rel = 'noopener noreferrer';
		errLink.className = 'btn btn--ghost';
		errLink.textContent = 'Open the video file';
		err.appendChild(errLink);

		var bar = el('div', 'vp__bar');
		var playBtn = button('vp__play', 'Play', ICON.play);
		var current = el('span', 'vp__time');
		current.textContent = '0:00';
		var seek = document.createElement('input');
		seek.type = 'range';
		seek.className = 'vp__seek';
		seek.min = '0'; seek.max = '1000'; seek.step = '1'; seek.value = '0';
		seek.setAttribute('aria-label', 'Seek');
		var total = el('span', 'vp__time vp__time--total');
		total.textContent = '0:00';
		var muteBtn = button('vp__mute', 'Mute', ICON.vol);
		var vol = document.createElement('input');
		vol.type = 'range';
		vol.className = 'vp__vol';
		vol.min = '0'; vol.max = '1'; vol.step = '0.05';
		vol.setAttribute('aria-label', 'Volume');
		var speedBtn = button('vp__speed', 'Playback speed', '1×');
		var fullBtn = button('vp__full', 'Full screen', ICON.full);
		[playBtn, current, seek, total, muteBtn, vol, speedBtn, fullBtn].forEach(function (n) { bar.appendChild(n); });

		root.appendChild(video);
		root.appendChild(spinner);
		root.appendChild(big);
		root.appendChild(err);
		root.appendChild(bar);

		/* ----- restore preferences ----- */
		var savedVol = parseFloat(get('dsdk.vp.volume'));
		video.volume = isFinite(savedVol) ? Math.min(1, Math.max(0, savedVol)) : 1;
		video.muted = get('dsdk.vp.muted') === '1';
		vol.value = String(video.muted ? 0 : video.volume);
		var speedIndex = 1;

		function setState(state) { root.setAttribute('data-state', state); }
		function toggle() {
			if (video.ended) video.currentTime = 0;
			if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); } else video.pause();
		}
		function paintSeek() {
			var d = video.duration;
			var pct = d ? (video.currentTime / d) * 100 : 0;
			var buf = 0;
			try { if (video.buffered.length && d) buf = (video.buffered.end(video.buffered.length - 1) / d) * 100; } catch (e) {}
			seek.style.setProperty('--vp-pos', pct + '%');
			seek.style.setProperty('--vp-buf', buf + '%');
		}
		function paintVolume() {
			var level = video.muted ? 0 : video.volume;
			muteBtn.innerHTML = level === 0 ? ICON.mute : ICON.vol;
			var label = level === 0 ? 'Unmute' : 'Mute';
			muteBtn.setAttribute('aria-label', label); muteBtn.title = label;
			vol.style.setProperty('--vp-pos', level * 100 + '%');
			vol.value = String(level);
		}

		video.addEventListener('loadedmetadata', function () {
			total.textContent = clock(video.duration);
			seek.setAttribute('aria-valuetext', '0:00 of ' + clock(video.duration));
			if (video.videoWidth && video.videoHeight) {
				var ratio = video.videoWidth / video.videoHeight;
				ratio = Math.min(2.4, Math.max(0.5625, ratio));
				root.style.setProperty('--vp-ratio', String(ratio));
				root.classList.toggle('vp--tall', ratio < 1);
			}
			paintSeek();
		});
		video.addEventListener('timeupdate', function () {
			current.textContent = clock(video.currentTime);
			if (video.duration) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
			seek.setAttribute('aria-valuetext', clock(video.currentTime) + ' of ' + clock(video.duration));
			paintSeek();
		});
		video.addEventListener('progress', paintSeek);
		video.addEventListener('play', function () { big.innerHTML = ICON.play; big.setAttribute('aria-label', 'Play video'); setState('playing'); playBtn.innerHTML = ICON.pause; playBtn.setAttribute('aria-label', 'Pause'); playBtn.title = 'Pause'; });
		video.addEventListener('pause', function () { if (!video.ended) { setState('paused'); playBtn.innerHTML = ICON.play; playBtn.setAttribute('aria-label', 'Play'); playBtn.title = 'Play'; } });
		video.addEventListener('ended', function () { setState('ended'); playBtn.innerHTML = ICON.replay; playBtn.setAttribute('aria-label', 'Replay'); big.innerHTML = ICON.replay; big.setAttribute('aria-label', 'Replay video'); });
		video.addEventListener('waiting', function () { root.classList.add('is-loading'); });
		['canplay', 'playing', 'loadeddata'].forEach(function (name) { video.addEventListener(name, function () { root.classList.remove('is-loading'); }); });
		video.addEventListener('volumechange', function () {
			paintVolume();
			put('dsdk.vp.volume', String(video.volume));
			put('dsdk.vp.muted', video.muted ? '1' : '0');
		});
		video.addEventListener('error', function () {
			setState('error');
			err.hidden = false;
			root.classList.remove('is-loading');
		});

		/* ----- controls ----- */
		big.addEventListener('click', toggle);
		playBtn.addEventListener('click', toggle);
		video.addEventListener('click', toggle);
		seek.addEventListener('input', function () {
			if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration;
		});
		muteBtn.addEventListener('click', function () {
			if (video.muted || video.volume === 0) { video.muted = false; if (video.volume === 0) video.volume = 0.6; }
			else video.muted = true;
		});
		vol.addEventListener('input', function () {
			video.muted = Number(vol.value) === 0;
			video.volume = Number(vol.value);
		});
		speedBtn.addEventListener('click', function () {
			speedIndex = (speedIndex + 1) % SPEEDS.length;
			video.playbackRate = SPEEDS[speedIndex];
			speedBtn.textContent = SPEEDS[speedIndex] + '×';
			speedBtn.setAttribute('aria-label', 'Playback speed ' + SPEEDS[speedIndex] + ' times');
		});

		function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
		function toggleFullscreen() {
			if (fullscreenElement()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
			var request = root.requestFullscreen || root.webkitRequestFullscreen;
			if (request) request.call(root);
			else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();      /* iPhone Safari */
		}
		fullBtn.addEventListener('click', toggleFullscreen);
		function paintFullscreen() {
			var on = fullscreenElement() === root;
			fullBtn.innerHTML = on ? ICON.exit : ICON.full;
			var label = on ? 'Exit full screen' : 'Full screen';
			fullBtn.setAttribute('aria-label', label); fullBtn.title = label;
			root.classList.toggle('is-fullscreen', on);
		}
		document.addEventListener('fullscreenchange', paintFullscreen);
		document.addEventListener('webkitfullscreenchange', paintFullscreen);

		root.addEventListener('keydown', function (event) {
			if (event.target.closest('input[type="range"]') && /Arrow/.test(event.key)) return;
			if (event.altKey || event.ctrlKey || event.metaKey) return;
			var key = event.key, handled = true;
			if (key === ' ' || key === 'k' || key === 'K') { if (key === ' ' && event.target.closest('button')) return; toggle(); }
			else if (key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
			else if (key === 'ArrowRight') video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
			else if (key === 'ArrowUp') { video.muted = false; video.volume = Math.min(1, video.volume + 0.1); }
			else if (key === 'ArrowDown') video.volume = Math.max(0, video.volume - 0.1);
			else if (key === 'm' || key === 'M') video.muted = !video.muted;
			else if (key === 'f' || key === 'F') toggleFullscreen();
			else handled = false;
			if (handled) event.preventDefault();
		});

		/* ----- auto-hide the control bar while playing ----- */
		var idleTimer = null;
		function wake() {
			root.classList.remove('is-idle');
			clearTimeout(idleTimer);
			if (root.getAttribute('data-state') === 'playing') idleTimer = setTimeout(function () { if (!root.contains(document.activeElement) || document.activeElement === video) root.classList.add('is-idle'); }, 2600);
		}
		['mousemove', 'touchstart', 'keydown', 'focusin'].forEach(function (name) { root.addEventListener(name, wake, { passive: true }); });
		video.addEventListener('play', wake);
		video.addEventListener('pause', wake);
		root.addEventListener('mouseleave', function () { if (root.getAttribute('data-state') === 'playing') root.classList.add('is-idle'); });

		paintVolume();
		paintSeek();
		return root;
	}

	function upgradeVideos(container) {
		[].slice.call(container.querySelectorAll('video')).forEach(function (plain) {
			if (plain.closest('.vp')) return;
			var src = plain.getAttribute('src') || (plain.querySelector('source') && plain.querySelector('source').getAttribute('src'));
			if (!src) return;
			var frame = document.createElement('div');
			frame.className = 'video-frame video-frame--raw';
			frame.appendChild(createVideoPlayer({ src: src, title: plain.getAttribute('aria-label') || plain.getAttribute('title') || 'Video', poster: plain.getAttribute('poster') || '' }));
			var holder = plain.closest('figure') || plain;
			if (holder === plain) plain.replaceWith(frame);
			else { plain.replaceWith(frame); }
		});
	}

	D.createVideoPlayer = createVideoPlayer;
	D.upgradeVideos = upgradeVideos;
})();
