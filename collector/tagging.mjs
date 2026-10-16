// Tags each job with function, seniority, workplace, salary and hiring clues.
// Rules run on every job instantly; AI (GitHub Models) upgrades the newest jobs each run within a budget.

export const FUNCTIONS = [
  'Design',
  'Creative',
  'Marketing',
  'Content & Communications',
  'Production',
  'Project & Program Management',
  'Product',
  'Engineering',
  'Data',
  'Account Management & Sales',
  'Customer Success & Support',
  'People & HR',
  'Operations',
  'Finance & Legal',
  'Other',
];

export const SENIORITY = ['Intern', 'Entry', 'Mid', 'Senior', 'Lead', 'Manager', 'Director', 'VP+'];
export const WORKPLACE = ['remote', 'hybrid', 'onsite'];

const FUNCTION_RULES = [
  ['People & HR', /\b(recruit|talent|people|human resources|\bhr\b|hrbp|payroll|benefits|compensation analyst|learning (and|&) development|dei\b)/i],
  ['Production', /\b(producer|production|post[- ]production|editor\b|video editor|animator|motion|line producer|studio manager|av\b|broadcast)/i],
  ['Project & Program Management', /\b(project manager|program manager|project management|program management|pmo|scrum master|delivery manager|traffic manager|resource manager)/i],
  ['Account Management & Sales', /\b(account (manager|director|executive|lead|supervisor)|client (services|partner|lead|director)|sales|business development|partnerships?|\bae\b|\bsdr\b|\bbdr\b)/i],
  ['Design', /\b(designer|design (lead|manager|director|systems?)|ux|ui\b|user experience|product design|visual design|graphic|brand design|illustrat|art director|interaction)/i],
  ['Creative', /\b(creative director|creative (lead|strategist|producer)|copywriter|associate creative|\bacd\b|\becd\b|creative)/i],
  ['Content & Communications', /\b(content|communications|\bcomms\b|\bpr\b|public relations|social media|editorial|writer|community manager|journalist)/i],
  ['Marketing', /\b(marketing|growth|brand (manager|strategist|lead)|seo|sem|demand gen|lifecycle|crm|performance marketing|campaign|media (buyer|planner))/i],
  ['Product', /\b(product (manager|owner|lead|director|operations)|\bpm\b|head of product)/i],
  ['Data', /\b(data (scientist|analyst|engineer)|analytics|machine learning|\bml\b|business intelligence|\bbi\b|insights)/i],
  ['Engineering', /\b(engineer|developer|software|frontend|front-end|backend|back-end|full[- ]stack|devops|sre\b|architect|ios|android|qa\b|security)/i],
  ['Customer Success & Support', /\b(customer (success|support|experience)|support (specialist|engineer|agent)|implementation|onboarding specialist|technical support)/i],
  ['Finance & Legal', /\b(finance|accountant|accounting|controller|fp&a|legal|counsel|paralegal|attorney|tax|audit)/i],
  ['Operations', /\b(operations|\bops\b|office manager|executive assistant|chief of staff|coordinator|administrator)/i],
];

const SENIORITY_RULES = [
  ['Intern', /\b(intern|internship|co-op|apprentice)\b/i],
  ['VP+', /\b(vp|vice president|chief|head of|cmo|cto|cco|cpo|svp|evp|president|founder)\b/i],
  ['Director', /\b(director)\b/i],
  ['Lead', /\b(lead|principal|staff)\b/i],
  ['Manager', /\b(manager|supervisor)\b/i],
  ['Senior', /\b(senior|sr\.?|iii|iv)\b/i],
  ['Entry', /\b(junior|jr\.?|entry|associate|assistant|coordinator|graduate|new grad|i)\b/i],
];

