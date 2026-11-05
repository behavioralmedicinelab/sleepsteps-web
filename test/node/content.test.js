// The areas and the 36 problem files match the handoff's content model
// (SPEC §7.2; HANDOFF §8). M1b adds full content validation.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvRecords } from '../../scripts/lib/csv.js';

const handoff = readFileSync('docs/design/HANDOFF.md', 'utf8');
const handoffProblems = JSON.parse(handoff.match(/```json\n([\s\S]*?)\n```/)[1]);
const areas = parseCsvRecords(readFileSync('data/areas.csv', 'utf8'));

// The problem files use only `key: value` lines, with strings written as
// JSON-style double-quoted scalars (valid YAML). Eleventy parses them with
// js-yaml; this reader checks the values against the handoff.
function frontMatter(file) {
  const block = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)[1];
  return Object.fromEntries(
    block.split('\n').map((line) => {
      const [, key, raw] = line.match(/^([a-z_]+): (.*)$/);
      return [key, raw.startsWith('"') ? JSON.parse(raw) : /^\d+$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw];
    }),
  );
}

describe('data/areas.csv', () => {
  it('has the SPEC §7.2 columns', () => {
    expect(Object.keys(areas[0])).toEqual(['area_id', 'name', 'description', 'source_name', 'order']);
  });

  it('has the 10 handoff areas in order 10..100', () => {
    expect(areas.map((a) => [a.area_id, a.order])).toEqual(
      ['core', 'day', 'clock', 'mind', 'med', 'env', 'social', 'hard', 'relapse', 'dis'].map((id, i) => [id, String((i + 1) * 10)]),
    );
  });

  it.each(areas.map((a) => [a.area_id, a]))('%s matches the handoff name, source name and description', (id, area) => {
    const row = handoff.match(new RegExp(`^\\| \`${id}\` \\| (.+?) \\| (.+?) \\|$`, 'm'));
    expect([area.name, area.source_name]).toEqual([row[1], row[2]]);
    const desc = handoff.match(new RegExp(`^\\| ${id} \\| (.+?) \\|$`, 'm'));
    expect(area.description).toBe(desc[1]);
  });
});

describe('content/problems', () => {
  const files = readdirSync('content/problems').filter((f) => f.endsWith('.md'));

  it('has one file per handoff problem', () => {
    expect(files.map((f) => f.replace(/\.md$/, '')).sort()).toEqual(handoffProblems.map((p) => p.slug).sort());
  });

  it.each(handoffProblems.map((p, i) => [p.slug, p, i]))('%s matches the handoff', (slug, p) => {
    const fm = frontMatter(`content/problems/${slug}.md`);
    const order = handoffProblems.filter((q) => q.areaId === p.areaId).findIndex((q) => q.slug === slug) + 1;
    expect(fm).toEqual({
      title: p.shortTitle,
      statement: p.statement,
      source_title: p.sourceTitle,
      area: p.areaId,
      time_of_day: p.timeOfDay,
      order: order * 10,
      new: p.isNew === true,
    });
    expect(areas.map((a) => a.area_id)).toContain(fm.area);
  });
});
