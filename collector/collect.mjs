// Entry point: node collector/collect.mjs [--in .state] [--out out]
// Reads the previous index + state, pulls every source, tags, dedupes, and writes a fresh index.

import fs from 'node:fs';
import path from 'node:path';
import { ATS, adzuna } from './sources.mjs';
import { rulesTag, aiTag } from './tagging.mjs';
import { groupRaw, toRecord, mergeWithPrevious, normCompany } from './merge.mjs';
import { pool, slugCandidates, sleep } from './util.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const IN = path.resolve(arg('--in', path.join(ROOT, '.state')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'out')));

const readJSON = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const settings = readJSON(path.join(ROOT, 'config/settings.json'), {});
const watchConfig = readJSON(path.join(ROOT, 'config/companies.json'), {});
const searches = readJSON(path.join(ROOT, 'config/searches.json'), { queries: [] });
const prevIndex = readJSON(path.join(IN, 'jobs.json'), { jobs: [] });
const state = readJSON(path.join(IN, 'state.json'), {});
state.discovered ??= []; // [{type, slug, name, addedAt}]
state.probed ??= {}; // normalized company -> ISO date of last probe
state.failures ??= {}; // "type:slug" -> consecutive 404 count
state.adzunaCursor ??= 0;

const S = {
  maxAgeDays: settings.maxAgeDays ?? 30,
  fetch: { concurrency: 8, timeoutMs: 20000, ...settings.fetch },
  ai: { enabled: true, model: 'openai/gpt-4.1-mini', requestsPerRun: 6, jobsPerRequest: 15, ...settings.ai },
  adzuna: { country: 'us', callsPerRun: 3, maxDaysOld: 3, resultsPerPage: 50, ...settings.adzuna },
  discovery: { probesPerRun: 15, retryAfterDays: 30, ...settings.discovery },
};

const now = new Date().toISOString();
const log = [];
const note = (s) => {
  log.push(s);
  console.log(s);
};

// ---------- 1. Build the watchlist ----------
const watch = new Map(); // "type:slug" -> {type, slug, name, origin}
for (const [type, list] of Object.entries(watchConfig)) {
  if (!ATS[type] || !Array.isArray(list)) continue;
  for (const item of list) {
    const c = typeof item === 'string' ? { slug: item, name: item } : item;
    if (c.slug) watch.set(`${type}:${c.slug}`, { type, slug: c.slug, name: c.name || c.slug, origin: 'config' });
  }
}
for (const d of state.discovered) {
  const k = `${d.type}:${d.slug}`;
  if (!watch.has(k)) watch.set(k, { ...d, origin: 'discovered' });
}
note(`Watching ${watch.size} company boards (${state.discovered.length} discovered automatically).`);

// ---------- 2. Pull company boards ----------
const opt = { timeout: S.fetch.timeoutMs };
const boards = [...watch.values()];
const boardResults = await pool(boards, S.fetch.concurrency, (b) => ATS[b.type].jobs(b.slug, b.name, opt));
const raw = [];
const okCompanies = new Set();
let boardErrors = 0;
boardResults.forEach((res, i) => {
  const b = boards[i];
  const k = `${b.type}:${b.slug}`;
  if (res.ok) {
    okCompanies.add(k);
    delete state.failures[k];
    raw.push(...res.value);
  } else {
    boardErrors++;
    if (res.error.status === 404) state.failures[k] = (state.failures[k] || 0) + 1;
    console.warn(`  ! ${k}: ${res.error.message}`);
  }
});
// Drop discovered boards that have 404'd three runs in a row.
const dropped = state.discovered.filter((d) => (state.failures[`${d.type}:${d.slug}`] || 0) >= 3);
if (dropped.length) {
  state.discovered = state.discovered.filter((d) => !dropped.includes(d));
  dropped.forEach((d) => delete state.failures[`${d.type}:${d.slug}`]);
}
note(`Boards: ${okCompanies.size} ok, ${boardErrors} failed, ${raw.length} postings.`);

