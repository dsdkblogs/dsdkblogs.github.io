/* Shared across every page: theme, language, mobile menu, post-card builder.
   Exposes window.DSDK = { t, lang, onLang, formatDate, createCard, createMedia, tintFor,
   root, assetUrl, loadFeed, postUrl }. */
(function () {
	var root = document.documentElement;
	var scriptEl = document.currentScript;
	/* Site root (folder that holds index.html), worked out from this script's own URL so it
	   resolves the same from index.html and from /blog/ pages. */
	var siteRoot = scriptEl && scriptEl.src ? new URL('../../', scriptEl.src).href : new URL('./', location.href).href;
	/* Remote copy of the feed, used only when the site is opened straight from disk (file://). */
	var REMOTE_ORIGIN = 'https://blog.ankomstudios.com/';
	var cfg = window.DSDK_CONFIG || {};
	var features = cfg.features || {};

	function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
	function set(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

	/* ---------- translations (UI text only; comments stay as the backend sends them) ---------- */
	var dict = {
		en: {
			'skip': 'Skip to content',
			'tagline': 'Stories, videos & little joys',
			'nav.home': 'Home', 'nav.latest': 'Latest', 'nav.topics': 'Topics', 'nav.about': 'About us', 'nav.join': 'Join in', 'nav.account': 'Account',
			'nav.recs': 'Recommendations', 'nav.donate': 'Donate', 'nav.contact': 'Contact',
			'menu': 'Menu',
			'dashboard.open': 'Dashboard and uploads',
			'tools.open': 'Staff tools', 'tools.title': 'Staff tools', 'tools.publish': 'Publish a video', 'tools.write': 'Write an article',
			'tools.overlay': 'Edit text & images overlay', 'tools.overlayHint': 'Show or hide the editing panel in the bottom-left corner.', 'tools.on': 'On', 'tools.off': 'Off',
			'search.open': 'Search posts', 'search.placeholder': 'Search posts…', 'search.submit': 'Search',
			'theme.toggle': 'Switch light / dark theme',
			'lang.aria': 'Translate to Spanish',
			'hero.eyebrow': 'Welcome, friend',
			'hero.title1': 'Pull up a chair &', 'hero.title2': 'stay a while',
			'hero.lead': 'Videos, favorites and the conversations that follow. Every post has its own comment thread — come say hi.',
			'hero.cta1': 'Read the latest', 'hero.cta2': 'Browse topics',
			'hero.photo': 'Hero photo', 'hero.sticker': 'Photo',
			'latest.eyebrow': 'Fresh from the blog', 'latest.title': 'Latest posts',
			'latest.searchTitle': 'Search results', 'latest.filteredTitle': 'Filtered posts',
			'chips.label': 'Filter by category', 'chips.all': 'All',
			'filters.summary': 'More filters',
			'filters.type': 'Post types', 'filters.tags': 'Tags', 'filters.year': 'Year',
			'results.one': 'Found 1 result', 'results.other': 'Found {n} results',
			'sort.label': 'Sort results', 'sort.relevance': 'Relevance', 'sort.newest': 'Newest', 'sort.oldest': 'Oldest',
			'clear': 'Clear all',
			'status.loading': 'Loading posts…',
			'status.error': 'Posts could not be loaded. Please refresh to try again.',
			'status.empty': 'No posts match your search. Try different words or clear the filters.',
			'card.read': 'Read & join in', 'card.cover': 'Cover image',
			'topics.eyebrow': 'Find your thing', 'topics.title': 'Explore by topic',
			'topics.note': 'Pick a topic to see related posts.', 'topics.empty': 'Topics will appear as posts are added.',
			'topics.photo': 'Topic photo', 'topics.one': '1 post', 'topics.other': '{n} posts',
			'about.eyebrow': 'Hello there', 'about.title': "We're Dakota & Kaelyn",
			'about.body': 'Add a few sentences here about who you are, what you love, and what readers can expect. Swap the photo for a favorite picture of the two of you.',
			'about.cta': 'Start with the latest post', 'about.photo': 'Photo of you two',
			'join.eyebrow': 'Join the conversation', 'join.title': 'Every post has a place for its conversation.',
			'join.body': 'Open any post, sign in, leave a comment, and keep the chat going. Some discussions close after a set time.',
			'join.cta': 'Find a post to chat about',
			'idx.title': 'DSDK SITE INDEX', 'idx.close': 'Close', 'idx.label': 'Search the index:',
			'idx.placeholder': 'type a word, title or tag…', 'idx.go': 'Go',
			'idx.all': 'Showing all {n} indexed entries, A to Z.', 'idx.found': '{n} of {total} entries match "{q}".',
			'idx.letter': 'Entries beginning with "{l}": {n}.', 'idx.none': 'No entries found. Try fewer or different words.',
			'idx.az': 'Jump to letter', 'idx.allLetters': 'ALL', 'idx.seeAlso': 'See also:',
			'idx.foot': '{n} entries indexed · press / to search · Esc to close',
			'idx.kindPost': 'Post', 'idx.kindPage': 'Page', 'idx.offline': 'Post list unavailable, showing site pages only.',
			'idx.home': 'Start page of DSDK Blogs.', 'idx.latest': 'The newest posts, with filters.',
			'idx.topics': 'Browse posts by topic.', 'idx.about': 'About Dakota & Kaelyn.', 'idx.join': 'How the comment threads work.',
			'idx.recs': 'Our favorite finds, collected on a shared Padlet board.', 'idx.donate': 'Support DSDK Blogs with a tip on Ko-fi.',
			'idx.contact': 'Questions, commissions and custom websites.',
			'notify.open': 'Notifications and settings', 'notify.title': 'Notifications',
			'notify.tabAlerts': 'Alerts', 'notify.tabSettings': 'Settings', 'notify.close': 'Close',
			'notify.new': 'New post', 'notify.empty': "No alerts yet. We'll show new posts here as soon as they go up.",
			'notify.off': 'Alerts are switched off. Turn them on in Settings.',
			'notify.markRead': 'Mark all read', 'notify.clear': 'Clear list', 'notify.unread': '{n} unread',
			'notify.setAlerts': 'New post alerts', 'notify.setAlertsHint': 'Get a pop-up here whenever a new post goes up.',
			'notify.setBrowser': 'Browser notifications', 'notify.setBrowserHint': 'Also notify me when this tab is in the background.',
			'notify.denied': 'Your browser has blocked notifications for this site. Change it in the browser’s site settings.',
			'notify.unsupported': "This browser doesn't support desktop notifications.",
			'notify.test': 'Preview an alert', 'notify.testNone': 'Add a post first to preview an alert.',
			'notify.note': 'Alerts show while the site is open in your browser. Your choices are saved on this device only.',
			'notify.dismiss': 'Dismiss',
			'social.label': 'Follow along',
			'footer.script': 'Thanks for stopping by — stay curious & make something lovely.',
			'footer.top': 'Back to top', 'footer.copy': '© {year} DSDK Blogs',
			'post.home': 'Home', 'post.all': 'All posts', 'post.breadcrumb': 'Breadcrumb',
			'post.loadingVideo': 'Loading video…', 'post.videoLabel': 'Video player',
			'post.playVideo': 'Play video: {title}',
			'post.photoCaption': 'Add a photo and caption here',
			'post.moreEyebrow': 'Keep exploring', 'post.moreTitle': 'You might also like',
			'post.errorLoad': 'This post could not be loaded.', 'post.errorMissing': 'This post could not be found.',
			'donate.eyebrow': 'Support us', 'donate.title': 'Buy us a coffee',
			'donate.lead': 'If you enjoy our videos and posts, you can leave a small tip on Ko-fi. It is completely optional, and it helps us keep making things.',
			'donate.cta': 'Support on Ko-fi',
			'donate.note': 'Payments are handled by Ko-fi, so your payment details never touch this site. The link opens in a new tab.',
			'donate.helpTitle': 'Other ways to help',
			'donate.help1': 'Share a post with a friend.', 'donate.help2': 'Leave a comment and keep the conversation going.', 'donate.help3': 'Tell us what you would like to see next.',
			'recs.eyebrow': 'Our shelf', 'recs.title': 'Recommendations',
			'recs.lead': 'Our favorite finds, from videos to little joys, collected on a shared Padlet board.',
			'recs.cta': 'Open the Padlet board', 'recs.note': 'The board opens on Padlet in a new tab.',
			'recs.suggest': 'Have something we should see? Send it our way.', 'recs.contact': 'Contact us',
			'contact.eyebrow': 'Say hello', 'contact.title': 'Get in touch',
			'contact.lead': 'Questions about the blog, a commission, or a website of your very own? Pick the right inbox below.',
			'contact.blogTitle': 'Questions about the blog', 'contact.blogBody': 'Comments, corrections, ideas for us, or just hello.',
			'contact.studioTitle': 'Commissions & your own site', 'contact.studioBody': 'Custom commissions, plus a website of your very own, designed and built by Ankom Studios.',
			'contact.copy': 'Copy address', 'contact.copied': 'Copied!',
			'contact.formTitle': 'Write a message', 'contact.name': 'Your name', 'contact.email': 'Your email', 'contact.topic': 'What is this about?',
			'contact.t1': 'A question about the blog', 'contact.t2': 'A commission', 'contact.t3': 'I would like my own website', 'contact.t4': 'Something else',
			'contact.message': 'Message', 'contact.send': 'Open in my email app',
			'contact.formNote': 'This opens your email app with the message filled in. Nothing is sent from this website.',
			'contact.needMessage': 'Please write a short message first.',
		},
		es: {
			'skip': 'Saltar al contenido',
			'tagline': 'Historias, videos y pequeñas alegrías',
			'nav.home': 'Inicio', 'nav.latest': 'Recientes', 'nav.topics': 'Temas', 'nav.about': 'Quiénes somos', 'nav.join': 'Participa', 'nav.account': 'Cuenta',
			'nav.recs': 'Recomendaciones', 'nav.donate': 'Donar', 'nav.contact': 'Contacto',
			'menu': 'Menú',
			'dashboard.open': 'Panel y publicaciones',
			'tools.open': 'Herramientas del equipo', 'tools.title': 'Herramientas del equipo', 'tools.publish': 'Publicar un video', 'tools.write': 'Escribir un artículo',
			'tools.overlay': 'Panel para editar texto e imágenes', 'tools.overlayHint': 'Muestra u oculta el panel de edición de la esquina inferior izquierda.', 'tools.on': 'Sí', 'tools.off': 'No',
			'search.open': 'Buscar publicaciones', 'search.placeholder': 'Buscar publicaciones…', 'search.submit': 'Buscar',
			'theme.toggle': 'Cambiar entre tema claro y oscuro',
			'lang.aria': 'Traducir al inglés',
			'hero.eyebrow': 'Te damos la bienvenida',
			'hero.title1': 'Acércate una silla y', 'hero.title2': 'quédate un rato',
			'hero.lead': 'Videos, favoritos y las conversaciones que surgen después. Cada publicación tiene su propio hilo de comentarios: ven a saludar.',
			'hero.cta1': 'Leer lo último', 'hero.cta2': 'Explorar temas',
			'hero.photo': 'Foto principal', 'hero.sticker': 'Foto',
			'latest.eyebrow': 'Recién salido del blog', 'latest.title': 'Últimas publicaciones',
			'latest.searchTitle': 'Resultados de búsqueda', 'latest.filteredTitle': 'Publicaciones filtradas',
			'chips.label': 'Filtrar por categoría', 'chips.all': 'Todo',
			'filters.summary': 'Más filtros',
			'filters.type': 'Tipos de publicación', 'filters.tags': 'Etiquetas', 'filters.year': 'Año',
			'results.one': 'Se encontró 1 resultado', 'results.other': 'Se encontraron {n} resultados',
			'sort.label': 'Ordenar resultados', 'sort.relevance': 'Relevancia', 'sort.newest': 'Más recientes', 'sort.oldest': 'Más antiguas',
			'clear': 'Borrar todo',
			'status.loading': 'Cargando publicaciones…',
			'status.error': 'No se pudieron cargar las publicaciones. Actualiza la página para intentarlo de nuevo.',
			'status.empty': 'Ninguna publicación coincide con tu búsqueda. Prueba otras palabras o borra los filtros.',
			'card.read': 'Leer y participar', 'card.cover': 'Imagen de portada',
			'topics.eyebrow': 'Encuentra lo tuyo', 'topics.title': 'Explora por tema',
			'topics.note': 'Elige un tema para ver publicaciones relacionadas.', 'topics.empty': 'Los temas aparecerán al añadir publicaciones.',
			'topics.photo': 'Foto del tema', 'topics.one': '1 publicación', 'topics.other': '{n} publicaciones',
			'about.eyebrow': 'Hola', 'about.title': 'Somos Dakota y Kaelyn',
			'about.body': 'Añade aquí unas frases sobre quiénes son, qué les gusta y qué pueden esperar los lectores. Cambia la foto por una favorita de los dos.',
			'about.cta': 'Empieza por la última publicación', 'about.photo': 'Foto de ustedes',
			'join.eyebrow': 'Únete a la conversación', 'join.title': 'Cada publicación tiene su espacio para conversar.',
			'join.body': 'Abre cualquier publicación, inicia sesión, deja un comentario y sigue la charla. Algunas conversaciones se cierran pasado un tiempo.',
			'join.cta': 'Busca una publicación para comentar',
			'idx.title': 'ÍNDICE DEL SITIO DSDK', 'idx.close': 'Cerrar', 'idx.label': 'Buscar en el índice:',
			'idx.placeholder': 'escribe una palabra, título o etiqueta…', 'idx.go': 'Ir',
			'idx.all': 'Mostrando las {n} entradas del índice, de la A a la Z.', 'idx.found': '{n} de {total} entradas coinciden con "{q}".',
			'idx.letter': 'Entradas que empiezan con "{l}": {n}.', 'idx.none': 'No se encontraron entradas. Prueba con otras palabras.',
			'idx.az': 'Ir a la letra', 'idx.allLetters': 'TODO', 'idx.seeAlso': 'Ver también:',
			'idx.foot': '{n} entradas indexadas · pulsa / para buscar · Esc para cerrar',
			'idx.kindPost': 'Publicación', 'idx.kindPage': 'Página', 'idx.offline': 'No se pudo cargar la lista de publicaciones; solo se muestran páginas del sitio.',
			'idx.home': 'Página de inicio de DSDK Blogs.', 'idx.latest': 'Las publicaciones más recientes, con filtros.',
			'idx.topics': 'Explora publicaciones por tema.', 'idx.about': 'Sobre Dakota y Kaelyn.', 'idx.join': 'Cómo funcionan los hilos de comentarios.',
			'idx.recs': 'Nuestros favoritos, reunidos en un tablero compartido de Padlet.', 'idx.donate': 'Apoya DSDK Blogs con una propina en Ko-fi.',
			'idx.contact': 'Preguntas, encargos y sitios web a medida.',
			'notify.open': 'Notificaciones y ajustes', 'notify.title': 'Notificaciones',
			'notify.tabAlerts': 'Avisos', 'notify.tabSettings': 'Ajustes', 'notify.close': 'Cerrar',
			'notify.new': 'Nueva publicación', 'notify.empty': 'Aún no hay avisos. Aquí verás las publicaciones nuevas en cuanto salgan.',
			'notify.off': 'Los avisos están desactivados. Actívalos en Ajustes.',
			'notify.markRead': 'Marcar todo como leído', 'notify.clear': 'Vaciar lista', 'notify.unread': '{n} sin leer',
			'notify.setAlerts': 'Avisos de nuevas publicaciones', 'notify.setAlertsHint': 'Recibe un aviso aquí cada vez que salga una publicación nueva.',
			'notify.setBrowser': 'Notificaciones del navegador', 'notify.setBrowserHint': 'Avísame también cuando esta pestaña esté en segundo plano.',
			'notify.denied': 'Tu navegador bloqueó las notificaciones de este sitio. Cámbialo en los ajustes del sitio del navegador.',
			'notify.unsupported': 'Este navegador no admite notificaciones de escritorio.',
			'notify.test': 'Ver un aviso de ejemplo', 'notify.testNone': 'Añade una publicación para ver un aviso de ejemplo.',
			'notify.note': 'Los avisos se muestran mientras el sitio está abierto en tu navegador. Tus opciones se guardan solo en este dispositivo.',
			'notify.dismiss': 'Descartar',
			'social.label': 'Síguenos',
			'footer.script': 'Gracias por pasar por aquí: sigue curioseando y crea algo bonito.',
			'footer.top': 'Volver arriba', 'footer.copy': '© {year} DSDK Blogs',
			'post.home': 'Inicio', 'post.all': 'Todas las publicaciones', 'post.breadcrumb': 'Ruta de navegación',
			'post.loadingVideo': 'Cargando video…', 'post.videoLabel': 'Reproductor de video',
			'post.playVideo': 'Reproducir video: {title}',
			'post.photoCaption': 'Añade aquí una foto y su descripción',
			'post.moreEyebrow': 'Sigue explorando', 'post.moreTitle': 'Quizá también te guste',
			'post.errorLoad': 'No se pudo cargar esta publicación.', 'post.errorMissing': 'No se encontró esta publicación.',
			'donate.eyebrow': 'Apóyanos', 'donate.title': 'Invítanos un café',
			'donate.lead': 'Si disfrutas nuestros videos y publicaciones, puedes dejar una pequeña propina en Ko-fi. Es totalmente opcional y nos ayuda a seguir creando.',
			'donate.cta': 'Apoyar en Ko-fi',
			'donate.note': 'Ko-fi gestiona los pagos, así que tus datos de pago nunca pasan por este sitio. El enlace se abre en una pestaña nueva.',
			'donate.helpTitle': 'Otras formas de ayudar',
			'donate.help1': 'Comparte una publicación con un amigo.', 'donate.help2': 'Deja un comentario y mantén viva la conversación.', 'donate.help3': 'Cuéntanos qué te gustaría ver a continuación.',
			'recs.eyebrow': 'Nuestra estantería', 'recs.title': 'Recomendaciones',
			'recs.lead': 'Nuestros favoritos, desde videos hasta pequeñas alegrías, reunidos en un tablero compartido de Padlet.',
			'recs.cta': 'Abrir el tablero de Padlet', 'recs.note': 'El tablero se abre en Padlet, en una pestaña nueva.',
			'recs.suggest': '¿Tienes algo que deberíamos ver? Envíanoslo.', 'recs.contact': 'Escríbenos',
			'contact.eyebrow': 'Saluda', 'contact.title': 'Ponte en contacto',
			'contact.lead': '¿Preguntas sobre el blog, un encargo o un sitio web propio? Elige el buzón adecuado.',
			'contact.blogTitle': 'Preguntas sobre el blog', 'contact.blogBody': 'Comentarios, correcciones, ideas para nosotros o solo un saludo.',
			'contact.studioTitle': 'Encargos y tu propio sitio', 'contact.studioBody': 'Encargos a medida y un sitio web solo tuyo, diseñado y creado por Ankom Studios.',
			'contact.copy': 'Copiar dirección', 'contact.copied': '¡Copiado!',
			'contact.formTitle': 'Escribe un mensaje', 'contact.name': 'Tu nombre', 'contact.email': 'Tu correo', 'contact.topic': '¿De qué se trata?',
			'contact.t1': 'Una pregunta sobre el blog', 'contact.t2': 'Un encargo', 'contact.t3': 'Quiero mi propio sitio web', 'contact.t4': 'Otra cosa',
			'contact.message': 'Mensaje', 'contact.send': 'Abrir en mi app de correo',
			'contact.formNote': 'Esto abre tu app de correo con el mensaje ya escrito. Este sitio web no envía nada.',
			'contact.needMessage': 'Escribe primero un mensaje breve.',
		}
	};

	var lang = get('lang') === 'es' ? 'es' : 'en';
	var langListeners = [];

	function t(key, vars) {
		var text = (dict[lang] && dict[lang][key]) || dict.en[key] || key;
		if (vars) Object.keys(vars).forEach(function (name) { text = text.replace('{' + name + '}', vars[name]); });
		return text;
	}

	function applyLang() {
		root.setAttribute('lang', lang === 'es' ? 'es' : 'en-US');
		[].forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
			el.textContent = t(el.getAttribute('data-i18n'), el.hasAttribute('data-year') ? { year: new Date().getFullYear() } : null);
		});
		[].forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (el) {
			el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
		});
		[].forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (el) {
			el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
		});
		[].forEach.call(document.querySelectorAll('[data-i18n-title]'), function (el) {
			el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
		});
		[].forEach.call(document.querySelectorAll('time[data-date]'), function (el) {
			el.textContent = formatDate(el.getAttribute('data-date'), el.getAttribute('data-month'));
		});
		[].forEach.call(document.querySelectorAll('[data-lang-toggle]'), function (btn) {
			btn.textContent = lang === 'es' ? 'EN' : 'ES';
			btn.setAttribute('aria-label', t('lang.aria'));
		});
		langListeners.forEach(function (fn) { fn(lang); });
	}

	[].forEach.call(document.querySelectorAll('[data-lang-toggle]'), function (btn) {
		btn.addEventListener('click', function () {
			lang = lang === 'es' ? 'en' : 'es';
			set('lang', lang);
			applyLang();
		});
	});

	/* ---------- theme ---------- */
	function setTheme(theme) {
		if (theme === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
		[].forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (btn) {
			btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
		});
		var meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', theme === 'dark' ? '#1f1519' : '#fff8f5');
		set('theme', theme);
	}
	[].forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (btn) {
		btn.addEventListener('click', function () {
			setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
		});
	});
	setTheme(get('theme') === 'dark' ? 'dark' : 'light');

	/* ---------- mobile menu ---------- */
	var menuBtn = document.getElementById('menu-toggle');
	var nav = document.getElementById('site-nav');
	function closeMenu() {
		if (!menuBtn || !nav) return;
		menuBtn.setAttribute('aria-expanded', 'false');
		nav.classList.remove('is-open');
	}
	if (menuBtn && nav) {
		menuBtn.addEventListener('click', function () {
			var open = menuBtn.getAttribute('aria-expanded') !== 'true';
			menuBtn.setAttribute('aria-expanded', String(open));
			nav.classList.toggle('is-open', open);
		});
		nav.addEventListener('click', function (event) { if (event.target.closest('a')) closeMenu(); });
		document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeMenu(); });
		window.addEventListener('resize', function () { if (window.innerWidth >= 860) closeMenu(); });
	}

	/* ---------- card builder (home grid + "you might also like") ---------- */
	function tintFor(id) {
		var sum = 0;
		for (var i = 0; i < id.length; i++) sum += id.charCodeAt(i);
		return String((sum % 5) + 1);
	}

	function formatDate(iso, style) {
		var date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { year: 'numeric', month: style || 'short', day: 'numeric' });
	}

	function assetUrl(path) {
		if (!path) return '';
		if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) return path;
		return siteRoot + path.replace(/^\/+/, '');
	}

	/* Loads blog-posts.json once per page, validated. Resolves to an array of posts. */
	var feedPromise = null;
	function normalisePost(post) {
		return {
			id: post.id, title: post.title, description: post.description, publishedAt: post.publishedAt,
			videoId: typeof post.videoId === 'string' ? post.videoId : '',
			videoSrc: typeof post.videoSrc === 'string' ? post.videoSrc : '',
			embedSrc: typeof post.embedSrc === 'string' ? post.embedSrc : '',
			pageUrl: typeof post.pageUrl === 'string' ? post.pageUrl : '',
			authorId: typeof post.authorId === 'string' ? post.authorId : '',
			image: typeof post.image === 'string' ? post.image : '',
			imageAlt: typeof post.imageAlt === 'string' ? post.imageAlt : '',
			type: typeof post.type === 'string' ? post.type : 'Post',
			category: typeof post.category === 'string' ? post.category : 'Uncategorized',
			tags: Array.isArray(post.tags) ? post.tags.filter(function (tag) { return typeof tag === 'string'; }) : []
		};
	}
	function loadFeed(fresh) {
		if (feedPromise && !fresh) return feedPromise;
		var url = location.protocol === 'file:' ? REMOTE_ORIGIN + 'api/posts' : siteRoot + 'api/posts';
		if (fresh) url += '?t=' + Date.now();
		feedPromise = fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-cache' })
			.then(function (response) { if (!response.ok) throw new Error('feed'); return response.json(); })
			.then(function (payload) {
				var feed = Array.isArray(payload) ? payload : payload && payload.posts;
				if (!Array.isArray(feed)) throw new Error('feed');
				return feed.filter(function (p) {
					return p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.description === 'string' &&
						typeof p.publishedAt === 'string' && Number.isFinite(Date.parse(p.publishedAt));
				}).map(normalisePost);
			});
		feedPromise.catch(function () { feedPromise = null; });
		return feedPromise;
	}
	function postUrl(post) { return post.pageUrl ? siteRoot + post.pageUrl : siteRoot + 'blog/' + encodeURIComponent(post.id) + '.html'; }

	/* Builds the image container: a placeholder by default, a real <img> when post.image is set. */
	function createMedia(post, extraClass, captionKey) {
		var media = document.createElement('div');
		media.className = 'media ' + (extraClass || '');
		media.setAttribute('data-tint', tintFor(post.id));
		if (post.image) {
			var img = document.createElement('img');
			img.src = assetUrl(post.image);
			img.alt = post.imageAlt || '';
			img.loading = 'lazy';
			media.appendChild(img);
		} else {
			var caption = document.createElement('span');
			caption.className = 'media__caption';
			caption.setAttribute('data-i18n', captionKey || 'card.cover');
			caption.textContent = t(captionKey || 'card.cover');
			media.appendChild(caption);
		}
		return media;
	}

	/* Raw video files with no cover image: show the file's first frame as the card picture. */
	function createRawPoster(post) {
		var media = document.createElement('div');
		media.className = 'media media--poster';
		media.setAttribute('data-tint', tintFor(post.id));
		var preview = document.createElement('video');
		preview.muted = true;
		preview.playsInline = true;
		preview.preload = 'metadata';
		preview.tabIndex = -1;
		preview.setAttribute('aria-hidden', 'true');
		preview.src = post.videoSrc + '#t=0.1';
		media.appendChild(preview);
		return media;
	}

	function createCard(post, prefix, options) {
		options = options || {};
		var card = document.createElement('article');
		card.className = 'card' + (options.spotlight ? ' card--spotlight' : '');

		var hasVideoEmbed = Boolean(post.videoId || post.embedSrc || post.videoSrc);
		var rawOnly = Boolean(post.videoSrc && !post.image && !post.videoId && !post.embedSrc);
		var media = post.image || !hasVideoEmbed ? createMedia(post, '', 'card.cover') : (rawOnly ? createRawPoster(post) : null);
		if (media && hasVideoEmbed) {
			var badge = document.createElement('span');
			badge.className = 'play-badge';
			badge.setAttribute('aria-hidden', 'true');
			media.appendChild(badge);
		}

		var body = document.createElement('div');
		body.className = 'card__body';

		var meta = document.createElement('p');
		meta.className = 'card__meta';
		var pill = document.createElement('span');
		pill.className = 'tag-pill';
		pill.textContent = post.category;
		var time = document.createElement('time');
		time.dateTime = post.publishedAt;
		time.textContent = formatDate(post.publishedAt);
		time.setAttribute('data-date', post.publishedAt);
		meta.appendChild(pill);
		meta.appendChild(time);

		var title = document.createElement('h3');
		title.className = 'card__title';
		var link = document.createElement('a');
		link.className = 'card__link';
		link.href = post.pageUrl || !prefix ? postUrl(post) : prefix + encodeURIComponent(post.id) + '.html';
		link.textContent = post.title;
		title.appendChild(link);

		var excerpt = document.createElement('p');
		excerpt.className = 'card__excerpt';
		excerpt.textContent = post.description;

		body.appendChild(meta);
		body.appendChild(title);
		body.appendChild(excerpt);

		if (post.tags && post.tags.length) {
			var tags = document.createElement('ul');
			tags.className = 'tag-list';
			post.tags.forEach(function (tag) {
				var li = document.createElement('li');
				li.textContent = tag;
				tags.appendChild(li);
			});
			body.appendChild(tags);
		}

		var cta = document.createElement('span');
		cta.className = 'card__cta';
		cta.setAttribute('data-i18n', 'card.read');
		cta.textContent = t('card.read');
		body.appendChild(cta);

		if (media) card.appendChild(media);
		card.appendChild(body);
		return card;
	}

	/* ---------- backend helpers shared by every page ---------- */
	function apiBase() { return location.protocol === 'file:' ? REMOTE_ORIGIN : siteRoot; }

	/* api('accounts/me') -> parsed JSON. Errors carry .status and .payload; .offline is true when the Worker
	   has no such endpoint yet (404/405 or a non-JSON reply), so callers can fall back to local drafts. */
	function api(path, options) {
		options = Object.assign({}, options || {});
		var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
		if (options.json !== undefined) {
			headers['Content-Type'] = 'application/json';
			options.body = JSON.stringify(options.json);
			delete options.json;
		}
		options.headers = headers;
		options.credentials = 'same-origin';
		return fetch(apiBase() + 'api/' + path, options).then(function (response) {
			return response.text().then(function (text) {
				var payload = null;
				try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
				if (!response.ok || !payload || typeof payload !== 'object') {
					var message = payload && typeof payload.error === 'string' ? payload.error : 'The request could not be completed.';
					var error = new Error(message);
					error.status = response.status;
					error.payload = payload;
					error.offline = response.status === 404 || response.status === 405 || (!payload && response.ok) || (!payload && response.status >= 500);
					throw error;
				}
				return payload;
			});
		}, function () {
			var error = new Error('You appear to be offline, or the server cannot be reached.');
			error.offline = true;
			error.status = 0;
			throw error;
		});
	}

	var accountPromise = null;
	var accountListeners = [];
	var ROLE_LEVEL = { reader: 0, publisher: 1, editor: 2, admin: 3 };
	/* Remembers (in this browser only) that a staff account has signed in, so public pages can skip the
	   "who am I?" request for everyone else. The server still checks the role on every protected call. */
	function rememberStaff(account) {
		if (account && ROLE_LEVEL[account.role] >= ROLE_LEVEL.publisher) set('dsdk.staff', '1'); else if (!account) set('dsdk.staff', '0');
	}
	function setAccount(account) {
		accountPromise = Promise.resolve(account || null);
		rememberStaff(account);
		accountListeners.forEach(function (fn) { fn(account || null); });
	}
	function me(fresh) {
		if (accountPromise && !fresh) return accountPromise;
		accountPromise = api('accounts/me').then(function (payload) { rememberStaff(payload.account); return payload.account || null; }, function () { rememberStaff(null); return null; });
		return accountPromise;
	}
	function hasRole(account, role) { return Boolean(account && ROLE_LEVEL[account.role] >= ROLE_LEVEL[role]); }

	/* Resizes a picture in the browser (max 1600px, WebP) and uploads it: POST /api/uploads -> { url }. */
	function shrinkImage(file) {
		return new Promise(function (resolve, reject) {
			if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { reject(new Error('Choose a JPG, PNG, WebP or GIF picture.')); return; }
			if (file.type === 'image/gif') { file.size > 3 * 1024 * 1024 ? reject(new Error('GIFs must be under 3 MB.')) : resolve(file); return; }
			var url = URL.createObjectURL(file);
			var img = new Image();
			img.onload = function () {
				var scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
				var canvas = document.createElement('canvas');
				canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
				canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
				canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
				URL.revokeObjectURL(url);
				canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('That picture could not be processed.')); }, 'image/webp', 0.84);
			};
			img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not a readable picture.')); };
			img.src = url;
		});
	}
	function uploadImage(file) {
		if (!features.uploads) return Promise.reject(new Error('Picture uploads switch on once the upload backend is connected (features.uploads in config.js). Paste an image address for now.'));
		return shrinkImage(file).then(function (blob) {
			return api('uploads', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
		}).then(function (payload) {
			if (!payload.url) throw new Error('The upload service did not return an address.');
			return payload.url;
		});
	}

	window.DSDK = {
		t: t,
		uploadImage: uploadImage,
		cfg: cfg,
		feature: function (name) { return Boolean(features[name]); },
		api: api,
		me: me,
		setAccount: setAccount,
		onAccount: function (fn) { accountListeners.push(fn); },
		hasRole: hasRole,
		maybeStaff: function () { return get('dsdk.staff') === '1' || /[?&]edit=1/.test(location.search); },
		lang: function () { return lang; },
		onLang: function (fn) { langListeners.push(fn); },
		formatDate: formatDate,
		createCard: createCard,
		createMedia: createMedia,
		tintFor: tintFor,
		root: siteRoot,
		assetUrl: assetUrl,
		loadFeed: loadFeed,
		postUrl: postUrl
	};

	/* links and addresses that come from assets/js/config.js (single place to change them) */
	[].forEach.call(document.querySelectorAll('[data-cfg-href]'), function (a) {
		var value = cfg[a.getAttribute('data-cfg-href')];
		if (typeof value === 'string' && /^https:\/\//.test(value)) a.href = value;
	});
	[].forEach.call(document.querySelectorAll('[data-cfg-mail]'), function (a) {
		var value = (cfg.email || {})[a.getAttribute('data-cfg-mail')];
		if (value) {
			if (a.tagName === 'A') { a.href = 'mailto:' + value; a.textContent = value; }
			else a.setAttribute('data-copy', value);
		}
	});

	[].forEach.call(document.querySelectorAll('[data-socials]'), function (box) {
		var list = (cfg.socials || []).filter(function (item) { return item && /^https:\/\//.test(item.url || '') && item.label; });
		if (!list.length) { box.remove(); return; }
		list.forEach(function (item) {
			var a = document.createElement('a');
			a.href = item.url; a.rel = 'noopener noreferrer'; a.target = '_blank'; a.textContent = item.label;
			box.appendChild(a);
		});
	});

	var headerTools = document.querySelector('.header-tools');
	if (headerTools) {
		var dashboardLink = document.createElement('a');
		dashboardLink.className = 'icon-btn dashboard-btn';
		dashboardLink.href = siteRoot + 'manage.html';
		dashboardLink.setAttribute('data-i18n-aria', 'dashboard.open');
		dashboardLink.setAttribute('data-i18n-title', 'dashboard.open');
		dashboardLink.setAttribute('aria-label', t('dashboard.open'));
		dashboardLink.title = t('dashboard.open');
		dashboardLink.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>';
		headerTools.insertBefore(dashboardLink, headerTools.firstChild);
	}

	/* ---------- staff tools menu (publisher / editor / admin) ----------
	   One "Staff tools" button in the header, built only after the server confirms the signed-in role
	   (same D.me() / D.hasRole() used everywhere else; nothing here grants access, the Worker still checks every call).
	     - Links mirror the dashboard's role-gated tool list in manage.html (publisher+: publish, write).
	     - Toggle tools are registered by the page script that owns them: D.registerTool({ id, minRole, labelKey, hintKey, isOn, setOn }).
	       content.js registers the "Edit text & images" overlay (admin, same as the dashboard's own gate).
	   Toggle choices are remembered per account in this browser (localStorage), see D.toolPref / D.setToolPref. */
	var STAFF_LINKS = [
		{ id: 'publish', minRole: 'publisher', labelKey: 'tools.publish', href: 'publish.html' },
		{ id: 'write', minRole: 'publisher', labelKey: 'tools.write', href: 'write.html' }
	];
	var staffTools = {};
	var staffAccount = null;
	var toolsWrap = null, toolsBtn = null, toolsMenu = null;

	function toolKey(id) { return 'dsdk.tool.' + (staffAccount && staffAccount.id != null ? staffAccount.id : 'anon') + '.' + id; }
	function toolPref(id) { var v = get(toolKey(id)); return v === '1' ? true : v === '0' ? false : null; }
	function setToolPref(id, on) { set(toolKey(id), on ? '1' : '0'); }

	function closeToolsMenu(returnFocus) {
		if (!toolsMenu || toolsMenu.hidden) return;
		toolsMenu.hidden = true;
		toolsBtn.setAttribute('aria-expanded', 'false');
		if (returnFocus) toolsBtn.focus();
	}
	function buildToolsUi() {
		if (toolsWrap || !headerTools) return;
		toolsWrap = document.createElement('div');
		toolsWrap.className = 'tools-wrap';
		toolsBtn = document.createElement('button');
		toolsBtn.type = 'button';
		toolsBtn.className = 'icon-btn tools-btn';
		toolsBtn.setAttribute('aria-haspopup', 'true');
		toolsBtn.setAttribute('aria-expanded', 'false');
		toolsBtn.setAttribute('aria-controls', 'staff-tools-menu');
		toolsBtn.setAttribute('data-i18n-aria', 'tools.open');
		toolsBtn.setAttribute('data-i18n-title', 'tools.open');
		toolsBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5L3.5 17.1a1.7 1.7 0 0 0 2.4 2.4l5.8-5.8a4 4 0 0 0 5-5.4l-2.5 2.5-2.2-.5-.5-2.2z"/></svg>';
		toolsMenu = document.createElement('div');
		toolsMenu.id = 'staff-tools-menu';
		toolsMenu.className = 'tools-menu';
		toolsMenu.hidden = true;
		toolsMenu.setAttribute('role', 'region');
		toolsMenu.setAttribute('data-i18n-aria', 'tools.title');
		toolsBtn.addEventListener('click', function () {
			var open = toolsMenu.hidden;
			toolsMenu.hidden = !open;
			toolsBtn.setAttribute('aria-expanded', String(open));
		});
		document.addEventListener('click', function (event) { if (toolsWrap && !toolsWrap.contains(event.target)) closeToolsMenu(false); });
		document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeToolsMenu(true); });
		toolsWrap.appendChild(toolsBtn);
		toolsWrap.appendChild(toolsMenu);
		headerTools.insertBefore(toolsWrap, headerTools.firstChild);
	}
	function removeToolsUi() {
		if (toolsWrap) { toolsWrap.remove(); toolsWrap = toolsBtn = toolsMenu = null; }
	}

	function renderTools() {
		if (!staffAccount || !hasRole(staffAccount, 'publisher')) { removeToolsUi(); return; }
		var links = STAFF_LINKS.filter(function (item) { return hasRole(staffAccount, item.minRole); });
		var toggles = Object.keys(staffTools).map(function (id) { return staffTools[id]; }).filter(function (tool) { return hasRole(staffAccount, tool.minRole); });
		if (!links.length && !toggles.length) { removeToolsUi(); return; }
		buildToolsUi();
		if (!toolsMenu) return;

		toolsMenu.replaceChildren();
		var title = document.createElement('p');
		title.className = 'tools-menu__title';
		title.setAttribute('data-i18n', 'tools.title');
		title.textContent = t('tools.title');
		toolsMenu.appendChild(title);

		toggles.forEach(function (tool) {
			var on = Boolean(tool.isOn());
			var row = document.createElement('button');
			row.type = 'button';
			row.className = 'tools-menu__item tools-menu__toggle';
			row.setAttribute('role', 'switch');
			row.setAttribute('aria-checked', String(on));
			var text = document.createElement('span');
			var name = document.createElement('strong');
			name.setAttribute('data-i18n', tool.labelKey);
			name.textContent = t(tool.labelKey);
			text.appendChild(name);
			if (tool.hintKey) {
				var hint = document.createElement('small');
				hint.setAttribute('data-i18n', tool.hintKey);
				hint.textContent = t(tool.hintKey);
				text.appendChild(hint);
			}
			var state = document.createElement('span');
			state.className = 'tools-menu__state';
			state.setAttribute('data-i18n', on ? 'tools.on' : 'tools.off');
			state.textContent = t(on ? 'tools.on' : 'tools.off');
			row.appendChild(text);
			row.appendChild(state);
			row.addEventListener('click', function () {
				var next = !tool.isOn();
				if (tool.setOn(next) === false) { renderTools(); return; }     /* tool refused (e.g. unsaved edits kept) */
				setToolPref(tool.id, next);
				renderTools();
				var again = toolsMenu && toolsMenu.querySelectorAll('.tools-menu__toggle');
				var idx = toggles.indexOf(tool);
				if (again && again[idx]) again[idx].focus();
			});
			toolsMenu.appendChild(row);
		});

		links.forEach(function (item) {
			var a = document.createElement('a');
			a.className = 'tools-menu__item';
			a.href = siteRoot + item.href;
			var name = document.createElement('strong');
			name.setAttribute('data-i18n', item.labelKey);
			name.textContent = t(item.labelKey);
			a.appendChild(name);
			toolsMenu.appendChild(a);
		});
	}

	function registerTool(def) {
		if (!def || !def.id || typeof def.isOn !== 'function' || typeof def.setOn !== 'function') return;
		def.minRole = ROLE_LEVEL[def.minRole] != null ? def.minRole : 'admin';
		staffTools[def.id] = def;
		renderTools();
	}
	window.DSDK.registerTool = registerTool;
	window.DSDK.toolPref = toolPref;
	window.DSDK.setToolPref = setToolPref;

	function syncStaffTools(account) { staffAccount = account || null; renderTools(); }
	accountListeners.push(syncStaffTools);
	/* Regular visitors never hit this: the "who am I?" request only runs when this browser has signed in as staff before. */
	if (window.DSDK.maybeStaff()) me().then(syncStaffTools);


	applyLang();
})();
