import { createStore, STATUSES, blankJob } from './store.js';
import { analyze } from './match.js';
import { resumeModel, resumeText, resumePdf, resumeDocx, textDocx, coverLetter, profileUrl } from './resume.js';

// ---------- small DOM helpers ----------
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
};
const $ = (sel, root = document) => root.querySelector(sel);
const view = () => $('#view');
// replaceChildren would print null as text, so empty slots are dropped first.
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const splitTop = (s) => { const out = []; let depth = 0, cur = ''; for (const ch of String(s || '')) { if (ch === '(') depth++; if (ch === ')') depth = Math.max(0, depth - 1); if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out.filter(Boolean); };

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = bad ? 'toast show bad' : 'toast show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, bad ? 7000 : 3200);
}
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast(e.message || 'Something went wrong. Try again.', true); } };
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
const input = (value, attrs = {}) => h('input', { type: 'text', value: value ?? '', ...attrs });
const area = (value, rows = 4, attrs = {}) => h('textarea', { rows, ...attrs, value: value ?? '' });
const btn = (text, onclick, cls = '') => h('button', { type: 'button', class: `btn ${cls}`.trim(), onclick: run(onclick) }, text);
const chips = (items, cls) => h('ul', { class: `chips ${cls}` }, items.map((k) => h('li', {}, k)));

// ---------- state ----------
const BASE = (window.JEERGAL_CONFIG || {}).base || '';
const siteName = () => (profileUrl(S.profile) || location.origin).replace(/^https?:\/\//, '');
const S = { store: null, user: null, profiles: [], slug: null, profile: null, priv: {}, jobs: [], tab: 'jobs', job: null, filter: { status: '', q: '' } };

async function loadProfile(slug) {
  S.slug = slug; S.profile = S.profiles.find((p) => p.slug === slug).data;
  [S.priv, S.jobs] = await Promise.all([S.store.profiles.getPrivate(slug), S.store.jobs.list(slug)]);
  try { localStorage.setItem('jeergal-admin-slug', slug); } catch { /* ignore */ }
}

async function api(path, body) {
  const token = await S.store.auth.token();
  if (!token) throw new Error('Sign in with Supabase connected to use this.');
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status}).`);
  return data;
}

// ---------- shell ----------
function renderShell() {
  const app = $('#app'); app.replaceChildren();
  const tabs = [['jobs', 'Jobs'], ['profile', 'Profile'], ['resume', 'Resume'], ['settings', 'Settings']];
  fill(app,
    h('header', { class: 'top' },
      h('a', { class: 'brand', href: `${BASE}/` }, 'Portfolio', h('span', {}, 'dashboard')),
      h('nav', { class: 'tabs', 'aria-label': 'Dashboard sections' }, tabs.map(([id, label]) => h('button', {
        type: 'button', class: 'tab', 'aria-current': (S.tab === id || (id === 'jobs' && S.tab === 'job')) ? 'page' : null, onclick: () => go(id),
      }, label))),
      h('div', { class: 'who' },
        S.profiles.length > 1 ? h('select', { 'aria-label': 'Profile', onchange: run(async (e) => { await loadProfile(e.target.value); go('jobs'); }) },
          S.profiles.map((p) => h('option', { value: p.slug, selected: p.slug === S.slug }, p.data.name))) : h('span', {}, S.profile.name),
        S.store.mode === 'supabase' ? btn('Sign out', async () => { await S.store.auth.signOut(); location.reload(); }, 'quiet') : null),
    ),
    S.store.mode === 'preview' ? h('p', { class: 'banner' }, 'Preview mode: Supabase is not connected, so there is no sign-in and everything you change is saved only in this browser. Follow README.md to connect it.') : null,
    h('main', { id: 'view' }),
  );
  ({ jobs: renderJobs, job: renderJob, profile: renderProfile, resume: renderResume, settings: renderSettings })[S.tab]();
}
function go(tab, job = null) { S.tab = tab; S.job = job; renderShell(); window.scrollTo(0, 0); }

// ---------- sign in ----------
function renderLogin(msg) {
  const email = input('', { type: 'email', autocomplete: 'username', required: true });
  const pass = input('', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'error', role: 'alert' }, msg || '');
  fill($('#app'), h('main', { class: 'login' },
    h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try { await S.store.auth.signIn(email.value.trim(), pass.value); await start(); }
      catch (ex) { err.textContent = /invalid/i.test(ex.message) ? 'That email and password do not match an account.' : ex.message; }
    } },
    h('h1', {}, 'Portfolio dashboard'), h('p', { class: 'muted' }, 'Private area. Sign in to manage profiles, resumes and job applications.'),
    field('Email', email), field('Password', pass), err,
    h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'),
    h('p', { class: 'muted small' }, h('a', { href: `${BASE}/` }, 'Back to the public site')))));
  email.focus();
}

// ---------- jobs ----------
function searchLinks() {
  const role = lines(S.priv.targetRoles)[0] || S.profile.headline;
  const loc = S.priv.locations || 'Bengaluru';
  const q = encodeURIComponent(role), l = encodeURIComponent(loc);
  return [
    ['LinkedIn', `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${l}&f_TPR=r604800`],
    ['Indeed', `https://in.indeed.com/jobs?q=${q}&l=${l}&fromage=7`],
    ['Naukri', `https://www.naukri.com/${role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-jobs-in-${loc.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`],
    ['Foundit', `https://www.foundit.in/srp/results?query=${q}&locations=${l}`],
    ['Wellfound', `https://wellfound.com/jobs?q=${q}`],
    ['Internshala', `https://internshala.com/internships/keywords-${q}/`],
  ];
}

