# SleepSteps website: design handoff

This is the build brief for the SleepSteps trial website. It comes from a design exploration on a Claude design canvas. Build what is described here. Where this document and the canvas disagree, this document wins.

- **Design canvas (visual reference):** https://claude.ai/code/artifact/131e318c-51e1-4d5d-a842-ce8dd8800817. The "Final set" page has the chosen designs; "Explorations" has the options we turned down.
- **Design system:** SleepSteps, https://claude.ai/code/artifact/44e13afa-2ac3-4010-ab86-3cc4a91c2549. Every value you need from it is copied into section 4 and into `reference/tokens.json`.
- **Reference bundle (next to this file):**
  - `reference/tokens.json`: design tokens.
  - `reference/sleepsteps-logo.svg`: the official stacked logo.
  - `reference/boards/*.dc.html`: source of the final mockups. The format is HTML with inline styles plus a small logic class. Use these for exact spacing, copy and layout. Don't copy their runtime (`support.js`, `<x-dc>`, `{{holes}}`, `<sc-for>`, `<dc-import>`), because it only exists inside the design tool.

---

## 1. What the site is

SleepSteps is a free, self-guided sleep program for people affected by cancer, delivered as short videos. It is part of a research trial. The tone is warm, calm and plain-spoken: a companion, not a clinic.

The flow:

1. **Home:** explains the program and how to use it.
2. **Start here:** a few introductory videos everyone should watch first.
3. **Sleep problems:** 36 problems in 10 areas. People pick the ones that sound like them.
4. **Problem page:** one page per problem, with:
   - a video about the problem and a short text description, so people can decide if it fits them;
   - up to 3 main solution videos;
   - up to 3 extra solution videos;
   - transcript, handout and audio options for every video;
   - star ratings and optional feedback on every video.
5. **Information pages:** getting more help, about, contact, privacy, urgent help.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Access | Public. No login and no accounts. |
| Intro gating | None. All content is open. The intro is recommended, not enforced, and there is no progress tracking. |
| Video hosting | YouTube, embedded (details in section 7). |
| Ratings | 1 to 5 stars on every video. Anonymous. |
| Feedback | An optional free-text box. It appears after someone rates a video, and is also reachable from a "Feedback" link. Anonymous. |
| Other formats | Every video offers a transcript, a handout and audio-only. The handout format is **not decided** (PDF, web page, or both), so build a clear slot for it. |
| Problem names | Shown as a **short title plus the full first-person line** wherever there is room. The short title alone is used in menus. |
| Grouping | 10 areas. "Thoughts, feelings and bedtime" stays as one group of 11. |
| Problem browser | An accordion of areas with live search. A toggle switches to a second view, **"When it happens"** (time-of-night lanes). |
| Problem page | Design A: **solution cards expand in place**. No separate pages for solutions. |
| Related topics | 2 or 3 per problem, **hand-picked** by the team (a content field). |
| Navigation | The same header and footer on every page. A side **topic menu** (an accordion of all 36 problems) on Start here and on problem pages. On phones the Menu button opens search, main links, the same accordion and "Get urgent help". |
| Referral page | For visitors who need more help (when to see a GP, how to see a sleep specialist). It is not for clinicians. |
| Contact | Email and phone listed. No contact form. |
| About page | Leads with why SleepSteps exists, then the team, then trial details. |
| Extra pages | Privacy and your data; Getting urgent help. |

## 3. Site map and suggested routes

| Page | Route | Mockup |
|---|---|---|
| Home | `/` | `Main.dc.html`, `Landing-Phone.dc.html` |
| Start here (intro videos) | `/start` | `Intro-B.dc.html` |
| Sleep problems | `/problems` | `Problems-A.dc.html`, `Problems-Phone.dc.html` |
| Problem page | `/problems/[slug]` | `Problem-A.dc.html`, `Problem-Phone.dc.html` |
| Getting more help | `/help` | `Info-Help.dc.html` |
| About | `/about` | `Info-About.dc.html` |
| Contact | `/contact` | `Info-Contact.dc.html` |
| Privacy and your data | `/privacy` | `Info-Privacy.dc.html` |
| Getting urgent help | `/urgent-help` | `Info-Urgent.dc.html` |

Area anchors such as `/problems#core` should open that area of the accordion.

## 4. Design tokens

