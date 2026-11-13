/* Single post page: fills the article from blog-posts.json, embeds the video,
   starts the comment thread (comments.js) and lists a few other posts. */
(function () {
	var D = window.DSDK;
	var postId = document.body.getAttribute('data-post-id') || new URLSearchParams(location.search).get('id');
	var title = document.getElementById('blog-post-title');
	var description = document.getElementById('blog-post-description');
	var player = document.getElementById('blog-post-player');
	var published = document.getElementById('blog-post-date');
	var category = document.getElementById('blog-post-category');
	var crumb = document.getElementById('breadcrumb-current');
	var tagsList = document.getElementById('blog-post-tags');
	var comments = document.getElementById('comment-thread');
	var status = document.getElementById('blog-post-status');
	var more = document.getElementById('more-posts');
	var moreGrid = document.getElementById('more-posts-grid');

	if (!D || !postId || !title || !description || !player || !comments) return;

	function showError(key) {
		status.textContent = D.t(key);
		status.hidden = false;
	}

	function embeddedVideoId(post) {
		if (typeof post.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(post.videoId)) return post.videoId;
		if (typeof post.embedSrc !== 'string') return '';
		try {
			var source = new URL(post.embedSrc);
			if (!/^(www\.)?(youtube-nocookie\.com|youtube\.com)$/.test(source.hostname) || !source.pathname.startsWith('/embed/')) return '';
			var id = source.pathname.slice(7).split('/')[0];
			return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
		} catch (error) { return ''; }
	}

	function normalise(post) {
		return {
			id: post.id, title: post.title, description: post.description, publishedAt: post.publishedAt,
			type: typeof post.type === 'string' ? post.type : 'Post',
			videoId: embeddedVideoId(post),
			videoSrc: typeof post.videoSrc === 'string' ? post.videoSrc : '',
			pageUrl: typeof post.pageUrl === 'string' ? post.pageUrl : '',
			image: typeof post.image === 'string' ? post.image : '',
			imageAlt: typeof post.imageAlt === 'string' ? post.imageAlt : '',
			category: typeof post.category === 'string' ? post.category : 'Uncategorized',
			tags: Array.isArray(post.tags) ? post.tags.filter(function (tag) { return typeof tag === 'string'; }) : []
		};
	}

	function renderMore(post, all) {
		if (!more || !moreGrid) return;
		var related = all.filter(function (other) { return other.id !== post.id; }).map(function (other) {
			var shared = other.tags.filter(function (tag) { return post.tags.indexOf(tag) !== -1; }).length;
			return { post: other, shared: shared };
		}).sort(function (a, b) {
			return b.shared - a.shared || Date.parse(b.post.publishedAt) - Date.parse(a.post.publishedAt);
		}).slice(0, 3);
		if (!related.length) return;
		related.forEach(function (item) { moreGrid.appendChild(D.createCard(item.post, '', {})); });
		more.hidden = false;
	}

	/* Static "docs style" article: sanitized HTML written in write.html, with its own CSS limited to the article. */
	function renderArticle(post) {
		var body = document.getElementById('article-body');
		player.hidden = true;
		if (!body) return;
		function message(text) {
			var p = document.createElement('p');
			p.className = 'comment-status';
			p.textContent = text;
			body.replaceChildren(p);
			body.hidden = false;
		}
		if (!D.feature('articles') || !D.sanitizeHtml) { message('This article cannot be shown until the article backend is connected.'); return; }
		D.api('articles/' + encodeURIComponent(post.id)).then(function (payload) {
			var article = payload.article || {};
			var clean = D.sanitizeHtml(article.bodyHtml || '', { allowStyle: true });
			body.replaceChildren();
			if (post.image) {
				var figure = document.createElement('figure');
				figure.className = 'article-cover';
				var cover = document.createElement('img');
				cover.src = D.assetUrl(post.image);
				cover.alt = post.imageAlt || '';
				figure.appendChild(cover);
				body.appendChild(figure);
			}
			var content = document.createElement('div');
			content.className = 'article-body__content';
			content.innerHTML = clean.html;
			body.appendChild(content);
			if (article.css) {
				var styled = D.scopeCss(D.sanitizeCss(article.css).css, '.article-body');
				var style = document.createElement('style');
				style.setAttribute('data-article-css', '');
				style.textContent = styled;
				document.head.appendChild(style);
			}
			if (D.upgradeVideos) D.upgradeVideos(content);
			body.hidden = false;
		}).catch(function () { message('This article could not be loaded. Please try again shortly.'); });
	}

	D.loadFeed().then(function (feed) {
			var all = feed.filter(function (item) { return item && typeof item.id === 'string'; }).map(normalise);
			var post = all.find(function (item) { return item.id === postId; });
			if (!post) throw new Error('post.errorMissing');

			document.title = post.title + ' | DSDK Blogs';
			title.textContent = post.title;
			if (crumb) crumb.textContent = post.title;
			description.textContent = post.description;
			if (category) category.textContent = post.category;
			if (published) {
				published.dateTime = post.publishedAt;
				published.setAttribute('data-date', post.publishedAt);
				published.setAttribute('data-month', 'long');
				published.textContent = D.formatDate(post.publishedAt, 'long');
			}
			if (tagsList) {
				post.tags.forEach(function (tag) {
					var li = document.createElement('li');
					li.textContent = tag;
					tagsList.appendChild(li);
				});
			}

			if (post.videoId || post.videoSrc) {
				player.classList.remove('media');
				player.removeAttribute('data-tint');
				if (post.videoSrc) {
					/* raw video file: the site's own themed player (video-player.js) */
					player.classList.add('video-frame--raw');
					if (D.createVideoPlayer) {
						player.replaceChildren(D.createVideoPlayer({ src: post.videoSrc, title: post.title, poster: post.image ? D.assetUrl(post.image) : '' }));
					} else {
						var video = document.createElement('video');
						video.controls = true;
						video.playsInline = true;
						video.preload = 'metadata';
						video.setAttribute('aria-label', post.title);
						if (post.image) video.poster = D.assetUrl(post.image);
						video.src = post.videoSrc;
						player.replaceChildren(video);
					}
				} else {
					var poster = document.createElement('button');
					poster.type = 'button';
					poster.className = 'video-poster';
					poster.setAttribute('aria-label', D.t('post.playVideo', { title: post.title }));
					var thumbnail = document.createElement('img');
					thumbnail.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(post.videoId) + '/hqdefault.jpg';
					thumbnail.alt = '';
					thumbnail.loading = 'lazy';
					var play = document.createElement('span');
					play.className = 'play-badge';
					play.setAttribute('aria-hidden', 'true');
					poster.appendChild(thumbnail);
					poster.appendChild(play);
					poster.addEventListener('click', function () {
						var frame = document.createElement('iframe');
						frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(post.videoId) + '?autoplay=1';
						frame.title = post.title;
						frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
						frame.allowFullscreen = true;
						frame.referrerPolicy = 'strict-origin-when-cross-origin';
						player.replaceChildren(frame);
					});
					player.replaceChildren(poster);
				}
				var photoSlot = player.parentNode.querySelector('.post-figure');
				if (photoSlot) photoSlot.remove();
			}

			if (post.type === 'Article' && !post.videoId && !post.videoSrc) renderArticle(post);

			comments.setAttribute('data-post-id', post.id);
			window.initCommentThread(comments);
			renderMore(post, all);
		})
		.catch(function (error) {
			showError(error && /^post\./.test(error.message) ? error.message : 'post.errorLoad');
		});
})();