function renderJobs() {
  const rows = S.jobs.map((j) => ({ j, a: analyze(S.profile, j, j.overrides?.confirmed || []) }))
    .filter(({ j }) => (!S.filter.status || j.status === S.filter.status) && (!S.filter.q || `${j.company} ${j.title} ${j.location}`.toLowerCase().includes(S.filter.q.toLowerCase())))
    .sort((x, y) => (y.a.score ?? -1) - (x.a.score ?? -1));
  const counts = STATUSES.map((s) => [s, S.jobs.filter((j) => j.status === s).length]).filter(([, n]) => n);

  fill(view(), 
    h('div', { class: 'head' }, h('h1', {}, `Jobs for ${S.profile.name.split(' ')[0]}`),
      h('div', { class: 'row' }, btn('Add a job', () => go('job', blankJob(S.slug)), 'primary'),
        !S.jobs.length ? btn('Import jobs from a file', () => go('settings')) : null)),
    h('p', { class: 'muted' }, 'Jobs are ranked by how many of the posting\'s keywords your profile already covers. Nothing is ever submitted from this dashboard: you review every application and send it yourself.'),
    h('ul', { class: 'stat-row' }, h('li', {}, h('b', {}, String(S.jobs.length)), ' tracked'), counts.map(([s, n]) => h('li', {}, h('b', {}, String(n)), ` ${s.toLowerCase()}`))),
    h('div', { class: 'row filters' },
      h('input', { type: 'search', placeholder: 'Filter by company or title', 'aria-label': 'Filter jobs', value: S.filter.q, oninput: (e) => { S.filter.q = e.target.value; renderJobsTable(rows0()); } }),
      h('select', { 'aria-label': 'Status', onchange: (e) => { S.filter.status = e.target.value; renderJobs(); } }, h('option', { value: '' }, 'All statuses'), STATUSES.map((s) => h('option', { value: s, selected: S.filter.status === s }, s)))),
    h('div', { id: 'jobs-table' }),
    h('section', { class: 'card' }, h('h2', {}, 'Search the job sites'),
      h('p', { class: 'muted' }, 'These open a fresh search on each site for your target role. Job sites do not allow automatic scraping, so add anything you like with "Add a job", or ask Claude to search and add matches for you.'),
      h('div', { class: 'row' }, searchLinks().map(([n, u]) => h('a', { class: 'btn', href: u, target: '_blank', rel: 'noopener noreferrer' }, n)))),
  );
  function rows0() {
    return S.jobs.map((j) => ({ j, a: analyze(S.profile, j, j.overrides?.confirmed || []) }))
      .filter(({ j }) => (!S.filter.status || j.status === S.filter.status) && (!S.filter.q || `${j.company} ${j.title} ${j.location}`.toLowerCase().includes(S.filter.q.toLowerCase())))
      .sort((x, y) => (y.a.score ?? -1) - (x.a.score ?? -1));
  }
  renderJobsTable(rows);
}

function renderJobsTable(rows) {
  const box = $('#jobs-table');
  if (!rows.length) { fill(box, h('p', { class: 'empty' }, S.jobs.length ? 'No jobs match this filter.' : 'No jobs yet. Add one to start tracking it.')); return; }
  fill(box, h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Role', 'Location', 'Pay', 'Match', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map(({ j, a }) => h('tr', {},
      h('td', {}, h('button', { class: 'linkish', type: 'button', onclick: () => go('job', { ...j }) }, j.title || 'Untitled'), h('div', { class: 'muted small' }, [j.company, j.source].filter(Boolean).join(' · '))),
      h('td', {}, [j.location, j.work_mode].filter(Boolean).join(' · ')),
      h('td', {}, j.salary || 'Not stated'),
      h('td', {}, a.score === null ? h('span', { class: 'muted' }, 'Add description') : h('div', {}, h('span', { class: `score ${a.score >= 70 ? 'hi' : a.score >= 40 ? 'mid' : 'lo'}` }, `${a.score}%`), h('div', { class: 'muted small' }, `${a.matched.length} of ${a.wanted.length} keywords`))),
      h('td', {}, h('select', { 'aria-label': `Status for ${j.title} at ${j.company}`, onchange: run(async (e) => { const saved = await S.store.jobs.save({ ...j, status: e.target.value }); S.jobs = S.jobs.map((x) => (x.id === saved.id ? saved : x)); toast('Status updated.'); }) },
        STATUSES.map((s) => h('option', { value: s, selected: j.status === s }, s)))),
      h('td', {}, safeUrl(j.url) ? h('a', { href: j.url, target: '_blank', rel: 'noopener noreferrer' }, 'Posting') : ''),
    ))))));
}