export function rulesTag(job) {
  const title = job.title || '';
  const text = job.text || '';
  const fn = FUNCTION_RULES.find(([, re]) => re.test(title))?.[0] || FUNCTION_RULES.find(([, re]) => re.test(text.slice(0, 600)))?.[0] || 'Other';
  const seniority = SENIORITY_RULES.find(([, re]) => re.test(title))?.[0] || 'Mid';
  const loc = job.location || '';
  let workplace = job.workplace && WORKPLACE.includes(job.workplace) ? job.workplace : null;
  if (!workplace) {
    if (job.remote || /\bremote\b|anywhere|work from home|\bwfh\b/i.test(loc)) workplace = 'remote';
    else if (/\bhybrid\b/i.test(loc) || /\bhybrid\b/i.test(text.slice(0, 2500))) workplace = 'hybrid';
    else if (/\bfully remote\b|\b100% remote\b|remote[- ]first/i.test(text.slice(0, 2500))) workplace = 'remote';
    else if (loc) workplace = 'onsite';
  }
  return {
    function: fn,
    seniority,
    workplace,
    salary: job.salary || parseSalary(job.salaryText) || parseSalary(text),
    clues: findClues(text, job.team),
  };
}

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?[kK]?)`;
const RANGE = new RegExp(`${MONEY}\\s*(?:-|–|—|to)\\s*(?:USD\\s*)?${MONEY}`);

function money(s) {
  const k = /k/i.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return k ? n * 1000 : n;
}

export function parseSalary(text) {
  if (!text) return null;
  const m = String(text).match(RANGE);
  if (!m) return null;
  let min = money(m[1]);
  let max = money(m[2]);
  if (!(min > 0 && max >= min)) return null;
  const after = String(text).slice(m.index + m[0].length, m.index + m[0].length + 30);
  let period = 'year';
  if (max < 500 || /hour|\/hr|per hr/i.test(after)) period = 'hour';
  if (period === 'year' && max < 10000) return null; // probably not a salary
  return { min: Math.round(min), max: Math.round(max), currency: 'USD', period };
}

const NAME = String.raw`([A-Z][a-z]+(?:[ -][A-Z][a-z'’]+){1,2})`;

export function findClues(text, team) {
  const clues = {};
  const t = String(text || '');
  const rec = t.match(new RegExp(String.raw`(?:[Rr]ecruiter|[Tt]alent (?:[Pp]artner|[Aa]cquisition)|[Hh]iring [Cc]ontact|[Pp]oint of [Cc]ontact)\s*(?:is|:|–|-)\s*${NAME}`));
  if (rec) clues.recruiter = rec[1];
  const rep = t.match(/report(?:s|ing)?\s+(?:directly\s+)?(?:in)?to\s+(?:the|our|a)\s+([A-Z][A-Za-z&/ ,-]{3,60}?)(?=[.,;:\n(]| and | who | on | in | within )/);
  if (rep) clues.reportsTo = rep[1].trim();
  if (team) clues.team = team;
  return clues;
}

// ---------- AI tagging via GitHub Models ----------

const SYSTEM = `You classify job postings. For each job return JSON fields:
function: one of ${JSON.stringify(FUNCTIONS)}
seniority: one of ${JSON.stringify(SENIORITY)}
workplace: one of ["remote","hybrid","onsite"] or null if unclear
salaryMin, salaryMax: numbers in USD or null (only if stated in the posting)
salaryPeriod: "year" or "hour" or null
recruiter: full name of a named recruiter or hiring contact, or null
reportsTo: job title this role reports to, or null
Never invent names or numbers. Reply with {"results":[{"i":<index>, ...}]} only.`;

export async function aiTag(batch, { token, model, timeout = 60000 }) {
  const payload = batch.map((j, i) => ({
    i,
    title: j.title,
    company: j.company,
    location: j.location,
    text: (j.text || '').slice(0, 1800),
  }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, accept: 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = new Error(`GitHub Models HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(content.replace(/^```(?:json)?|```$/g, '').trim());
  const out = new Map();
  for (const r of parsed.results || []) {
    if (typeof r.i !== 'number' || !batch[r.i]) continue;
    const tags = {};
    if (FUNCTIONS.includes(r.function)) tags.function = r.function;
    if (SENIORITY.includes(r.seniority)) tags.seniority = r.seniority;
    if (WORKPLACE.includes(r.workplace)) tags.workplace = r.workplace;
    const min = Number(r.salaryMin);
    const max = Number(r.salaryMax);
    if (min > 0) tags.salary = { min, max: max >= min ? max : min, currency: 'USD', period: r.salaryPeriod === 'hour' ? 'hour' : 'year' };
    const clues = {};
    if (typeof r.recruiter === 'string' && /^[A-Z][\w'’-]+(?: [A-Z][\w'’-]+){1,2}$/.test(r.recruiter.trim())) clues.recruiter = r.recruiter.trim();
    if (typeof r.reportsTo === 'string' && r.reportsTo.trim().length > 2) clues.reportsTo = r.reportsTo.trim().slice(0, 80);
    tags.clues = clues;
    out.set(r.i, tags);
  }
  return out;
}
