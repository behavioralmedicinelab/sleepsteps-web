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

A full content editing guide is added in milestone M1b (see `SPEC.md` §19.2 for adding a video). For now:

- **Problem areas:** `data/areas.csv` (edit in Excel, save as CSV UTF-8).
- **Sleep problems:** one file per problem in `content/problems/<slug>.md` (SPEC §7.2).
- **Information pages:** `content/pages/*.md`. The front matter they take is described at the top of `src/_includes/layouts/info.njk`.
- **Crisis numbers** on Getting urgent help: `crisisContacts` in `site.config.json`. The smaller cards under them (your treating team, the cancer support line) are `other_contacts` in `content/pages/urgent-help.md`; a card becomes a phone link once its `value` is a real number.
- **GP summary** on Getting more help: put the PDF in `media/pdf/` and its file name in `gp_summary` in `content/pages/help.md`.

## Tests

`npm test` runs two Vitest projects: `worker` (the Worker, inside the Workers runtime) and `node` (the CSV parser, content data, and checks on a fresh build of the whole site). `npm test -- --project node` runs one of them.

## Licence

- **Content** (page text, transcripts, data files, handouts, audio and thumbnails): [CC BY 4.0](LICENSE-CONTENT.md). The SleepSteps name and logo, and third-party material, are not covered.
- **Code:** [MIT](LICENSE).
