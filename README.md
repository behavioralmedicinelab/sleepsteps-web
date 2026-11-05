# sleepsteps-web

Website for a clinical trial of a stepped-care sleep intervention. It is a static site (Eleventy) plus a single Cloudflare Worker and a D1 database for optional anonymous ratings, feedback and usage events.

`SPEC.md` is the source of truth for how the site works and how it is built. The visual design handoff is in `docs/design/`.

## Quick start

Requires Node 22.12 or later (current LTS recommended).

```sh
npm install
npm run build   # build the site into dist/
npm run dev     # local site + Worker at http://localhost:8787
npm test        # run tests
```

`npm run dev` passes extra flags to `wrangler dev`, e.g. `npm run dev -- --port 8799`.

## Content editing

A content editing guide is added in milestone M1 (see `SPEC.md` §19.2 for adding a video).
