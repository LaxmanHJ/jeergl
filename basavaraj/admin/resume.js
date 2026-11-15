// Builds job-specific resumes and cover letters from the saved profile.
// Rule: content is only reordered or re-emphasised. Nothing is invented.
import { analyze, relevance } from './match.js';

// The public address of a profile, from the site configuration written at build time.
export function profileUrl(profile) {
  const cfg = window.JEERGAL_CONFIG || {};
  if (!cfg.siteUrl || !cfg.paths || cfg.paths[profile.slug] === undefined) return profile.website || '';
  return (cfg.siteUrl + cfg.paths[profile.slug]).replace(/\/$/, '');
}

const byScore = (items, score) => items.map((x, i) => [x, score(x), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((r) => r[0]);

export function resumeModel(profile, priv = {}, job = null, opts = {}) {
  const confirmed = opts.confirmed || [];
  const a = job ? analyze(profile, job, confirmed) : { wanted: [], matched: [], missing: [] };
  const wanted = a.wanted;
  const rel = (t) => relevance(t, wanted);

  const skills = byScore(profile.skills || [], (g) => rel(g.items.join(', ')))
    .map((g) => ({ group: g.group, items: byScore(g.items, rel) }));
  if (confirmed.length) skills.push({ group: 'Additional', items: confirmed });

  const projects = byScore(profile.projects || [], (p) => rel([p.name, p.stack.join(', '), ...p.bullets].join(' ')))
    .map((p) => ({ ...p, bullets: byScore(p.bullets, rel) }));
  const experience = (profile.experience || []).map((e, i) => ({ ...e, bullets: i === 0 ? e.bullets.slice(0, 1).concat(byScore(e.bullets.slice(1), rel)) : byScore(e.bullets, rel) }));

  const links = (profile.links || []).map((l) => ({ label: l.label, url: l.url }));
  const site = profileUrl(profile);
  if (site) links.push({ label: site.replace(/^https?:\/\//, '').replace(/\/$/, ''), url: site, portfolio: true });
  const contact = [profile.location, opts.includePhone && priv.phone ? priv.phone : null, profile.email].filter(Boolean);

  return {
    name: profile.name,
    headline: opts.headline || profile.resumeHeadline || profile.headline,
    contact, links,
    summary: opts.summary || profile.summary,
    skills, experience, projects,
    education: profile.education || [],
    achievements: profile.achievements || [],
    certifications: profile.certifications || [],
    languages: profile.languages || [],
    fileBase: `${profile.resumeFile || profile.name.replace(/\s+/g, '_') + '_Resume'}${job ? '_' + String(job.company || 'job').replace(/[^\w]+/g, '_').slice(0, 30) : ''}`,
  };
}

const linkText = (l) => (l.portfolio ? 'Portfolio: ' : '') + l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

export function resumeText(m) {
  const L = [];
  L.push(m.name, m.headline, [...m.contact, ...m.links.map(linkText)].join(' | '), '');
  L.push('SUMMARY', m.summary, '');
  L.push('SKILLS', ...m.skills.map((g) => `${g.group}: ${g.items.join(', ')}`), '');
  if (m.experience.length) {
    L.push('EXPERIENCE');
    m.experience.forEach((e) => { L.push(`${e.company} | ${e.title} | ${e.location} | ${e.start} - ${e.end}`, ...e.bullets.map((b) => `- ${b}`), ''); });
  }
  L.push('PROJECTS');
  m.projects.forEach((p) => { L.push(`${p.name} (${p.stack.join(', ')})${p.url ? ' | ' + p.url : ''}`, ...p.bullets.map((b) => `- ${b}`), ''); });
  L.push('EDUCATION', ...m.education.map((e) => `${e.degree}, ${e.school} | ${[e.note, e.years].filter(Boolean).join(' | ')}`), '');
  if (m.achievements.length) L.push('ACHIEVEMENTS', ...m.achievements.map((b) => `- ${b}`), '');
  if (m.certifications.length) L.push('CERTIFICATIONS', m.certifications.join('; '), '');
  if (m.languages.length) L.push('LANGUAGES', m.languages.join(', '));
  return L.join('\n').trim() + '\n';
}

const BASE = (window.JEERGAL_CONFIG || {}).base || '';
const loadScript = (src, global) => new Promise((resolve, reject) => {
  if (window[global]) return resolve(window[global]);
  const s = document.createElement('script');
  s.src = src; s.onload = () => resolve(window[global]); s.onerror = () => reject(new Error(`Could not load ${src}`));
  document.head.appendChild(s);
});

// A text-based, single-column PDF that applicant tracking systems can parse.
export async function resumePdf(m) {
  const { jsPDF } = await loadScript(`${BASE}/admin/vendor/jspdf.umd.min.js`, 'jspdf');
  const GREEN = [23, 105, 79], GREY = [68, 68, 68], INK = [0, 0, 0];
  const ascii = (s) => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E -ÿ]/g, '');

  const render = (k) => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const M = k < 1 ? 38 : 46, W = 595.28 - 2 * M, H = 841.89;
    const fs = 9.6 * k, lh = 12.6 * k;
    let y = M + 14 * k, pages = 1;
    const need = (h) => { if (y + h > H - M) { doc.addPage(); pages += 1; y = M + 6; } };
    const set = (style, size, color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
    const para = (text, { style = 'normal', size = fs, color = INK, indent = 0, gap = 0 } = {}) => {
      set(style, size, color);
      doc.splitTextToSize(ascii(text), W - indent).forEach((ln) => { need(lh); doc.text(ln, M + indent, y); y += lh * (size / fs > 1.2 ? size / fs : 1); });
      y += gap;
    };
    const section = (t) => {
      y += 6 * k; need(lh * 2.4);
      set('bold', 10.6 * k, GREEN); doc.text(t.toUpperCase(), M, y);
      y += 3.5 * k; doc.setDrawColor(...GREEN); doc.setLineWidth(0.6); doc.line(M, y, M + W, y); y += lh * 0.95;
    };
    const twoCol = (left, right, rightStyle = 'italic') => {
      need(lh * 2);
      set(rightStyle, fs - 0.2, GREY); const rw = right ? doc.getTextWidth(ascii(right)) + 10 : 0;
      if (right) doc.text(ascii(right), M + W, y, { align: 'right' });
      set('bold', fs + 0.4);
      const lines = doc.splitTextToSize(ascii(left), W - rw);
      lines.forEach((ln, i) => { if (i) need(lh); doc.text(ln, M, y); y += lh; });
    };
    const labelled = (label, text) => {
      set('bold', fs); const lw = doc.getTextWidth(ascii(label) + ' ');
      set('normal', fs);
      const first = doc.splitTextToSize(ascii(text), W - lw);
      need(lh); set('bold', fs); doc.text(ascii(label), M, y); set('normal', fs); doc.text(first[0] || '', M + lw, y); y += lh;
      const rest = ascii(text).slice((first[0] || '').length).trim();
      if (rest) doc.splitTextToSize(rest, W).forEach((ln) => { need(lh); doc.text(ln, M, y); y += lh; });
      y += 1.5 * k;
    };
    const bullets = (items) => { items.forEach((b) => { set('normal', fs); need(lh); doc.text('•', M + 2, y); para(b, { indent: 11 }); }); y += 2 * k; };

    set('bold', 19 * k); doc.text(ascii(m.name), M, y); y += 15 * k;
    set('normal', 10.8 * k, GREEN); doc.text(ascii(m.headline), M, y); y += 13 * k;
    para([...m.contact, ...m.links.map(linkText)].join(' | '), { size: 8.8 * k, color: GREY });
    section('Summary'); para(m.summary);
    section('Skills'); m.skills.forEach((g) => labelled(`${g.group}:`, g.items.join(', ')));
    if (m.experience.length) { section('Experience'); m.experience.forEach((e) => { twoCol(`${e.company} | ${e.title} | ${e.location}`, `${e.start} - ${e.end}`); bullets(e.bullets); }); }
    section('Projects'); m.projects.forEach((p) => { twoCol(`${p.name} (${p.stack.join(', ')})`, ''); bullets(p.bullets); });
    section('Education'); m.education.forEach((e) => twoCol(`${e.degree}, ${e.school}`, [e.note, e.years].filter(Boolean).join(' | ')));
    if (m.achievements.length) { section('Achievements'); bullets(m.achievements); }
    if (m.certifications.length) { section('Certifications'); para(m.certifications.join('; ')); }
    if (m.languages.length) { section('Languages'); para(m.languages.join(', ')); }
    doc.setProperties({ title: `${m.name} - Resume`, author: m.name });
    return { doc, pages };
  };

  let out;
  for (const k of [1, 0.96, 0.92, 0.88, 0.85, 0.82]) { out = render(k); if (out.pages === 1) break; }
  return { blob: out.doc.output('blob'), pages: out.pages };
}

export async function resumeDocx(m) {
  const d = await loadScript(`${BASE}/admin/vendor/docx.iife.js`, 'docx');
  const { Document, Packer, Paragraph, TextRun, TabStopType } = d;
  const GREEN = '17694F';
  const run = (text, o = {}) => new TextRun({ text, font: 'Calibri', size: 21, ...o });
  const p = (children, o = {}) => new Paragraph({ children: [].concat(children), spacing: { after: 40 }, ...o });
  const heading = (t) => p(run(t.toUpperCase(), { bold: true, size: 22, color: GREEN }), { spacing: { before: 160, after: 60 }, border: { bottom: { color: GREEN, space: 1, style: 'single', size: 6 } } });
  const two = (left, right) => p([run(left, { bold: true }), ...(right ? [run('\t' + right, { italics: true })] : [])], { tabStops: [{ type: TabStopType.RIGHT, position: 10090 }] });
  const bullet = (t) => p(run(t), { bullet: { level: 0 } });

  const kids = [
    p(run(m.name, { bold: true, size: 40 })), p(run(m.headline, { size: 22, color: GREEN })),
    p(run([...m.contact, ...m.links.map(linkText)].join(' | '), { size: 19 })),
    heading('Summary'), p(run(m.summary)),
    heading('Skills'), ...m.skills.map((g) => p([run(`${g.group}: `, { bold: true }), run(g.items.join(', '))])),
  ];
  if (m.experience.length) { kids.push(heading('Experience')); m.experience.forEach((e) => kids.push(two(`${e.company} | ${e.title} | ${e.location}`, `${e.start} - ${e.end}`), ...e.bullets.map(bullet))); }
  kids.push(heading('Projects')); m.projects.forEach((x) => kids.push(two(`${x.name} (${x.stack.join(', ')})`, x.url || ''), ...x.bullets.map(bullet)));
  kids.push(heading('Education'), ...m.education.map((e) => two(`${e.degree}, ${e.school}`, [e.note, e.years].filter(Boolean).join(' | '))));
  if (m.achievements.length) kids.push(heading('Achievements'), ...m.achievements.map(bullet));
  if (m.certifications.length) kids.push(heading('Certifications'), p(run(m.certifications.join('; '))));
  if (m.languages.length) kids.push(heading('Languages'), p(run(m.languages.join(', '))));

  const doc = new Document({
    creator: m.name, title: `${m.name} - Resume`,
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 800, bottom: 800, left: 908, right: 908 } } }, children: kids }],
  });
  return Packer.toBlob(doc);
}

