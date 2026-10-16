# Jobfinder

A private-ish job search engine for a few friends. Every hour, GitHub Actions pulls new postings from company career pages (Greenhouse, Lever, Ashby, Workable) and Adzuna, tags them, merges duplicates, and publishes a search site on GitHub Pages. The site opens on the jobs found since your last visit.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| `collector/` | GitHub Actions, hourly | Fetches, tags, dedupes, writes the job index |
| `config/companies.json` | You edit | Shared list of company boards to check directly |
| `config/searches.json` | You edit | Adzuna searches, rotated a few per hour |
| `config/settings.json` | You edit | Index age, AI and Adzuna budgets |
| `site/index.html` | GitHub Pages | The search site; everything personal stays in each browser |
| `data` branch | Written by the bot | The current index and collector memory; replaced every run |

## Setup

1. Create a **public** repository and add these files to it.
2. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
3. Optional: get free Adzuna keys at developer.adzuna.com and add them under **Settings → Secrets and variables → Actions** as `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.
4. **Actions → Collect jobs → Run workflow.** The site link appears on the finished run.

## Everyday changes

- **Watch a company for everyone:** add it to `config/companies.json`. The slug is the part of its job-board link after the domain (`jobs.lever.co/acme` → `acme`).
- **Watch a company privately:** use *Your data* on the site.
- **Change the searches:** edit `config/searches.json`.
- **Check what happened on a run:** Actions → the run → Summary.

## Notes

- Scheduled runs can start late when GitHub is busy.
- GitHub pauses scheduled workflows in repos with no activity for 60 days and emails you first; one click re-enables it.
- `npm test` runs the collector against fake sources, offline.