// ---------- one job ----------
function renderJob() {
  const j = S.job; j.overrides = j.overrides || {};
  const f = {
    company: input(j.company), title: input(j.title), location: input(j.location), work_mode: input(j.work_mode, { placeholder: 'On-site, hybrid or remote' }),
    salary: input(j.salary), url: input(j.url, { type: 'url', placeholder: 'https://' }), source: input(j.source, { placeholder: 'LinkedIn, Naukri, company site' }), posted_on: input(j.posted_on),
    description: area(j.description, 9, { placeholder: 'Paste the full job description here. The match analysis reads it.' }),
    skills: input((j.skills || []).join(', ')),
    status: h('select', {}, STATUSES.map((s) => h('option', { value: s, selected: j.status === s }, s))),
    notes: area(j.notes, 3), cover_letter: area(j.cover_letter, 14), answers: area(j.answers, 8),
    headline: input(j.overrides.headline || S.profile.resumeHeadline || S.profile.headline),
    summary: area(j.overrides.summary || S.profile.summary, 5),
    phone: h('input', { type: 'checkbox' }),
  };
  f.phone.checked = !!S.priv.phone;
  const confirmed = new Set(j.overrides.confirmed || []);
  const collect = () => Object.assign(j, {
    company: f.company.value.trim(), title: f.title.value.trim(), location: f.location.value.trim(), work_mode: f.work_mode.value.trim(), salary: f.salary.value.trim(),
    url: f.url.value.trim(), source: f.source.value.trim(), posted_on: f.posted_on.value.trim(), description: f.description.value, skills: splitTop(f.skills.value),
    status: f.status.value, notes: f.notes.value, cover_letter: f.cover_letter.value, answers: f.answers.value,
    overrides: { headline: f.headline.value.trim(), summary: f.summary.value.trim(), confirmed: [...confirmed] },
  });
  const save = async (quiet) => {
    collect();
    if (!j.company || !j.title) throw new Error('Add a company and a job title first.');
    const isNew = !j.id;
    const saved = await S.store.jobs.save(j); Object.assign(j, saved);
    S.jobs = await S.store.jobs.list(S.slug); if (!quiet) toast('Job saved.');
    if (isNew) go('job', j);
  };
  const model = () => { collect(); return resumeModel(S.profile, S.priv, j, { headline: j.overrides.headline, summary: j.overrides.summary, confirmed: [...confirmed], includePhone: f.phone.checked }); };
  const matchBox = h('div', {});
  const drawMatch = () => {
    collect(); const a = analyze(S.profile, j, [...confirmed]);
    if (!a.wanted.length) { fill(matchBox, h('p', { class: 'muted' }, 'Paste the job description above, then choose "Analyse match".')); return; }
    fill(matchBox, 
      h('p', {}, h('span', { class: `score big ${a.score >= 70 ? 'hi' : a.score >= 40 ? 'mid' : 'lo'}` }, `${a.score}%`), ` of the posting's ${a.wanted.length} keyword${a.wanted.length === 1 ? ' is' : 's are'} covered by your profile.`),
      h('h3', {}, 'Already in your profile'), a.matched.length ? chips(a.matched, 'ok') : h('p', { class: 'muted' }, 'None found.'),
      h('h3', {}, 'Missing from your profile'),
      a.missing.length ? h('div', {}, h('p', { class: 'muted' }, 'Tick a skill only if you really have it. Ticked skills are added to this resume under "Additional". Leave the rest unticked: they are gaps to learn, not things to claim.'),
        h('div', { class: 'checks' }, a.missing.map((k) => { const c = h('input', { type: 'checkbox', onchange: () => { c.checked ? confirmed.add(k) : confirmed.delete(k); drawMatch(); } }); return h('label', {}, c, ` ${k}`); }))) : h('p', { class: 'muted' }, 'Nothing missing.'),
      confirmed.size ? h('div', {}, h('h3', {}, 'Added by you'), h('div', { class: 'checks' }, [...confirmed].map((k) => { const c = h('input', { type: 'checkbox', onchange: () => { confirmed.delete(k); drawMatch(); } }); c.checked = true; return h('label', {}, c, ` ${k}`); }))) : null,
    );
  };
  const ai = S.store.config.ai && S.store.mode === 'supabase';
  const draftAi = async (kind, target, question) => {
    collect(); toast('Drafting. This takes a few seconds.');
    const { text } = await api('/api/draft', { kind, question, profile: S.profile, job: { company: j.company, title: j.title, location: j.location, description: j.description, skills: j.skills }, confirmed: [...confirmed], prefs: { availability: S.priv.availability, expectedPay: S.priv.expectedPay } });
    if (kind === 'answer') target.value = `${target.value.trim()}\n\nQ: ${question}\nA: ${text}`.trim() + '\n'; else target.value = text;
    toast('Draft ready. Read and edit it before you use it.');
  };
  const question = input('', { placeholder: 'Paste a question from the application form' });

  fill(view(), 
    h('div', { class: 'head' }, h('div', {}, h('button', { class: 'linkish', type: 'button', onclick: () => go('jobs') }, '← All jobs'), h('h1', {}, j.id ? `${j.title} at ${j.company}` : 'Add a job')),
      h('div', { class: 'row' }, btn('Save', () => save(), 'primary'), j.id ? btn('Delete', async () => { if (!confirm('Delete this job and its drafts? This cannot be undone.')) return; await S.store.jobs.remove(j.id); S.jobs = await S.store.jobs.list(S.slug); toast('Job deleted.'); go('jobs'); }, 'quiet') : null)),

    h('section', { class: 'card' }, h('h2', {}, '1. The posting'),
      h('div', { class: 'grid2' }, field('Company', f.company), field('Job title', f.title), field('Location', f.location), field('Work mode', f.work_mode), field('Salary or stipend', f.salary), field('Posted', f.posted_on), field('Application link', f.url), field('Source', f.source)),
      field('Job description', f.description), field('Required skills', f.skills, 'Comma separated. Optional if the description already lists them.'),
      h('div', { class: 'row' }, safeUrl(j.url) ? h('a', { class: 'btn', href: j.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the posting') : null)),

    h('section', { class: 'card' }, h('h2', {}, '2. Match against your profile'), h('div', { class: 'row' }, btn('Analyse match', async () => drawMatch())), matchBox),

    h('section', { class: 'card' }, h('h2', {}, '3. Resume for this job'),
      h('p', { class: 'muted' }, 'Your skills, projects and bullet points are reordered so the most relevant ones come first. The wording comes from your profile; nothing new is invented.'),
      field('Headline', f.headline), field('Summary', f.summary, 'Edit freely, but keep every claim true.'),
      ai ? h('div', { class: 'row' }, btn('Suggest a summary with AI', () => draftAi('summary', f.summary))) : null,
      h('label', { class: 'check' }, f.phone, ` Include my phone number${S.priv.phone ? '' : ' (add it under Profile first)'}`),
      h('div', { class: 'row' },
        btn('Download PDF', async () => { const m = model(); const { blob, pages } = await resumePdf(m); download(blob, `${m.fileBase}.pdf`); toast(pages > 1 ? `Downloaded. It runs to ${pages} pages; trim the profile to get back to one.` : 'Resume downloaded.'); }, 'primary'),
        btn('Download Word (DOCX)', async () => { const m = model(); download(await resumeDocx(m), `${m.fileBase}.docx`); toast('Resume downloaded.'); }),
        btn('Copy as plain text', async () => { await navigator.clipboard.writeText(resumeText(model())); toast('Resume text copied.'); }))),

    h('section', { class: 'card' }, h('h2', {}, '4. Cover letter'),
      h('div', { class: 'row' }, btn('Draft from my profile', async () => { collect(); f.cover_letter.value = coverLetter(S.profile, j, analyze(S.profile, j, [...confirmed])); toast('Draft ready. Edit it before you use it.'); }),
        ai ? btn('Draft with AI', () => draftAi('cover_letter', f.cover_letter)) : null),
      field('Letter', f.cover_letter),
      h('div', { class: 'row' }, btn('Download Word (DOCX)', async () => { collect(); download(await textDocx(`Cover letter - ${j.company}`, j.cover_letter, S.profile.name), `Cover_Letter_${(j.company || 'job').replace(/[^\w]+/g, '_')}.docx`); }),
        btn('Download text', async () => { collect(); download(new Blob([j.cover_letter], { type: 'text/plain' }), `Cover_Letter_${(j.company || 'job').replace(/[^\w]+/g, '_')}.txt`); }),
        btn('Copy', async () => { await navigator.clipboard.writeText(f.cover_letter.value); toast('Cover letter copied.'); }))),

    h('section', { class: 'card' }, h('h2', {}, '5. Application answers'),
      h('p', { class: 'muted' }, 'Keep the answers you prepare for this application form here.'),
      ai ? h('div', { class: 'row grow' }, question, btn('Draft an answer with AI', async () => { if (!question.value.trim()) throw new Error('Paste the question first.'); await draftAi('answer', f.answers, question.value.trim()); question.value = ''; })) : null,
      field('Questions and answers', f.answers),
      S.priv.standardAnswers ? h('details', {}, h('summary', {}, 'Your standard answers'), h('pre', { class: 'pre' }, S.priv.standardAnswers)) : null),

    h('section', { class: 'card' }, h('h2', {}, '6. Status'),
      h('div', { class: 'grid2' }, field('Status', f.status, 'Set "Ready for my review" when the resume, letter and answers are done. Submit the application yourself, then mark it "Applied".'), field('Notes', f.notes)),
      h('div', { class: 'row' }, btn('Save', () => save(), 'primary'))),
  );
  drawMatch();
}

// ---------- profile ----------
function renderProfile() {
  const p = S.profile, v = S.priv;
  const f = {
    name: input(p.name), headline: input(p.headline), resumeHeadline: input(p.resumeHeadline), location: input(p.location), email: input(p.email, { type: 'email' }),
    greeting: input(p.intro?.greeting), tagline: input(p.intro?.tagline), roles: input((p.intro?.roles || []).join(', ')), introAvail: input(p.intro?.availability), photoAlt: input(p.photo?.alt), statement: area(p.intro?.statement, 4),
    facts: area((p.facts || []).map((s) => `${s.value} | ${s.label}`).join('\n'), 3),
    lead: area(p.lead, 3), summary: area(p.summary, 4), about: area((p.about || []).join('\n\n'), 8), seeking: area(p.seeking, 2),
    links: area((p.links || []).map((l) => `${l.label} | ${l.url}`).join('\n'), 3),
    skills: area((p.skills || []).map((g) => `${g.group}: ${g.items.join(', ')}`).join('\n'), 7),
    education: area((p.education || []).map((e) => [e.degree, e.school, e.years, e.note || '', e.publicNote || ''].join(' | ')).join('\n'), 3),
    certifications: area((p.certifications || []).join('\n'), 5), achievements: area((p.achievements || []).join('\n'), 3), languages: input((p.languages || []).join(', ')),
    stats: area((p.stats || []).map((s) => `${s.value} | ${s.label}`).join('\n'), 4),
    phone: input(v.phone, { type: 'tel', autocomplete: 'off' }), targetRoles: area(v.targetRoles, 3), locations: input(v.locations), expectedPay: input(v.expectedPay), availability: input(v.availability), standardAnswers: area(v.standardAnswers, 6),
  };
  const repeat = (items, make, blank, title) => {
    const box = h('div', { class: 'repeat' }); const list = items.map((x) => ({ ...x }));
    const draw = () => fill(box, ...list.map((x, i) => h('fieldset', {}, h('legend', {}, `${title} ${i + 1}`), make(x),
      h('div', { class: 'row' }, i ? h('button', { type: 'button', class: 'btn quiet', onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); } }, 'Move up') : null,
        h('button', { type: 'button', class: 'btn quiet', onclick: () => { if (confirm(`Remove this ${title.toLowerCase()}?`)) { list.splice(i, 1); draw(); } } }, 'Remove')))),
      h('button', { type: 'button', class: 'btn', onclick: () => { list.push(blank()); draw(); } }, `Add ${title.toLowerCase()}`));
    draw(); return { box, list };
  };
  const bind = (obj, key, el, parse = (x) => x) => { el.addEventListener('input', () => { obj[key] = parse(el.value); }); return el; };
  const exp = repeat(p.experience || [], (e) => [h('div', { class: 'grid2' }, field('Company', bind(e, 'company', input(e.company))), field('Title', bind(e, 'title', input(e.title))), field('Location', bind(e, 'location', input(e.location))), field('Start', bind(e, 'start', input(e.start))), field('End', bind(e, 'end', input(e.end)))),
    field('Bullet points', bind(e, 'bullets', area((e.bullets || []).join('\n'), 6), lines), 'One per line.')], () => ({ company: '', title: '', location: '', start: '', end: '', bullets: [] }), 'Role');
  const story = repeat(p.story || [], (x) => [field('Heading', bind(x, 'title', input(x.title))), field('Text', bind(x, 'body', area(x.body, 4)), 'Leave empty to keep this card off the public page.')], () => ({ title: '', body: '' }), 'Story card');
  const proj = repeat(p.projects || [], (x) => [h('div', { class: 'grid2' }, field('Name', bind(x, 'name', input(x.name))), field('Tech stack', bind(x, 'stack', input((x.stack || []).join(', ')), splitTop), 'Comma separated.'), field('Link', bind(x, 'url', input(x.url, { type: 'url' }))), field('Link label', bind(x, 'urlLabel', input(x.urlLabel)), '"Live project" or "GitHub".')),
    field('One-line summary', bind(x, 'summary', input(x.summary))), field('Bullet points', bind(x, 'bullets', area((x.bullets || []).join('\n'), 5), lines), 'One per line. Used on the resume.'),
    h('details', {}, h('summary', {}, 'Case study on the public page'),
      field('Tagline', bind(x, 'tagline', input(x.tagline))), field('The problem', bind(x, 'problem', area(x.problem, 3))), field('My solution', bind(x, 'solution', area(x.solution, 4))),
      field('What it does', bind(x, 'features', area((x.features || []).join('\n'), 4), lines), 'One per line.'),
      field('Architecture', bind(x, 'architecture', area((x.architecture || []).join('\n'), 4), lines), 'One step per line, in order.'),
      field('Results', bind(x, 'metrics', area((x.metrics || []).map((m) => `${m.value} | ${m.label}`).join('\n'), 2), (v) => lines(v).map((l) => { const [value, label] = l.split('|').map((t) => t.trim()); return { value, label }; }).filter((m) => m.value && m.label)), 'One per line as: ~75% | prediction accuracy, as reported. Only real, measured results.'),
      field('Engineering decisions', bind(x, 'decisions', area((x.decisions || []).join('\n'), 3), lines), 'One per line. Hidden on the public page while empty.'),
      field('Challenges and learnings', bind(x, 'learnings', area((x.learnings || []).join('\n'), 3), lines), 'One per line. Hidden on the public page while empty.'),
      field('GitHub repository', bind(x, 'repo', input(x.repo, { type: 'url', placeholder: 'https://github.com/...' })), 'Hidden on the public page while empty.'))], () => ({ name: '', stack: [], summary: '', bullets: [], url: '', urlLabel: 'Live project', tagline: '', problem: '', solution: '', features: [], architecture: [], metrics: [], decisions: [], learnings: [], repo: '' }), 'Project');

  const save = async () => {
    const next = { ...p, name: f.name.value.trim(), headline: f.headline.value.trim(), resumeHeadline: f.resumeHeadline.value.trim(), location: f.location.value.trim(), email: f.email.value.trim(),
      ...(p.hero === 'studio' ? { intro: { greeting: f.greeting.value.trim(), tagline: f.tagline.value.trim(), roles: splitTop(f.roles.value), availability: f.introAvail.value.trim(), statement: f.statement.value.trim() },
        ...(p.photo ? { photo: { ...p.photo, alt: f.photoAlt.value.trim() || `Portrait of ${f.name.value.trim()}` } } : {}),
        facts: lines(f.facts.value).map((l) => { const [value, label] = l.split('|').map((x) => x.trim()); return { value, label }; }).filter((s) => s.value && s.label),
        story: story.list.filter((x) => x.title) } : {}),
      lead: f.lead.value.trim(), summary: f.summary.value.trim(), about: f.about.value.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean), seeking: f.seeking.value.trim(),
      links: lines(f.links.value).map((l) => { const [label, url] = l.split('|').map((x) => x.trim()); return { label, url }; }).filter((l) => l.label && safeUrl(l.url)),
      skills: lines(f.skills.value).map((l) => { const i = l.indexOf(':'); return i > 0 ? { group: l.slice(0, i).trim(), items: splitTop(l.slice(i + 1)) } : null; }).filter(Boolean),
      experience: exp.list.filter((e) => e.company && e.title), projects: proj.list.filter((x) => x.name),
      education: lines(f.education.value).map((l) => { const [degree, school, years, note, publicNote] = l.split('|').map((x) => x.trim()); return { degree, school, years: years || '', note: note || '', publicNote: publicNote || '' }; }).filter((e) => e.degree && e.school),
      certifications: lines(f.certifications.value), achievements: lines(f.achievements.value), languages: splitTop(f.languages.value),
      ...(p.hero === 'stats' ? { stats: lines(f.stats.value).map((l) => { const [value, label] = l.split('|').map((x) => x.trim()); return { value, label }; }).filter((s) => s.value && s.label) } : {}) };
    if (!next.name || !next.email) throw new Error('Name and email are required.');
    const priv = { phone: f.phone.value.trim(), targetRoles: f.targetRoles.value, locations: f.locations.value.trim(), expectedPay: f.expectedPay.value.trim(), availability: f.availability.value.trim(), standardAnswers: f.standardAnswers.value };
    await S.store.profiles.save(S.slug, next); await S.store.profiles.savePrivate(S.slug, priv);
    S.profile = next; S.priv = priv; S.profiles = S.profiles.map((x) => (x.slug === S.slug ? { ...x, data: next } : x));
    toast('Profile saved.'); renderShell();
  };
  const publish = async () => { await api('/api/publish'); toast('Publishing. The public site updates in about a minute.'); };

  fill(view(), 
    h('div', { class: 'head' }, h('h1', {}, 'Profile'), h('div', { class: 'row' }, btn('Save profile', save, 'primary'), S.store.config.publish && S.store.mode === 'supabase' ? btn('Publish to the public site', publish) : null)),
    h('p', { class: 'muted' }, `This is the single source for your resumes, cover letters and the public page at ${siteName()}. Save, then publish to update the public page.`),
    h('section', { class: 'card' }, h('h2', {}, 'Basics'), h('div', { class: 'grid2' }, field('Full name', f.name), field('Headline', f.headline), field('Resume headline', f.resumeHeadline), field('Location', f.location), field('Email', f.email)),
      field('Opening line on the public page', f.lead), field('Resume summary', f.summary), field('About (public page)', f.about, 'Leave a blank line between paragraphs.'), field('Contact section line', f.seeking), field('Links', f.links, 'One per line as: Label | https://address')),
    p.hero === 'studio' ? h('section', { class: 'card' }, h('h2', {}, 'Opening section'),
      h('div', { class: 'grid2' }, field('Main headline', f.greeting), field('Supporting headline', f.tagline), field('Roles', f.roles, 'Comma separated.'), field('Availability', f.introAvail, 'Shown as a small badge. Leave empty to hide it.')),
      p.photo ? field('Photo description', f.photoAlt, 'Read aloud by screen readers. Describe what the photo shows.') : null,
      field('Introduction', f.statement), field('Headline numbers', f.facts, 'One per line as: 100+ | LeetCode problems solved. Only real numbers.')) : null,
    p.hero === 'studio' ? h('section', { class: 'card' }, h('h2', {}, 'About cards'), h('p', { class: 'muted' }, 'Who you are, your journey, what motivates you, how you approach problems, what you are learning and where you are headed. Cards without text stay off the public page.'), story.box) : null,
    p.hero === 'stats' ? h('section', { class: 'card' }, h('h2', {}, 'Headline numbers'), field('Numbers on the public page', f.stats, 'One per line as: 6+ | years building on Salesforce')) : null,
    h('section', { class: 'card' }, h('h2', {}, 'Skills'), field('Skill groups', f.skills, 'One group per line as: Group: skill, skill, skill')),
    h('section', { class: 'card' }, h('h2', {}, 'Experience'), exp.box),
    h('section', { class: 'card' }, h('h2', {}, 'Projects'), proj.box),
    h('section', { class: 'card' }, h('h2', {}, 'Education and more'), field('Education', f.education, 'One per line as: Degree | School | Years | Note for resume | Note for public page'), field('Certifications', f.certifications, 'One per line.'), field('Achievements', f.achievements, 'One per line.'), field('Languages', f.languages)),
    h('section', { class: 'card private' }, h('h2', {}, 'Private details'), h('p', { class: 'muted' }, 'Never shown on the public site. Used only for resumes and applications you prepare here.'),
      h('div', { class: 'grid2' }, field('Phone', f.phone), field('Preferred locations', f.locations, 'For example: Bengaluru'), field('Expected salary or stipend', f.expectedPay), field('Availability or notice period', f.availability)),
      field('Target roles', f.targetRoles, 'One per line. The first is used for the job-site searches.'), field('Standard application answers', f.standardAnswers, 'Answers you reuse, such as work authorisation or relocation.')),
    h('div', { class: 'row' }, btn('Save profile', save, 'primary')),
  );
}

// ---------- resume ----------
function renderResume() {
  const phone = h('input', { type: 'checkbox' }); phone.checked = !!S.priv.phone;
  const model = () => resumeModel(S.profile, S.priv, null, { includePhone: phone.checked });
  const file = h('input', { type: 'file', accept: 'application/pdf,.pdf' });
  fill(view(), 
    h('div', { class: 'head' }, h('h1', {}, 'Resume')),
    h('section', { class: 'card' }, h('h2', {}, 'General resume'),
      h('p', { class: 'muted' }, 'Built from your saved profile in a single-column layout with standard headings and real text, so applicant tracking systems can read it. For a version tuned to one posting, open that job under Jobs.'),
      h('label', { class: 'check' }, phone, ` Include my phone number${S.priv.phone ? '' : ' (add it under Profile first)'}`),
      h('div', { class: 'row' },
        btn('Download PDF', async () => { const m = model(); const { blob, pages } = await resumePdf(m); download(blob, `${m.fileBase}.pdf`); toast(pages > 1 ? `Downloaded. It runs to ${pages} pages.` : 'Resume downloaded.'); }, 'primary'),
        btn('Download Word (DOCX)', async () => { const m = model(); download(await resumeDocx(m), `${m.fileBase}.docx`); toast('Resume downloaded.'); }),
        btn('Copy as plain text', async () => { await navigator.clipboard.writeText(resumeText(model())); toast('Resume text copied.'); }))),
    h('section', { class: 'card' }, h('h2', {}, 'Resume on the public page'),
      h('p', { class: 'muted' }, `Visitors to ${siteName()} download the resume shipped with the site (no phone number). Upload a PDF here to replace it, then publish.`),
      h('p', {}, h('a', { href: S.profile.resumeUrl || `${BASE}/resumes/${S.profile.resumeFile}.pdf`, target: '_blank', rel: 'noopener' }, 'Open the current public resume')),
      h('div', { class: 'row' }, file, btn('Upload and use this PDF', async () => {
        const fl = file.files[0]; if (!fl) throw new Error('Choose a PDF first.');
        if (fl.type !== 'application/pdf' || fl.size > 2 * 1024 * 1024) throw new Error('Choose a PDF smaller than 2 MB.');
        const url = await S.store.files.uploadResume(S.slug, fl);
        S.profile = { ...S.profile, resumeUrl: url }; await S.store.profiles.save(S.slug, S.profile);
        S.profiles = S.profiles.map((x) => (x.slug === S.slug ? { ...x, data: S.profile } : x)); toast('Uploaded. Publish to update the public page.'); renderResume();
      }))),
    h('section', { class: 'card' }, h('h2', {}, 'Check before you send'),
      h('ul', { class: 'plain' }, ['Every line is true and you can talk about it in an interview.', 'The headline and summary name the role you are applying for.', 'It fits on one page, or two if you have several years of experience.', 'The file opens correctly after download.'].map((t) => h('li', {}, t)))),
  );
}

// ---------- settings ----------
function renderSettings() {
  const pw = input('', { type: 'password', autocomplete: 'new-password', minlength: 12 });
  const imp = h('input', { type: 'file', accept: 'application/json,.json' });
  fill(view(), 
    h('div', { class: 'head' }, h('h1', {}, 'Settings')),
    h('section', { class: 'card' }, h('h2', {}, 'Your data'),
      h('div', { class: 'row' }, btn('Download everything (JSON)', async () => download(new Blob([JSON.stringify(await S.store.exportAll(), null, 2)], { type: 'application/json' }), 'jeergal-dashboard-export.json'))),
      h('p', { class: 'muted' }, 'Import jobs from a JSON file: a list of objects with company, title, location, salary, description, skills, url and source.'),
      h('div', { class: 'row' }, imp, btn('Import jobs', async () => {
        const fl = imp.files[0]; if (!fl) throw new Error('Choose a JSON file first.');
        let list; try { list = JSON.parse(await fl.text()); } catch { throw new Error('That file is not valid JSON.'); }
        if (!Array.isArray(list)) throw new Error('The file must contain a list of jobs.');
        let n = 0; for (const j of list.slice(0, 200)) { if (j && j.company && j.title) { await S.store.jobs.save({ ...blankJob(S.slug), ...j, id: null, profile_slug: S.slug, skills: Array.isArray(j.skills) ? j.skills : [] }); n += 1; } }
        S.jobs = await S.store.jobs.list(S.slug); toast(`${n} jobs imported.`);
      }))),
    S.store.mode === 'supabase' ? h('section', { class: 'card' }, h('h2', {}, 'Password'), field('New password', pw, 'At least 12 characters.'),
      h('div', { class: 'row' }, btn('Change password', async () => { if (pw.value.length < 12) throw new Error('Use at least 12 characters.'); await S.store.auth.updatePassword(pw.value); pw.value = ''; toast('Password changed.'); })))
      : h('section', { class: 'card' }, h('h2', {}, 'Preview data'), h('p', { class: 'muted' }, 'Clears everything saved in this browser and reloads the starter data.'), h('div', { class: 'row' }, btn('Reset preview data', async () => { if (confirm('Clear all preview data in this browser?')) { S.store.reset(); location.reload(); } }, 'quiet'))),
    h('section', { class: 'card' }, h('h2', {}, 'How this dashboard handles your information'),
      h('ul', { class: 'plain' }, ['Your phone number, pay expectations, jobs and drafts are private. Only your signed-in account can read them.', 'The public pages show only what is in the public part of your profile.', 'Nothing is sent to an employer from here. You submit every application yourself.', S.store.config.ai ? 'AI drafts send your public profile and the job description to Anthropic through this site\'s server. Your phone number is never sent.' : 'AI drafting is off because no API key is configured.'].map((t) => h('li', {}, t)))),
  );
}

// ---------- start ----------
async function start() {
  S.user = await S.store.auth.user();
  if (!S.user) { renderLogin(); return; }
  S.profiles = await S.store.profiles.list();
  if (!S.profiles.length) { renderLogin('This account is not linked to a profile. Ask the site owner to add your email to a profile in Supabase.'); await S.store.auth.signOut(); return; }
  for (const p of S.profiles.filter((x) => x.fresh)) await S.store.profiles.save(p.slug, p.data);
  let slug; try { slug = localStorage.getItem('jeergal-admin-slug'); } catch { slug = null; }
  await loadProfile(S.profiles.some((p) => p.slug === slug) ? slug : S.profiles[0].slug);
  renderShell();
}

(async () => {
  try { S.store = await createStore(); await start(); }
  catch (e) { console.error(e); fill($('#app'), h('main', { class: 'login' }, h('div', { class: 'card' }, h('h1', {}, 'The dashboard could not start'), h('p', { class: 'error' }, e.message), h('p', { class: 'muted' }, 'Check the Supabase settings in README.md, then reload.')))); }
})();
