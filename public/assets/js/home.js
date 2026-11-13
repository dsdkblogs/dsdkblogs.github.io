/* Home page: loads blog-posts.json, then drives the post grid, category chips,
   topic circles, search, sorting and filters. */
(function () {
	var D = window.DSDK;
	var grid = document.getElementById('post-grid');
	if (!grid || !D) return;
	var t = D.t;

	var latestSection = document.getElementById('latest');
	var latestTitle = document.getElementById('latest-title');
	var latestEyebrow = document.getElementById('latest-eyebrow');
	var chipsBox = document.getElementById('category-chips');
	var topicGrid = document.getElementById('topic-grid');
	var resultsBar = document.getElementById('results-bar');
	var resultCount = document.getElementById('result-count');
	var clearBtn = document.getElementById('clear-search');
	var filtersBox = document.getElementById('filters');
	var filterGroups = document.getElementById('filter-groups');
	var sortButtons = [].slice.call(document.querySelectorAll('[data-sort]'));

	var posts = [];
	var state = { query: '', sort: 'relevance', category: new Set(), type: new Set(), tags: new Set(), year: new Set() };
	var filterKeys = ['category', 'type', 'tags', 'year'];
	var statusKey = 'status.loading';

	function postYear(post) { return String(new Date(post.publishedAt).getFullYear()); }
	function valuesFor(post, key) {
		if (key === 'tags') return post.tags;
		if (key === 'year') return [postYear(post)];
		return [post[key]];
	}
	function optionsFor(key) {
		var counts = new Map();
		posts.forEach(function (post) {
			valuesFor(post, key).forEach(function (value) { counts.set(value, (counts.get(value) || 0) + 1); });
		});
		return Array.from(counts.entries());
	}
	function byDateDesc(a, b) { return Date.parse(b.publishedAt) - Date.parse(a.publishedAt); }

	function filterIsActive() { return filterKeys.some(function (key) { return state[key].size > 0; }); }
	function queryIsActive() { return state.query.trim().length > 0; }
	function searchIsActive() { return queryIsActive() || filterIsActive(); }

	function matchesFilters(post) {
		return filterKeys.every(function (key) {
			if (!state[key].size) return true;
			return valuesFor(post, key).some(function (value) { return state[key].has(value); });
		});
	}
	function haystack(post) {
		return [post.title, post.description, post.type, post.category, postYear(post)].concat(post.tags).join(' ').toLocaleLowerCase();
	}
	function matchesQuery(post, query) {
		if (!query) return true;
		var text = haystack(post);
		return query.split(/\s+/).every(function (term) { return text.indexOf(term) !== -1; });
	}
	function relevance(post, query) {
		var title = post.title.toLocaleLowerCase();
		var description = post.description.toLocaleLowerCase();
		var rest = post.tags.concat([post.type, post.category, postYear(post)]).join(' ').toLocaleLowerCase();
		var score = 0;
		query.split(/\s+/).forEach(function (term) {
			if (title.indexOf(term) !== -1) score += 4;
			if (description.indexOf(term) !== -1) score += 2;
			if (rest.indexOf(term) !== -1) score += 1;
		});
		return score;
	}

	/* ---------- controls ---------- */
	function buildChips() {
		chipsBox.replaceChildren();
		var categories = optionsFor('category').map(function (o) { return o[0]; }).sort();
		if (categories.length < 1) { chipsBox.hidden = true; return; }
		chipsBox.hidden = false;
		var all = document.createElement('button');
		all.type = 'button'; all.className = 'chip'; all.setAttribute('data-chip', '');
		all.setAttribute('data-i18n', 'chips.all'); all.textContent = t('chips.all');
		all.addEventListener('click', function () { state.category.clear(); sync(); render(); });
		chipsBox.appendChild(all);
		categories.forEach(function (category) {
			var chip = document.createElement('button');
			chip.type = 'button'; chip.className = 'chip'; chip.setAttribute('data-chip', category);
			chip.textContent = category;
			chip.addEventListener('click', function () {
				var wasOn = state.category.has(category);
				state.category.clear();
				if (!wasOn) state.category.add(category);
				sync(); render();
			});
			chipsBox.appendChild(chip);
		});
	}

	function buildFilters() {
		filterGroups.replaceChildren();
		var defs = [['type', 'filters.type'], ['tags', 'filters.tags'], ['year', 'filters.year']];
		var shown = 0;
		defs.forEach(function (def) {
			var options = optionsFor(def[0]).sort(function (a, b) {
				return def[0] === 'year' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]);
			});
			if (options.length < 2) return; /* a filter with a single option is just noise */
			shown++;
			var fieldset = document.createElement('fieldset');
			fieldset.className = 'filter-group';
			var legend = document.createElement('legend');
			legend.setAttribute('data-i18n', def[1]);
			legend.textContent = t(def[1]);
			fieldset.appendChild(legend);
			options.forEach(function (option) {
				var label = document.createElement('label');
				label.className = 'filter-option';
				var box = document.createElement('input');
				box.type = 'checkbox'; box.value = option[0]; box.setAttribute('data-filter', def[0]);
				box.addEventListener('change', function () {
					if (box.checked) state[def[0]].add(option[0]); else state[def[0]].delete(option[0]);
					sync(); render();
				});
				var name = document.createElement('span');
				name.textContent = option[0];
				var count = document.createElement('span');
				count.className = 'filter-count';
				count.textContent = '(' + option[1] + ')';
				label.appendChild(box); label.appendChild(name); label.appendChild(count);
				fieldset.appendChild(label);
			});
			filterGroups.appendChild(fieldset);
		});
		filtersBox.hidden = shown === 0;
	}

	function buildTopics() {
		topicGrid.replaceChildren();
		var topics = optionsFor('tags').sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); }).slice(0, 6);
		if (!topics.length) {
			var empty = document.createElement('li');
			empty.className = 'post-status';
			empty.setAttribute('data-i18n', 'topics.empty');
			empty.textContent = t('topics.empty');
			topicGrid.appendChild(empty);
			return;
		}
		topics.forEach(function (topic) {
			var item = document.createElement('li');
			var button = document.createElement('button');
			button.type = 'button'; button.className = 'topic';
			var media = document.createElement('span');
			media.className = 'media media--circle';
			media.setAttribute('data-tint', D.tintFor(topic[0]));
			media.setAttribute('role', 'img');
			media.setAttribute('aria-label', t('topics.photo'));
			var name = document.createElement('span');
			name.className = 'topic__name'; name.textContent = topic[0];
			var count = document.createElement('span');
			count.className = 'topic__count'; count.setAttribute('data-count', topic[1]);
			count.textContent = topic[1] === 1 ? t('topics.one') : t('topics.other', { n: topic[1] });
			button.appendChild(media); button.appendChild(name); button.appendChild(count);
			button.addEventListener('click', function () {
				filterKeys.forEach(function (key) { state[key].clear(); });
				state.query = '';
				state.tags.add(topic[0]);
				sync(); render();
				latestSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
			});
			item.appendChild(button);
			topicGrid.appendChild(item);
		});
	}

	/* keep chips / checkboxes in step with state */
	function sync() {
		[].forEach.call(chipsBox.querySelectorAll('[data-chip]'), function (chip) {
			var value = chip.getAttribute('data-chip');
			var on = value === '' ? state.category.size === 0 : state.category.has(value);
			chip.setAttribute('aria-pressed', on ? 'true' : 'false');
		});
		[].forEach.call(filterGroups.querySelectorAll('input[type="checkbox"]'), function (box) {
			box.checked = state[box.getAttribute('data-filter')].has(box.value);
		});
	}

	/* ---------- render ---------- */
	function setStatus(key) {
		statusKey = key;
		var p = document.createElement('p');
		p.className = 'post-status';
		p.setAttribute('data-i18n', key);
		p.textContent = t(key);
		grid.replaceChildren(p);
	}

	function render() {
		var query = state.query.trim().toLocaleLowerCase();
		var active = searchIsActive();
		var sort = active ? (state.sort === 'relevance' && !query ? 'newest' : state.sort) : 'newest';

		var results = posts.filter(function (post) { return matchesFilters(post) && matchesQuery(post, query); });
		if (sort === 'relevance') {
			results.sort(function (a, b) { return relevance(b, query) - relevance(a, query) || byDateDesc(a, b); });
		} else if (sort === 'oldest') {
			results.sort(function (a, b) { return -byDateDesc(a, b); });
		} else {
			results.sort(byDateDesc);
		}

		var titleKey = !active ? 'latest.title' : (query ? 'latest.searchTitle' : 'latest.filteredTitle');
		latestTitle.setAttribute('data-i18n', titleKey);
		latestTitle.textContent = t(titleKey);
		latestEyebrow.hidden = active;
		resultsBar.hidden = !active;
		if (active) {
			resultCount.setAttribute('data-count', results.length);
			resultCount.textContent = results.length === 1 ? t('results.one') : t('results.other', { n: results.length });
			sortButtons.forEach(function (button) {
				button.hidden = button.getAttribute('data-sort') === 'relevance' && !query;
				button.setAttribute('aria-pressed', button.getAttribute('data-sort') === sort ? 'true' : 'false');
			});
		}

		if (!results.length) { setStatus('status.empty'); return; }
		grid.replaceChildren();
		results.forEach(function (post, index) {
			grid.appendChild(D.createCard(post, 'blog/', { spotlight: !active && index === 0 }));
		});
	}

	/* ---------- events ---------- */
	/* text search lives in the site-index overlay (assets/js/search.js) */
	sortButtons.forEach(function (button) {
		button.addEventListener('click', function () { state.sort = button.getAttribute('data-sort'); render(); });
	});
	clearBtn.addEventListener('click', function () {
		filterKeys.forEach(function (key) { state[key].clear(); });
		state.query = ''; state.sort = 'relevance';
		sync(); render();
	});

	/* language switch: dynamic text is rebuilt so counts/dates stay translated */
	D.onLang(function () {
		if (!posts.length) { if (statusKey) setStatus(statusKey); return; }
		[].forEach.call(topicGrid.querySelectorAll('.topic__count'), function (el) {
			var n = Number(el.getAttribute('data-count'));
			el.textContent = n === 1 ? t('topics.one') : t('topics.other', { n: n });
		});
		[].forEach.call(topicGrid.querySelectorAll('.media'), function (el) { el.setAttribute('aria-label', t('topics.photo')); });
		if (searchIsActive()) {
			var n = Number(resultCount.getAttribute('data-count'));
			resultCount.textContent = n === 1 ? t('results.one') : t('results.other', { n: n });
		}
	});

	/* ---------- load ---------- */
	setStatus('status.loading');
	D.loadFeed().then(function (feed) {
		posts = feed;
			buildChips();
			buildFilters();
			buildTopics();
			sync();
			render();
		})
		.catch(function () { setStatus('status.error'); });
})();