export async function textDocx(title, text, author) {
  const d = await loadScript(`${BASE}/admin/vendor/docx.iife.js`, 'docx');
  const { Document, Packer, Paragraph, TextRun } = d;
  const paras = String(text).split(/\n/).map((ln) => new Paragraph({ children: [new TextRun({ text: ln, font: 'Calibri', size: 22 })], spacing: { after: 120 } }));
  return Packer.toBlob(new Document({ creator: author, title, sections: [{ children: paras }] }));
}

// A first draft built only from profile facts. The user edits it before use.
export function coverLetter(profile, job, analysis) {
  const wanted = analysis.wanted;
  const company = job.company || 'your company';
  const role = job.title || 'this role';
  const strengths = analysis.matched.slice(0, 5);
  const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, '');
  const evidence = [];
  (profile.experience || []).slice(0, 2).forEach((e) => {
    const best = byScore(e.bullets, (b) => relevance(b, wanted))[0];
    if (best) evidence.push(`At ${e.company}, I ${lower(best)}.`);
  });
  byScore(profile.projects || [], (x) => relevance([x.name, x.stack.join(', '), ...x.bullets].join(' '), wanted)).slice(0, evidence.length ? 1 : 2).forEach((x) => {
    const best = byScore(x.bullets, (b) => relevance(b, wanted))[0];
    evidence.push(`In my ${x.name} project (${x.stack.slice(0, 4).join(', ')}), I ${lower(best)}.`);
  });
  const edu = (profile.education || [])[0];
  const opener = (profile.experience || []).length || !edu
    ? `I am a ${profile.headline.toLowerCase()} based in ${profile.location.split(',')[0]}, and I would like to be considered for the ${role} position at ${company}.`
    : `I am a ${profile.headline.toLowerCase()} studying for a ${edu.degree} at ${edu.school} (${edu.years}), and I would like to be considered for the ${role} position at ${company}.`;
  return [
    'Dear Hiring Team,', '',
    opener, '',
    strengths.length ? `The role asks for ${list(strengths)}, which matches the work I have been doing.` : 'My background matches the work described in the posting.',
    ...evidence, '',
    `I would welcome the chance to talk about how I can contribute at ${company}. My resume is attached, and more of my work is at ${profileUrl(profile)}.`, '',
    'Thank you for your time.', '',
    'Regards,', profile.name, profile.email,
  ].join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
