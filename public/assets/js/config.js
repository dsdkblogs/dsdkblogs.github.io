/* Site settings + backend feature switches. Loaded first on every page.

   FEATURES: each one is OFF until its backend endpoint is deployed (see commands.txt).
   While a flag is false the matching admin tool still opens and works as a local, in-browser draft,
   and public pages skip the request so visitors never hit a missing endpoint.
     content     -> GET/PUT /api/content            (edit text + image sources straight from the site)
     custom      -> GET/PUT /api/custom             (per-page / per-post HTML + CSS from the Page lab)
     articles    -> GET/POST/PUT /api/articles      (static "docs style" article posts)
     uploads     -> POST /api/uploads               (image upload to R2 for articles and page images)
     threadTimer -> PATCH /api/blog-feed/thread     (turn the discussion timer off / set a custom close date)
*/
window.DSDK_CONFIG = {
	features: {
		content: true,
		custom: true,
		articles: true,
		uploads: true,
		threadTimer: true
	},
	kofiUrl: 'https://ko-fi.com/ankomstudios',
	padletUrl: 'https://padlet.com/ankomstudios/dsdkblogs',
	email: {
		blog: 'dsdkblogs@gmail.com',
		studio: 'ankomstudios@gmail.com'
	},
	/* Social profiles: leave empty until they exist. Nothing is rendered for empty entries. */
	socials: []
};