All values come from the SleepSteps design system. Put them in CSS custom properties (or the framework's theme) and never hard-code hex values in components.

### Colour

| Token | Value | Use |
|---|---|---|
| `deep-teal` | `#0f6e56` | Primary. Hero bands, primary buttons, links, eyebrows, focus ring on light backgrounds. |
| `night-teal` | `#0a4438` | Teal-voiced headings; video frame background. |
| `teal-500` | `#2e8b72` | Decorative only (not a ground for small text). |
| `teal-200` | `#a8cfc3` | Decorative only. |
| `teal-wash` | `#e8f1ed` | Quiet panels, the selected item in menus. |
| `warm-clay` | `#c4714e` | **Fill only.** Filled rating stars. At most about 10% of a layout. |
| `clay-deep` | `#8a4a2c` | Text form of clay: tertiary links, "Get urgent help", the outline of filled stars. |
| `clay-wash` | `#f0e4d6` | "New" badge background, star hover, urgent-help notices. |
| `sand` | `#e7d9c4` | Warm panels (trial info, quotes). |
| `paper` | `#fbf9f5` | Page background; text on teal. |
| `white` | `#ffffff` | Cards, header, inputs. |
| `panel` | `#f6f4ef` | Notes and disclaimer panels. |
| `ink` | `#17211e` | Body text; footer background. |
| `slate-grey` | `#5a6b65` | Secondary text. Do not use on `sand`. |
| `keyline` | `#dce4e0` | 1px decorative borders only. Interactive borders use `deep-teal` or `slate-grey`. |
| `on-teal-muted` | `#c8ddd6` | Secondary text on dark grounds (17px and up on `deep-teal`). |

Rules:

- Teal covers at least a quarter of every screen.
- Clay stays at or below a tenth.
- Text on `deep-teal` or `night-teal` is `paper`.

### Type

- **Headings:** Figtree, weights 400, 500 and 600, plus italic 400. Sentence case, letter-spacing −0.01em.
- **Body and interface:** Source Sans 3, weights 300, 400 and 600.
- Both load from Google Fonts. Use `display=swap`.

| Style | Spec |
|---|---|
| display | Figtree 56/1.1, weight 400. One per page (the home hero). Interior pages use 44–48px. |
| section-heading | Figtree 32/1.2, weight 400 |
| title | Figtree 24/1.3, weight 500 |
| card-title | Figtree 20/1.3, weight 400 |
| quote | Figtree 24/1.45, italic. Used for the problem's first-person line and for lived-experience quotes. |
| body | Source Sans 3, 17px/28px. **17px is the minimum for running text.** |
| body-light | Source Sans 3, 17–19px, weight 300. Hero sublines on teal. |
| label | Source Sans 3, 15/20, weight 600. Buttons, navigation, form labels. |
| helper | Source Sans 3, 14/20. Metadata and card descriptions. |
| eyebrow | Source Sans 3, 13/16, weight 600, uppercase, 0.1em letter-spacing, `deep-teal`. **This is the only uppercase in the system.** |

### Spacing, radius and shadow

- **Spacing:** 4, 6, 8, 12, 16, 20, 24 and 32px. Cards are padded 24–32px. Grid gaps are 20px.
- **Radius:**
  - 4px: duration badges.
  - 6px: buttons and inputs.
  - 8px: cards, panels and video frames.
  - 999px: chips and pills.
  - 24px top corners: time-of-night lane headers.
- **Shadow:** on hover only, `0 0 0 1px #dce4e0, 0 6px 20px rgba(15,110,86,.12)`. Never a shadow on an element at rest.
- **Content width:** about 1200–1360px, centred, with 24px side gutters (16px on phones).

### Brand devices

- **Logo:** `reference/sleepsteps-logo.svg`, the stacked staircase-and-Zs version. It sits top-left at 68px tall on desktop and 56px on phones, and links home. Use it only on `white` or `paper`, unaltered.
- **Settling arc:** a wide, shallow curve at the base of hero bands, filled `paper` over teal. The SVG path is in `Main.dc.html`.
- **Arched photo frame** in the home hero. Radius `220px 220px 8px 8px`.
- **Step chips:** a numbered disc plus a label ("Step 1"). Used on the home "how it works" cards and on solution cards.
- **No emoji and no decorative icons.** The only glyphs are the play triangle, the star, a chevron, search, menu/close, download, a transcript-lines icon and a headphones icon. Draw them as simple rounded stroke SVGs.

## 5. Shared components

Build these first. Every page uses them.

| Component | Mockup | Spec |
|---|---|---|
| `SiteHeader` | `SiteHeader.dc.html` | Contents: logo, nav (Start here, Sleep problems, About, Contact), a search input with a submit button, and a "Get urgent help" link in `clay-deep`. Takes a `current` prop. The current item is `deep-teal` with a 2px underline and `aria-current="page"`. Wraps on narrow screens. |
| `SiteFooter` | `SiteFooter.dc.html` | Background `ink`. Contents: the name plus "SleepSteps does not replace care from your treating team", two link columns, and a bottom row with the Acknowledgement of Country and trial registration / ethics placeholders. Links are `paper`; use a `paper` focus ring here. |
| `TopicNav` | `TopicNav.dc.html` | Side accordion, about 300–320px wide, in three sections. **Start here:** a link to `/start`, plus that page's three chapter links when you're on it. **Sleep problems:** 10 area buttons, each with a chevron and a count; opening one lists its problems by short title, and the current problem is highlighted with a `teal-wash` background and a 3px left bar. **Info links** at the bottom. The current problem's area opens by default. Not sticky. It stacks above the content on narrow screens. |
| `MobileHeader` | `PhoneHeader.dc.html` | The logo plus a Menu/Close toggle. The open panel holds search, a 2×2 grid of main links, `TopicNav` and a "Get urgent help" button. |
| `VideoEmbed` | (all pages) | Privacy-respecting YouTube embed (section 7). Plain 16:9 frame, `night-teal` placeholder background, 8px radius, a duration badge. |
| `StarRating` | (all videos) | 5 stars, each a 44×44px target. Unfilled: `slate-grey` outline. Filled: `warm-clay` fill with a `clay-deep` outline. Below it, a status line ("Thanks. You rated this 4 of 5." / "Ratings are anonymous."). Build it as a **radio group** (`role="radiogroup"`, with arrow-key support) rather than the toggle buttons used in the mockup. People can change their rating. |
| `FeedbackForm` | (all videos) | Hidden until someone rates the video or clicks "Feedback". Contains: the label "Anything you'd like to add? (optional)", a textarea, a Send button, and the helper "Anonymous. Please don't include your name or health details." After sending, show an inline thank-you. |
| `FormatLinks` | (all videos) | Three outlined buttons. **Read transcript:** expands inline, with a "Print transcript" link. **Handout:** the format is to be decided. **Audio only.** Hide any option that has no content. |
| `SolutionCard` | `Problem-A.dc.html` | See section 6.4. |
| `AreaAccordion`, `TimeLanes` | `Problems-A.dc.html` | See section 6.3. |
| `Breadcrumb` | `Problem-A.dc.html` | Sleep problems › Area › Problem. |

## 6. Page specs

### 6.1 Home (`/`)

The sections, in order:

1. Header.
2. **Hero** on `deep-teal`:
   - an eyebrow;
   - the display line "Sleep can be hard after cancer. It can also get better.";
   - a subline;
   - a primary button, "Start with the introduction" (`paper` background, `night-teal` text, play icon);
   - a secondary outline button, "Browse sleep problems";
   - an arched photo on the right (placeholder for now);
   - the settling arc at the base.
3. **How it works:** three step cards (Watch the introduction → Choose what's keeping you up → Try what fits you), each with a step chip and a coloured top rule (`deep-teal` / `teal-500` / `teal-200`).
4. **What's getting in the way of your sleep?:** a grid of 10 area cards (name, one-line description, topic count). Each links to `/problems#area`. Also a "See all 36 sleep problems" link.
5. **Watch, read or print:** a `teal-wash` panel explaining the three formats.
6. **About the trial:** a `sand` band with a short trial blurb, plus a "Need more help?" card linking to `/help`.
7. A disclaimer panel linking to `/urgent-help`.
8. Footer.

### 6.2 Start here (`/start`)

1. Header.
2. A teal band:
   - eyebrow "Start here";
   - heading "The introduction";
   - the line "Three short videos everyone watches first";
   - three chapter pills that jump to `#v1`, `#v2` and `#v3`.
3. A two-column body: `TopicNav` on the left (Start here selected) and the chapters on the right.
4. Each chapter has:
   - a large faint number;
   - an eyebrow "Video n of 3 · duration";
   - a title and a one-line description;
   - a `VideoEmbed`;
   - a white bar holding "Was this helpful?", `StarRating`, Transcript, Handout and Send feedback;
   - a `FeedbackForm` that expands under the bar once rated.
5. An end card on `deep-teal`: "Choose what's keeping you up" with a button to `/problems`.
6. Footer.

The intro video titles in the mockup (How sleep works / Why cancer can change sleep / How to use SleepSteps) are **placeholders**.

### 6.3 Sleep problems (`/problems`)

1. Header.
2. A teal band:
   - eyebrow "Step 2";
   - heading "What's keeping you up?";
   - a search field;
   - a **view toggle**, a segmented control: "By area" (default) or "When it happens";
   - an "Open all areas" / "Close all areas" button (By area view only);
   - a live result line ("36 topics in 10 areas" / "4 topics match 'night'"), with `aria-live="polite"`.
3. **By area:** 10 accordion cards.
   - Each header is a `<button aria-expanded>` with the area name (Figtree 24, `night-teal`), a description, a count and a round chevron.
   - When open, it shows a 2-column grid of problem links. Each link has the short title (Figtree 19), the full line (15px, `slate-grey`) and an arrow. New topics carry a "New" pill (`clay-wash` / `clay-deep`).
   - The first area is open by default.
4. **When it happens:** six lanes in a responsive grid: In the evening, At bedtime, During the night, Early morning, During the day, Any time.
   - Lane header colours run from `deep-teal` → `night-teal` → `ink` → `teal-wash` → `sand` → `panel`, with rounded tops.
   - Under each header, problem cards stacked (title plus line).
5. **Search** filters both views as you type.
   - It matches the short title, the full line and the area name, and should also match a `keywords` field (synonyms such as "3am", "menopause", "partner snores").
   - In the By area view, areas with no matches are hidden and areas with matches open automatically.
6. A nudge panel: "Haven't watched the introduction yet?" with a link to `/start`.
7. Footer.

### 6.4 Problem page (`/problems/[slug]`)

This follows design A, based on the original hand sketch.

1. Header.
2. A two-column body: `TopicNav` on the left (the current problem highlighted and its area open), main content on the right.
3. **Top of main:**
   - breadcrumb;
   - H1 short title (Figtree 44, `night-teal`);
   - the first-person line as a quote (Figtree italic 22).
4. **Problem block:** a `VideoEmbed` on the left (about 60%) and an **"Is this you?"** panel (`teal-wash`) on the right (about 40%).
   - Under the video: "Was this helpful?" with `StarRating`, plus Transcript, Handout and Feedback links.
   - The panel holds 1 or 2 plain sentences, a "This topic may help if you:" list of 2–4 bullets, and "Not quite? Try [related topic]".
5. **Main solutions:** eyebrow "Things to try", heading "Main solutions", a one-line intro, then a grid of `SolutionCard`s.
6. **Other things that can help:** eyebrow "If you want more", then the same grid, using `teal-500` for the thumbnail band. **Must come after the main solutions.**
7. **Related topics:** 2 or 3 hand-picked cards (title plus line), then "Back to all sleep problems".
8. Footer.

**Solution counts vary.** A problem can have 1–3 main solutions and 0–3 extras. With no extras, hide that section completely. The grid auto-fills (`minmax(280px, 1fr)`), so 1, 2 or 3 cards all lay out cleanly.

**SolutionCard behaviour:**

- **Closed:** a whole-card button (`aria-expanded="false"`) showing:
  - a thumbnail band with a play icon, a step chip ("1 Main" / "1 Extra") and a duration badge;
  - the title (Figtree 20);
  - a 1–2 sentence "try this if…" blurb.

  Under the button: the rating status plus quick Transcript and Handout links.
- **Open:** the card spans the full grid row (`grid-column: 1 / -1`) with a 2px `deep-teal` border.
  - Left: the `VideoEmbed`.
  - Right: chip, Close button, title, blurb, `StarRating`, `FormatLinks`, an inline transcript, and the `FeedbackForm` once rated.
- **Only one card is open at a time** across both sections. Opening a card moves focus to its heading.
- Show the open/closed state with `aria-expanded`, and give the region a label.

**Phone version** (`Problem-Phone.dc.html`):

- A back link to the area, the H1, the quote line, and "On this page" jump chips ("About this" / "3 main solutions" / "2 more").
- The problem video runs full-bleed, followed by the rating and the "Is this you?" panel.
- Solutions show as a stacked accordion. When one opens, the video, centred stars and a 3-button format grid appear.

### 6.5 Information pages

All use the header, a teal title band, a left "Information" side menu (Getting more help, About SleepSteps, Contact us, Privacy and your data, Getting urgent help) and the footer.

- **Getting more help** (`/help`):
  - "When to talk to your doctor": a list for the clinical team to confirm.
  - "Seeing a sleep specialist": 3 numbered steps, plus "Print a one-page summary for your GP".
  - "Other support": 3 service cards.
  - An urgent-help notice.
- **About** (`/about`): a hero ("Sleep after cancer often gets missed. We want to change that."), "Why we made SleepSteps", a lived-experience quote on `sand`, a "Who we are" team grid (photo, name, role), and an "About the trial" definition list (what it tests, who runs it, funding, ethics, registration).
- **Contact** (`/contact`): email and phone cards, a "What we can help with" panel, and a notice that this contact is not for urgent help.
- **Privacy and your data** (`/privacy`): "What we collect" (ratings, optional feedback, anonymous visit stats) and "What we don't collect" cards, "Our videos are on YouTube", "How we use ratings and feedback", and contacts for questions.
- **Getting urgent help** (`/urgent-help`):
  - A deliberately minimal header (logo plus "Back to SleepSteps") and no footer.
  - Large tappable cards:
    - Emergency: 000.
    - Lifeline: 13 11 14, 24 hours.
    - Your treating team.
    - A cancer support line (placeholder).
  - A note that SleepSteps is not a crisis service.
  - **The team must confirm these numbers and the region they apply to.**
  - Link to this page from every header and footer.

## 7. YouTube embedding

- Use `https://www.youtube-nocookie.com/embed/{id}` (privacy-enhanced mode).
- Parameters: `rel=0` (end-of-video suggestions come only from the same channel), `modestbranding=1`, `cc_load_policy=1` if captions should be on by default (to confirm), `playsinline=1`. **Never autoplay.**
- Use a **click-to-load facade**: show a thumbnail and a play button, and only insert the iframe when someone clicks. A `lite-youtube` style component does this. It keeps pages fast and avoids loading YouTube until someone chooses to play.
- Every iframe gets a `title` naming the video.
- Ratings, feedback and formats sit **outside** the player (YouTube's player can't be customised).
- Make sure every video has proper captions uploaded to YouTube. Don't rely on auto-captions.

## 8. Content model

Store content as structured data (JSON, MDX or a headless CMS) so the team can edit it without touching code.

```ts
type Area = {
  id: 'core'|'day'|'clock'|'mind'|'med'|'env'|'social'|'hard'|'relapse'|'dis';
  name: string;          // plain-language name shown on the site
  description: string;   // one line
  sourceName: string;    // the team's original category label
  order: number;
};

type TimeOfDay = 'evening'|'bedtime'|'night'|'early-morning'|'day'|'any';

type Video = {
  id: string;
  youtubeId: string;
  title: string;
  duration: string;        // "6:40"
  transcript?: string;     // markdown
  handoutUrl?: string;     // format TBD
  audioUrl?: string;
};

type Solution = {
  tier: 'main'|'extra';
  order: number;           // 1–3 within tier
  blurb: string;           // 1–2 sentences: "try this if…"
  video: Video;
};

type Problem = {
  slug: string;
  areaId: Area['id'];
  timeOfDay: TimeOfDay;
  shortTitle: string;      // menus, H1
  statement: string;       // first-person line
  sourceTitle: string;     // the team's original wording
  isNew?: boolean;
  keywords?: string[];     // search synonyms
  isThisYou: { summary: string; bullets: string[] };
  problemVideo: Video;
  solutions: Solution[];   // 1–3 main, 0–3 extra
  related: string[];       // 2–3 hand-picked slugs
};

type IntroVideo = Video & { order: 1|2|3; description: string };
```

### The 36 problems

These are the area, time-of-day and wording choices made during design. **The team should review the area and time placements.**

| Area id | Name on site | Team's original category |
|---|---|---|
| `core` | Falling and staying asleep | Core insomnia problems |
| `day` | Getting through the day | Daytime functioning |
| `clock` | Body clock and timing | Circadian |
| `mind` | Thoughts, feelings and bedtime | Cognitive, emotional |
| `med` | Symptoms and treatment effects | Medical sxs, side effects |
| `env` | Where you sleep | Environment |
| `social` | Partners, family and others | Social, r/s |
| `hard` | When it feels hard | Challenges with CBT-I |
| `relapse` | Keeping sleep on track | Relapse prevention |
| `dis` | Other sleep conditions | Sleep disorders / sxs |

"Introduction / psychoeducation" maps to **Start here**.

```json
[
  {"slug":"tired-but-wired","areaId":"core","timeOfDay":"bedtime","shortTitle":"Tired but wired","statement":"I'm tired, but I can't fall asleep","sourceTitle":"I am struggling to fall asleep at night: 1) I am tired but can't sleep ('tired but wired')"},
  {"slug":"not-sleepy-at-bedtime","areaId":"core","timeOfDay":"bedtime","shortTitle":"Not sleepy at bedtime","statement":"My body is awake at bedtime and wants to keep going","sourceTitle":"I am struggling to fall asleep at night: 2) I am not sleepy at bedtime (my body is awake & wants to keep going)"},
  {"slug":"cant-get-back-to-sleep","areaId":"core","timeOfDay":"night","shortTitle":"Can't get back to sleep","statement":"I struggle to get back to sleep in the night","sourceTitle":"I am struggling with getting back to sleep in the night"},
  {"slug":"waking-too-early","areaId":"core","timeOfDay":"early-morning","shortTitle":"Waking too early","statement":"I wake up too early","sourceTitle":"I am struggling with waking up too early"},
  {"slug":"broken-or-restless-sleep","areaId":"core","timeOfDay":"night","shortTitle":"Broken or restless sleep","statement":"I wake a lot, or my sleep is light, broken or restless","sourceTitle":"I am struggling with lots of awakenings, light, broken, restless or disturbed sleep"},
  {"slug":"not-refreshed-in-the-morning","areaId":"core","timeOfDay":"early-morning","shortTitle":"Not refreshed in the morning","statement":"Even when I sleep, I don't feel refreshed","sourceTitle":"Even when I sleep fine, I do not feel refreshed in the morning"},
  {"slug":"tiredness-and-fatigue","areaId":"day","timeOfDay":"day","shortTitle":"Tiredness and fatigue","statement":"Tiredness or fatigue affects how I function during the day","sourceTitle":"Tiredness or fatigue affecting my ability to function during the day"},
  {"slug":"sleepiness-during-the-day","areaId":"day","timeOfDay":"day","shortTitle":"Sleepiness during the day","statement":"I struggle to stay awake during the day","sourceTitle":"I am struggling with sleepiness or staying awake during the day"},
  {"slug":"sleep-timing-all-over-the-place","areaId":"clock","timeOfDay":"day","shortTitle":"Sleep timing all over the place","statement":"I can't sleep until morning, or I sleep at odd times","sourceTitle":"My sleep timing is all over the place (e.g., I can't sleep until morning, I sleep at odd times)"},
  {"slug":"falling-asleep-too-early","areaId":"clock","timeOfDay":"evening","shortTitle":"Falling asleep too early","statement":"I fall asleep too early in the evening","sourceTitle":"I am falling asleep too early in the evening"},
  {"slug":"anxiety-about-not-sleeping","areaId":"mind","timeOfDay":"bedtime","shortTitle":"Anxiety about not sleeping","statement":"I worry about not sleeping and what it will do to me","sourceTitle":"I am struggling with anxiety about not sleeping and the consequences of lack of sleep"},
  {"slug":"fear-or-panic-past-experiences","areaId":"mind","timeOfDay":"night","shortTitle":"Fear or panic at night: past experiences","statement":"Linked to treatment, cancer, or other hard memories","sourceTitle":"I feel fear or panic at night 1. (related to past experiences of tx, cancer, other events, or traumatic memories)"},
  {"slug":"fear-or-panic-physical-symptoms","areaId":"mind","timeOfDay":"night","shortTitle":"Fear or panic at night: physical symptoms","statement":"Linked to symptoms like breathlessness or pain","sourceTitle":"I feel fear or panic at night 2. (related to physical symptoms, pain, e.g. lung removed > breathlessness > panic)"},
  {"slug":"dreading-bed-hard-night","areaId":"mind","timeOfDay":"bedtime","shortTitle":"Dreading bed: expecting a hard night","statement":"I dread bed because I expect another difficult night","sourceTitle":"I dread going to bed because: 1) I expect another difficult night of sleep"},
  {"slug":"dreading-bed-symptoms","areaId":"mind","timeOfDay":"bedtime","shortTitle":"Dreading bed: symptoms worse at night","statement":"I dread bed because symptoms feel worse at night","sourceTitle":"I dread going to bed because: 2) symptoms or physical sensations feel worse at night"},
  {"slug":"dreading-bed-active-mind","areaId":"mind","timeOfDay":"bedtime","shortTitle":"Dreading bed: an active mind","statement":"My mind gets busier or more emotional at night","sourceTitle":"I dread going to bed because: 3) my mind becomes more active or emotional at night"},
  {"slug":"putting-off-going-to-bed","areaId":"mind","timeOfDay":"evening","shortTitle":"Putting off going to bed","statement":"I put off going to bed, even when I'm tired","sourceTitle":"I find it difficult to go to bed when I think I should / I procrastinate with or avoid my bed time / I put off going to bed even when I am tired"},
  {"slug":"no-time-to-wind-down","areaId":"mind","timeOfDay":"evening","shortTitle":"No time to wind down","statement":"I'm busy right up until bedtime","sourceTitle":"I struggle to find time to wind down before sleep (busy right up to bed time)"},
  {"slug":"pressure-to-sleep-well","areaId":"mind","timeOfDay":"any","shortTitle":"Pressure to sleep well","statement":"I feel I must sleep well for my recovery, and like I'm failing when I don't","sourceTitle":"I feel pressure to sleep well for my health or recovery, and feel discouraged or like I am failing when sleep is difficult"},
  {"slug":"stress-and-worries","areaId":"mind","timeOfDay":"any","shortTitle":"Stress and worries","statement":"Stress or worry about cancer or life is affecting my sleep","sourceTitle":"I am struggling with stress/worries affecting my sleep (about cancer or life)"},
  {"slug":"accepting-changes-to-my-sleep","areaId":"mind","timeOfDay":"any","shortTitle":"Accepting changes to my sleep","statement":"It's hard to accept how my sleep has changed since cancer","sourceTitle":"NEW: I am finding it hard to accept the changes to my sleep post cancer - ACT and compassion","isNew":true},
  {"slug":"pain","areaId":"med","timeOfDay":"night","shortTitle":"Pain","statement":"Pain is affecting my sleep","sourceTitle":"I am struggling because of pain affecting my sleep"},
  {"slug":"treatment-or-medication-side-effects","areaId":"med","timeOfDay":"any","shortTitle":"Treatment or medication side effects","statement":"Treatment or medicines are affecting my sleep","sourceTitle":"I am struggling from treatment or medication side effects impacting my sleep"},
  {"slug":"hot-flushes-and-night-sweats","areaId":"med","timeOfDay":"night","shortTitle":"Hot flushes and night sweats","statement":"Hot flushes or night sweats wake me up","sourceTitle":"I am struggling because of hot flushes or night sweats affecting my sleep"},
  {"slug":"uncomfortable-sleep-environment","areaId":"env","timeOfDay":"any","shortTitle":"An uncomfortable sleep environment","statement":"Noise, light or physical discomfort where I sleep","sourceTitle":"My sleep environment is not comfortable (e.g., noise, light, physical discomfort)"},
  {"slug":"sleeping-in-hospital","areaId":"env","timeOfDay":"any","shortTitle":"Sleeping in hospital","statement":"I struggle to sleep in hospital","sourceTitle":"I am struggling with sleep in hospital"},
  {"slug":"sharing-a-bed","areaId":"social","timeOfDay":"any","shortTitle":"Sharing a bed","statement":"Managing sleep when you have a bed partner","sourceTitle":"Managing sleep when you have a bedpartner"},
  {"slug":"parents-of-young-children","areaId":"social","timeOfDay":"any","shortTitle":"Parents of young children","statement":"Sleep when you're caring for young children","sourceTitle":"For parents of young children"},
  {"slug":"involving-others","areaId":"social","timeOfDay":"any","shortTitle":"Involving others","statement":"Bringing others into your sleep and recovery","sourceTitle":"Involving others in your sleep and recovery"},
  {"slug":"sleep-not-improving-yet","areaId":"hard","timeOfDay":"any","shortTitle":"My sleep is not improving yet","statement":"I've been trying, but my sleep isn't better yet","sourceTitle":"My sleep is not improving yet"},
  {"slug":"setbacks-and-bad-nights","areaId":"hard","timeOfDay":"any","shortTitle":"Setbacks and bad nights","statement":"What to do after a bad night or a setback","sourceTitle":"Set backs and bad nights"},
  {"slug":"following-sleep-advice","areaId":"hard","timeOfDay":"any","shortTitle":"Following sleep advice","statement":"I find it hard to follow the sleep advice","sourceTitle":"I am struggling to follow sleep advice"},
  {"slug":"if-sleep-problems-return","areaId":"relapse","timeOfDay":"any","shortTitle":"If sleep problems return","statement":"What if my sleep problems come back?","sourceTitle":"What if my sleep problems return? - A guide to relapse prevention"},
  {"slug":"dreams-and-nightmares","areaId":"dis","timeOfDay":"night","shortTitle":"Dreams and nightmares","statement":"Distressing, vivid dreams or nightmares","sourceTitle":"I am struggling with distressing, vivid dreams or nightmares"},
  {"slug":"snoring","areaId":"dis","timeOfDay":"night","shortTitle":"Snoring","statement":"I'm concerned about snoring","sourceTitle":"I am concerned about snoring"},
  {"slug":"restless-legs","areaId":"dis","timeOfDay":"night","shortTitle":"Restless legs","statement":"My legs feel restless at night","sourceTitle":"I am struggling with restless legs"}
]
```

Area descriptions used in the mockups:

| Area | Description |
|---|---|
| core | Trouble getting to sleep, staying asleep, or waking unrefreshed. |
| day | Fatigue and sleepiness while you're awake. |
| clock | Sleep that happens at the wrong times. |
| mind | Worry, fear and dread at night, and the habits around bedtime. |
| med | When your body or your treatment keeps you awake. |
| env | Your bedroom, or sleeping somewhere else. |
| social | Sleep and the people around you. |
| hard | When the program, or progress, is a struggle. |
| relapse | Looking after your sleep from here on. |
| dis | Things worth knowing about, and when to check with a doctor. |

## 9. Ratings and feedback

- **Anonymous.** No names, emails or accounts. Don't use third-party trackers to tie a rating to a person.
- **Rating record:** `{ videoId, pageSlug, rating (1–5), createdAt, clientId }`. `clientId` is a random ID kept in `localStorage` (wrapped in try/catch) so that someone who changes their rating updates it instead of adding a second one. Show the person's own earlier rating when they come back, if the ID is available.
- **Feedback record:** `{ videoId, pageSlug, rating?, text (max ~1000 chars), createdAt }`.
- Add basic spam and abuse protection: rate limiting, a honeypot field, and length limits.
- The research team needs an export (CSV) of ratings and feedback by video. Confirm with them where the data must be stored (for example, an institution-approved location) and how long it is kept. The Privacy page must match.
- Nothing about this is decided yet. **Ask the team** before choosing a storage service.

## 10. Accessibility and quality bar

- Meet WCAG 2.2 AA. Every colour pair in section 4 has been checked. Don't introduce new ones without checking contrast (4.5:1 for body text, 3:1 for large text and UI elements).
- Focus ring: a 2px solid ring with a 2px offset. `deep-teal` on light backgrounds, `paper` on teal or ink backgrounds.
- Touch targets at least 44×44px.
- Use semantic elements: `<button>` for toggles, `<a href>` for navigation, real `<label>`s, landmarks (`header`, `nav` with labels, `main`, `footer`), and one H1 per page.
- Accordions and expanding cards use `aria-expanded`. Search results use an `aria-live` count.
- Respect `prefers-reduced-motion`. Motion is limited to fades and expand/collapse, 120–320ms, with nothing pulsing or bouncing.
- Body text is never smaller than 17px. The site must work at 200% zoom and at a width of 320px.
- Writing style: sentence case everywhere except eyebrows. Plain words over medical terms. No exclamation marks. No emoji.

## 11. Responsive behaviour

- Desktop content max-width is 1200–1360px. Two-column layouts (side menu plus content) use `flex-wrap` and stack below about 900px, with the menu above the content.
- On phones (below about 600px), `MobileHeader` replaces the desktop header and `TopicNav` moves into the menu panel.
- The home hero buttons stack full-width. Grids collapse to one column. Video embeds run full-bleed.
- Phone mockups exist for Home, Sleep problems and the Problem page. There is no phone mockup for Start here: follow the problem page's phone patterns.

## 12. Placeholders and open questions

Everything in `[square brackets]` in the mockups is a placeholder.

**Content (all placeholders):**

- The intro video titles and descriptions.
- Every solution title and blurb. These were invented to fill the layout.
- The "Is this you?" text and bullets for each problem.
- Hero and About photography: real photos of people at home in warm evening light, not clinical stock.
- Trial details, team names and roles, lived-experience quotes (with permission), Acknowledgement of Country, trial registration, ethics number, funder.
- Contact email, phone and hours.
- Support line numbers.

**Decisions still needed:**

- **Handout format:** PDF, web page, or both.
- **Audio-only versions:** are they being made? If not, hide that option.
- **Urgent help:** confirm the numbers and the region. The mockup assumes Australia (000, Lifeline 13 11 14).
- **Captions on by default:** yes or no.
- **Ratings and feedback storage,** the analytics tool (if any), and privacy wording.
- **Area and time-of-day placement** of each problem (section 8).
- **Search keywords and synonyms** per problem.
- **Related topics** per problem (2–3 hand-picked).
- **Logo:** whether a horizontal lockup exists. At header size the stacked logo's wordmark is small.

## 13. Suggested build order

1. Project setup, design tokens, fonts, base styles, logo.
2. `SiteHeader`, `SiteFooter`, `MobileHeader`, `TopicNav`, using the content data in section 8.
3. `VideoEmbed` (with the facade), `StarRating`, `FeedbackForm`, `FormatLinks`.
4. The Sleep problems page (accordion, search, time view).
5. The problem page template with `SolutionCard`. Test it with 1, 2 and 3 main solutions and 0–3 extras.
6. Start here, then Home.
7. The information pages.
8. Ratings and feedback backend (after the team confirms storage).
9. Accessibility pass (keyboard, screen reader, zoom, contrast), then a performance pass (no YouTube loaded before a click).

The framework is open. A static-first framework (for example Astro or Next.js with static generation) suits this content-heavy site. Confirm the hosting constraints with the team before choosing.
