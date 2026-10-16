// Dedupe and best-link ranking.
// The same job seen through several sources becomes one record. The application link shown
// first is the most direct route: the company's own system, then a niche board, then an aggregator.

import { hash } from './util.mjs';

export const KIND_RANK = { direct: 0, board: 1, aggregator: 2 };

export const normCompany = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh|plc|the)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');

export const normTitle = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\bsr\.?\b/g, 'senior')
    .replace(/\bjr\.?\b/g, 'junior')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const normLocation = (s) => {
  const l = String(s || '').toLowerCase();
  if (!l || /\bremote\b|anywhere/.test(l)) return l ? 'remote' : '';
  return l.split(/[,;|/(]| - /)[0].replace(/[^a-z]+/g, '');
};

export const jobKey = (j) => `${normCompany(j.company)}|${normTitle(j.title)}|${normLocation(j.location)}`;

function sortLinks(links) {
  return links.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

// raw: array of raw source jobs (already tagged with .tags)
// returns Map key -> job record
export function groupRaw(raw) {
  const groups = new Map();
  for (const r of raw) {
    if (!r.title || !r.company || !r.url) continue;
    const key = jobKey(r);
    const link = { url: r.url, source: r.source, kind: r.kind };
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, raw: r, links: [link] });
      continue;
    }
    if (!g.links.some((l) => l.url === link.url)) g.links.push(link);
    // Keep the richest raw record (direct sources carry the full text).
    if (KIND_RANK[r.kind] < KIND_RANK[g.raw.kind]) g.raw = r;
  }
  for (const g of groups.values()) sortLinks(g.links);
  return groups;
}

export function toRecord(g, now) {
  const r = g.raw;
  const t = r.tags;
  const [apply, ...also] = g.links;
  return {
    id: hash(g.key),
    key: g.key,
    title: r.title.trim(),
    company: r.company.trim(),
    location: r.location || '',
    workplace: t.workplace,
    function: t.function,
    seniority: t.seniority,
    salary: t.salary || null,
    postedAt: r.postedAt || null,
    firstSeen: now,
    snippet: (r.text || '').replace(/\s+/g, ' ').slice(0, 420),
    clues: t.clues || {},
    apply,
    also,
    ats: r.ats || null,
    tagSource: 'rules',
    _text: r.text || '', // used for AI tagging this run; stripped before writing
  };
}

// Merge this run's records with the previous index.
// okCompanies: Set of "type:slug" whose boards were fetched successfully this run.
export function mergeWithPrevious(current, previous, okCompanies) {
  const out = new Map(current);
  let carried = 0;
  let closed = 0;
  for (const p of previous) {
    const c = out.get(p.key);
    if (c) {
      c.firstSeen = p.firstSeen < c.firstSeen ? p.firstSeen : c.firstSeen;
      c.postedAt = c.postedAt || p.postedAt;
      // Keep links that only appeared on earlier runs (e.g. an aggregator copy).
      const known = new Set([c.apply, ...c.also].map((l) => l.url));
      const extra = [p.apply, ...(p.also || [])].filter((l) => l && !known.has(l.url) && l.kind !== 'direct');
      if (extra.length) {
        const links = sortLinks([c.apply, ...c.also, ...extra]);
        c.apply = links[0];
        c.also = links.slice(1);
      }
      if (p.tagSource === 'ai' && c.tagSource !== 'ai') {
        Object.assign(c, { function: p.function, seniority: p.seniority, workplace: p.workplace, tagSource: 'ai' });
        c.salary = c.salary || p.salary;
        c.clues = { ...c.clues, ...p.clues };
      }
      continue;
    }
    // Not seen this run. If its company board was checked and the job is gone, it's closed.
    if (p.ats && okCompanies.has(`${p.ats.type}:${p.ats.slug}`)) {
      closed++;
      continue;
    }
    out.set(p.key, p);
    carried++;
  }
  return { merged: out, carried, closed };
}
