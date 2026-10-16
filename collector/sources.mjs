// Source fetchers. Each returns an array of "raw" jobs in one shared shape:
// { source, kind, company, title, url, location, remote, postedAt, text, salary, team, ats }
// kind: 'direct' = the company's own application system, 'board' = niche board, 'aggregator'.

import { getJSON, htmlToText, toISO } from './util.mjs';

export const ATS = {
  greenhouse: {
    label: 'Greenhouse',
    async jobs(slug, name, opt) {
      const data = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`, opt);
      return (data.jobs || []).map((j) => ({
        source: 'Greenhouse',
        kind: 'direct',
        company: j.company_name || name,
        title: j.title,
        url: j.absolute_url,
        location: j.location?.name || '',
        remote: null,
        postedAt: toISO(j.first_published || j.updated_at),
        text: htmlToText(j.content),
        salary: null,
        team: j.departments?.[0]?.name || '',
        ats: { type: 'greenhouse', slug },
      }));
    },
    async exists(slug, opt) {
      const data = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}`, opt);
      return Boolean(data && data.name);
    },
  },

  lever: {
    label: 'Lever',
    async jobs(slug, name, opt) {
      const data = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`, opt);
      return (Array.isArray(data) ? data : []).map((j) => {
        const sr = j.salaryRange;
        return {
          source: 'Lever',
          kind: 'direct',
          company: name,
          title: j.text,
          url: j.hostedUrl || j.applyUrl,
          location: j.categories?.location || (j.categories?.allLocations || []).join(' / ') || '',
          remote: j.workplaceType === 'remote' ? true : null,
          workplace: j.workplaceType || null,
          postedAt: toISO(j.createdAt),
          text: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain]
            .filter(Boolean)
            .join('\n'),
          salary: sr && (sr.min || sr.max) ? { min: sr.min || null, max: sr.max || null, currency: sr.currency || 'USD', period: periodFrom(sr.interval) } : null,
          team: j.categories?.team || '',
          ats: { type: 'lever', slug },
        };
      });
    },
    async exists(slug, opt) {
      const data = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`, opt);
      return Array.isArray(data) && data.length > 0;
    },
  },

  ashby: {
    label: 'Ashby',
    async jobs(slug, name, opt) {
      const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`, opt);
      return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
        source: 'Ashby',
        kind: 'direct',
        company: name,
        title: j.title,
        url: j.jobUrl || j.applyUrl,
        location: [j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean).join(' / '),
        remote: j.isRemote ? true : null,
        workplace: (j.workplaceType || '').toLowerCase() || null,
        postedAt: toISO(j.publishedAt),
        text: j.descriptionPlain || htmlToText(j.descriptionHtml),
        salaryText: j.compensation?.compensationTierSummary || j.compensation?.scrapeableCompensationSalarySummary || '',
        salary: null,
        team: j.department || j.team || '',
        ats: { type: 'ashby', slug },
      }));
    },
    async exists(slug, opt) {
      const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, opt);
      return Array.isArray(data.jobs) && data.jobs.length > 0;
    },
  },

  workable: {
    label: 'Workable',
    async jobs(slug, name, opt) {
      const data = await getJSON(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`, opt);
      return (data.jobs || []).map((j) => ({
        source: 'Workable',
        kind: 'direct',
        company: data.name || name,
        title: j.title,
        url: j.application_url || j.url || `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
        location: [j.city, j.state, j.country].filter(Boolean).join(', '),
        remote: j.telecommuting ? true : null,
        postedAt: toISO(j.published_on || j.created_at),
        text: htmlToText(j.description),
        salary: null,
        team: j.department || '',
        ats: { type: 'workable', slug },
      }));
    },
    async exists() {
      return false; // Workable slugs are too ambiguous to guess; add them by hand.
    },
  },
};

function periodFrom(interval) {
  const s = String(interval || '').toLowerCase();
  if (s.includes('hour')) return 'hour';
  if (s.includes('month')) return 'month';
  return 'year';
}

export async function adzuna({ appId, appKey, country, query, page, maxDaysOld, resultsPerPage }, opt) {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(resultsPerPage),
    max_days_old: String(maxDaysOld),
    sort_by: 'date',
    'content-type': 'application/json',
  });
  if (query.what) params.set('what', query.what);
  if (query.where) params.set('where', query.where);
  const data = await getJSON(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`, opt);
  return (data.results || []).map((j) => ({
    source: 'Adzuna',
    kind: 'aggregator',
    company: j.company?.display_name || '',
    title: j.title ? htmlToText(j.title) : '',
    url: j.redirect_url,
    location: j.location?.display_name || '',
    remote: null,
    postedAt: toISO(j.created),
    text: htmlToText(j.description),
    salary:
      j.salary_min && j.salary_is_predicted !== '1'
        ? { min: Math.round(j.salary_min), max: Math.round(j.salary_max || j.salary_min), currency: 'USD', period: 'year' }
        : null,
    team: '',
    ats: null,
  }));
}
