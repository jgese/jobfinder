// Offline test: runs the collector twice against fake source responses and checks the results.
// Usage: node collector/selftest.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfinder-'));
const day = 864e5;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const fixtures = (run) => ({
  'boards-api.greenhouse.io/v1/boards/figma/jobs': {
    jobs: [
      { id: 1, title: 'Senior Brand Designer', absolute_url: 'https://boards.greenhouse.io/figma/jobs/1', location: { name: 'San Francisco, CA' }, first_published: iso(2 * 3600e3), content: '&lt;p&gt;You will report to the Creative Director, Brand. Salary range $150,000 - $190,000 per year. Hybrid, 3 days in office.&lt;/p&gt;', departments: [{ name: 'Brand Studio' }] },
      ...(run === 1 ? [{ id: 2, title: 'Producer, Video', absolute_url: 'https://boards.greenhouse.io/figma/jobs/2', location: { name: 'Remote - US' }, first_published: iso(3 * day), content: 'Make videos. Recruiter: Dana Whitfield', departments: [] }] : []),
    ],
  },
  'api.lever.co/v0/postings/spotify': [
    { id: 'a', text: 'Account Manager, Agency Partnerships', hostedUrl: 'https://jobs.lever.co/spotify/a', createdAt: Date.now() - 5 * day, categories: { location: 'New York, NY', team: 'Ad Sales' }, workplaceType: 'hybrid', descriptionPlain: 'Manage agency relationships.', salaryRange: { min: 120000, max: 150000, currency: 'USD', interval: 'per-year-salary' } },
  ],
  'api.ashbyhq.com/posting-api/job-board/notion': { jobs: [{ title: 'People Partner', jobUrl: 'https://jobs.ashbyhq.com/notion/x', location: 'Remote', isRemote: true, publishedAt: iso(40 * day), descriptionPlain: 'HR stuff' }] },
  'api.adzuna.com': {
    results: [
      { title: 'Senior Brand Designer', company: { display_name: 'Figma, Inc.' }, redirect_url: 'https://adzuna.example/figma-1', location: { display_name: 'San Francisco, California' }, created: iso(1 * 3600e3), description: 'Brand designer role' },
      { title: 'Motion Designer', company: { display_name: 'Acme Studio' }, redirect_url: 'https://adzuna.example/acme-1', location: { display_name: 'Los Angeles, CA' }, created: iso(4 * 3600e3), description: 'Motion design for ads. $45 - $60 per hour.' },
    ],
  },
  'boards-api.greenhouse.io/v1/boards/acmestudio': { name: 'Acme Studio' },
  'models.github.ai': null, // handled below
});

function mockFetchModule(run) {
  // Written to a file and preloaded with --import so the collector sees a fake fetch.
  return `
const fx = ${JSON.stringify(fixtures(run))};
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.includes('models.github.ai')) {
    const jobs = JSON.parse(JSON.parse(init.body).messages[1].content);
    return json({ choices: [{ message: { content: JSON.stringify({ results: jobs.map((j) => ({ i: j.i, function: /designer/i.test(j.title) ? 'Design' : undefined, seniority: 'Senior', workplace: null, recruiter: null, reportsTo: null })) }) } }] });
  }
  if (url.includes('api.adzuna.com')) return json(fx['api.adzuna.com']);
  const key = Object.keys(fx).find((k) => url.includes(k) && (url.split('?')[0].endsWith(k)));
  if (key && fx[key]) return json(fx[key]);
  return json({ error: 'nope' }, 404);
};`;
}

function run(n) {
  const mock = path.join(tmp, `mock${n}.mjs`);
  fs.writeFileSync(mock, mockFetchModule(n));
  const out = path.join(tmp, `out${n}`);
  const inn = n === 1 ? path.join(tmp, 'empty') : path.join(tmp, 'out1');
  execFileSync(process.execPath, ['--import', mock, path.join(ROOT, 'collector/collect.mjs'), '--in', inn, '--out', out], {
    env: { ...process.env, ADZUNA_APP_ID: 'x', ADZUNA_APP_KEY: 'y', GITHUB_TOKEN: 't', GITHUB_STEP_SUMMARY: '' },
    stdio: 'inherit',
  });
  return { index: JSON.parse(fs.readFileSync(path.join(out, 'jobs.json'))), state: JSON.parse(fs.readFileSync(path.join(out, 'state.json'))) };
}

console.log('--- run 1');
const r1 = run(1);
const byTitle = (idx, t) => idx.jobs.find((j) => j.title === t);

const brand = byTitle(r1.index, 'Senior Brand Designer');
assert.ok(brand, 'brand designer present');
assert.equal(brand.apply.source, 'Greenhouse', 'direct link wins over aggregator');
assert.equal(brand.also[0].source, 'Adzuna', 'aggregator copy listed as also');
assert.equal(r1.index.jobs.filter((j) => j.title === 'Senior Brand Designer').length, 1, 'deduped');
assert.deepEqual(brand.salary, { min: 150000, max: 190000, currency: 'USD', period: 'year' });
assert.equal(brand.clues.reportsTo, 'Creative Director');
assert.equal(brand.workplace, 'hybrid');
assert.equal(byTitle(r1.index, 'Producer, Video').clues.recruiter, 'Dana Whitfield');
assert.equal(byTitle(r1.index, 'Producer, Video').workplace, 'remote');
assert.equal(byTitle(r1.index, 'Motion Designer').salary.period, 'hour');
assert.equal(byTitle(r1.index, 'Account Manager, Agency Partnerships').function, 'Account Management & Sales');
assert.ok(!byTitle(r1.index, 'People Partner'), 'posting older than 30 days pruned');
assert.ok(r1.state.discovered.some((d) => d.slug === 'acmestudio'), 'Acme Studio board discovered');
assert.ok(r1.index.jobs.some((j) => j.tagSource === 'ai'), 'AI tagging applied');

console.log('--- run 2');
const r2 = run(2);
assert.ok(!byTitle(r2.index, 'Producer, Video'), 'closed job removed when its board no longer lists it');
assert.equal(byTitle(r2.index, 'Senior Brand Designer').firstSeen, brand.firstSeen, 'firstSeen kept across runs');
assert.ok(byTitle(r2.index, 'Motion Designer'), 'aggregator job carried over');

console.log('\nAll checks passed.');