// ---------- 3. Pull Adzuna (rotating through queries within a call budget) ----------
const adzunaRaw = [];
const { ADZUNA_APP_ID: appId, ADZUNA_APP_KEY: appKey } = process.env;
const queries = searches.queries || [];
if (appId && appKey && queries.length) {
  const calls = Math.min(S.adzuna.callsPerRun, queries.length);
  for (let n = 0; n < calls; n++) {
    const q = queries[(state.adzunaCursor + n) % queries.length];
    try {
      const jobs = await adzuna({ appId, appKey, country: S.adzuna.country, query: q, page: 1, maxDaysOld: S.adzuna.maxDaysOld, resultsPerPage: S.adzuna.resultsPerPage }, opt);
      adzunaRaw.push(...jobs);
    } catch (e) {
      console.warn(`  ! Adzuna "${q.what}": ${e.message}`);
    }
    await sleep(1500);
  }
  state.adzunaCursor = (state.adzunaCursor + calls) % queries.length;
  note(`Adzuna: ${adzunaRaw.length} postings from ${calls} queries.`);
} else {
  note('Adzuna: skipped (no API keys set).');
}
raw.push(...adzunaRaw);

// ---------- 4. Discover company boards from aggregator results ----------
const watchedNames = new Set(boards.map((b) => normCompany(b.name)));
const retryMs = S.discovery.retryAfterDays * 864e5;
const candidates = [...new Set(adzunaRaw.map((j) => j.company).filter(Boolean))]
  .filter((name) => {
    const n = normCompany(name);
    const last = state.probed[n];
    return n && !watchedNames.has(n) && !(last && Date.now() - Date.parse(last) < retryMs);
  })
  .slice(0, S.discovery.probesPerRun);
let found = 0;
for (const name of candidates) {
  state.probed[normCompany(name)] = now;
  outer: for (const slug of slugCandidates(name)) {
    for (const type of ['greenhouse', 'lever', 'ashby']) {
      try {
        if (await ATS[type].exists(slug, opt)) {
          state.discovered.push({ type, slug, name, addedAt: now });
          found++;
          break outer;
        }
      } catch {
        /* not on this system */
      }
    }
  }
}
// Forget old probe records so the file stays small.
for (const [k, d] of Object.entries(state.probed)) if (Date.now() - Date.parse(d) > retryMs * 2) delete state.probed[k];
if (candidates.length) note(`Discovery: probed ${candidates.length} companies, added ${found} new boards (checked from next run).`);

// ---------- 5. Tag, group, merge ----------
for (const r of raw) r.tags = rulesTag(r);
const groups = groupRaw(raw);
const current = new Map();
for (const g of groups.values()) current.set(g.key, toRecord(g, now));
const { merged, carried, closed } = mergeWithPrevious(current, prevIndex.jobs || [], okCompanies);

// Age out old jobs.
const cutoff = Date.now() - S.maxAgeDays * 864e5;
let jobs = [...merged.values()].filter((j) => Date.parse(j.postedAt || j.firstSeen) >= cutoff);
note(`Index: ${jobs.length} jobs (${current.size} seen this run, ${carried} carried over, ${closed} closed).`);

// ---------- 6. AI tagging for the newest rules-tagged jobs ----------
const token = process.env.GITHUB_TOKEN;
if (S.ai.enabled && token) {
  const queue = jobs.filter((j) => j.tagSource !== 'ai' && j._text !== undefined).sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : -1));
  let tagged = 0;
  for (let r = 0; r < S.ai.requestsPerRun && queue.length; r++) {
    const batch = queue.splice(0, S.ai.jobsPerRequest);
    try {
      const results = await aiTag(batch.map((j) => ({ ...j, text: j._text })), { token, model: S.ai.model });
      for (const [i, t] of results) {
        const j = batch[i];
        if (t.function) j.function = t.function;
        if (t.seniority) j.seniority = t.seniority;
        if (t.workplace) j.workplace = t.workplace;
        if (t.salary && !j.salary) j.salary = t.salary;
        j.clues = { ...j.clues, ...t.clues };
        j.tagSource = 'ai';
        tagged++;
      }
    } catch (e) {
      console.warn(`  ! AI tagging: ${e.message}`);
      if (e.status === 429 || e.status === 401 || e.status === 403) break;
    }
  }
  note(`AI tagging: ${tagged} jobs upgraded.`);
} else {
  note('AI tagging: skipped (disabled or no token).');
}

// ---------- 7. Write ----------
jobs.sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0));
for (const j of jobs) delete j._text;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'jobs.json'), JSON.stringify({ generatedAt: now, count: jobs.length, jobs }));
fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 1));
fs.writeFileSync(path.join(OUT, 'run-log.txt'), `${now}\n${log.join('\n')}\n`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Job collection\n\n${log.map((l) => `- ${l}`).join('\n')}\n`);
