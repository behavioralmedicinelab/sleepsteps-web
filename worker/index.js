// Single Worker for the site (SPEC §4). Requests that match a static file in
// dist/ never reach this code, and nor do browser navigations to unmatched
// paths: those get the 404 page straight from static assets. Other unmatched
// requests (fetch, beacons, crawlers) do reach it. /admin page loads will need
// `run_worker_first` in wrangler.jsonc (SPEC §18.2, M6).
//
// API routes (/api/*) and admin routes (/admin/*) arrive in later milestones
// (M3–M6). Until then they return 404, which is also how a disabled feature
// responds (SPEC §11).

const notFound = () => new Response('Not found', { status: 404 });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/api/')) {
      // The API stores nothing unless this environment's DATA_COLLECTION var
      // is exactly "on"; missing or any other value means off (SPEC §11).
      if (env.DATA_COLLECTION !== 'on') return notFound();
      // M3-M5 add the API routes here, after that check.
      return notFound();
    }

    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      return notFound();
    }

    // Anything else falls back to static assets, so unknown paths get the
    // site's 404 page (assets.not_found_handling in wrangler.jsonc).
    return env.ASSETS.fetch(request);
  },
};
