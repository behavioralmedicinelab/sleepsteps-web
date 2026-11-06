// Example site searches and the page each must find (SPEC §8.4), run against
// the built /search-index.json with the site's own settings
// (src/js/search-config.js). Rerun after every change to data/keywords.csv or
// the settings (`npm test` does). When you add keywords for something new,
// add a query here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { describe, expect, inject, it } from 'vitest';
import { INDEX_OPTIONS, SEARCH_OPTIONS } from '../../src/js/search-config.js';

const documents = JSON.parse(readFileSync(path.join(inject('builtSite'), 'search-index.json'), 'utf8'));
const index = new MiniSearch(INDEX_OPTIONS);
index.addAll(documents);
const ranked = (query) => index.search(query, SEARCH_OPTIONS).map((result) => result.id);

// Someone in crisis may type into the site search: these must put Getting
// urgent help first.
const CRISIS = ['suicide', 'suicidal', 'self harm', 'hurt myself', 'crisis', 'emergency', 'unsafe', 'lifeline', '000', '13 11 14'];

// [query, the page_id that must be in the top 3]. A starter set, drafted with
// data/keywords.csv from the team's planning sheet and draft scripts.
const QUERIES = [
  ["can't sleep", 'tired-but-wired'],
  ['3am', 'cant-get-back-to-sleep'],
  ['waking in the night', 'cant-get-back-to-sleep'],
  ['clock watching', 'cant-get-back-to-sleep'],
  ['stimulus control', 'cant-get-back-to-sleep'],
  ['4am', 'waking-too-early'],
  ['waking up at night', 'broken-or-restless-sleep'],
  ["can't sleep through the night", 'broken-or-restless-sleep'],
  ['toilet at night', 'broken-or-restless-sleep'],
  ['groggy', 'not-refreshed-in-the-morning'],
  ['exausted', 'tiredness-and-fatigue'],
  ['activity pacing', 'tiredness-and-fatigue'],
  ['naps', 'sleepiness-during-the-day'],
  ['body clock', 'sleep-timing-all-over-the-place'],
  ['morning light', 'sleep-timing-all-over-the-place'],
  ['falling asleep on the couch', 'falling-asleep-too-early'],
  ['not sleepy', 'not-sleepy-at-bedtime'],
  ['sleep scheduling', 'not-sleepy-at-bedtime'],
  ['sleep drive', 'not-sleepy-at-bedtime'],
  ['sleep deprivation', 'anxiety-about-not-sleeping'],
  ['flashbacks', 'fear-or-panic-past-experiences'],
  ['grounding', 'fear-or-panic-past-experiences'],
  ['panic attacks', 'fear-or-panic-physical-symptoms'],
  ['breathless', 'fear-or-panic-physical-symptoms'],
  ['scared to go to bed', 'dreading-bed-hard-night'],
  ['symptoms worse at night', 'dreading-bed-symptoms'],
  ['racing thoughts', 'dreading-bed-active-mind'],
  ['mindfulness', 'dreading-bed-active-mind'],
  ['procrastination', 'putting-off-going-to-bed'],
  ['wind-down routine', 'no-time-to-wind-down'],
  ['sleep tracker', 'pressure-to-sleep-well'],
  ['trying too hard to sleep', 'pressure-to-sleep-well'],
  ['worry time', 'stress-and-worries'],
  ['scanxiety', 'stress-and-worries'],
  ['neuropathy', 'pain'],
  ['steroids', 'treatment-or-medication-side-effects'],
  ['chemo', 'treatment-or-medication-side-effects'],
  ['hot flashes', 'hot-flushes-and-night-sweats'],
  ['menopause', 'hot-flushes-and-night-sweats'],
  ['earplugs', 'uncomfortable-sleep-environment'],
  ['hospital', 'sleeping-in-hospital'],
  ['partner snores', 'sharing-a-bed'],
  ['my partner snores', 'sharing-a-bed'],
  ['baby', 'parents-of-young-children'],
  ['family', 'involving-others'],
  ['nothing works', 'sleep-not-improving-yet'],
  ['sleepless night', 'setbacks-and-bad-nights'],
  ['adapting stimulus control', 'following-sleep-advice'],
  ['sleep action plan', 'if-sleep-problems-return'],
  ['nightmears', 'dreams-and-nightmares'],
  ['sleep apnea', 'snoring'],
  ['restless legs', 'restless-legs'],
  ['new normal', 'accepting-changes-to-my-sleep'],
  ['breathing exercises', 'tired-but-wired'],
  ['insomnia', 'start'],
  ['melatonin', 'help'],
  ['clinical trial', 'about'],
  ['email', 'contact'],
  ['cookies', 'privacy'],
  ['tired all day', 'tiredness-and-fatigue'],
  ['leg cramps', 'pain'],
  ['nausea', 'treatment-or-medication-side-effects'],
  ['cancer came back', 'stress-and-worries'],
  ['anxiety at night', 'anxiety-about-not-sleeping'],
  ["i don't want to go to bed", 'putting-off-going-to-bed'],
  ['wind down', 'no-time-to-wind-down'],
  ['sleeping too much', 'sleepiness-during-the-day'],
  ['noisy neighbours', 'uncomfortable-sleep-environment'],
  ['my insomnia came back', 'if-sleep-problems-return'],
  ['trouble sleeping', 'start'],
  ['gp referral', 'help'],
  ['sleeping pills', 'help'],
];

describe('site search', () => {
  it.each(CRISIS)('"%s" puts Getting urgent help first', (query) => {
    expect(ranked(query)[0]).toBe('urgent-help');
  });

  it.each(QUERIES)('"%s" finds %s in the top 3', (query, expected) => {
    expect(ranked(query).slice(0, 3)).toContain(expected);
  });

  it('every expected page exists', () => {
    const ids = new Set(documents.map((d) => d.id));
    for (const [query, expected] of QUERIES) expect(ids.has(expected), `${query} -> ${expected}`).toBe(true);
  });
});
