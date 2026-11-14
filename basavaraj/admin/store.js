// Data layer for the dashboard. Two back ends share one interface:
//   - Supabase (sign-in, Postgres with row-level security, file storage)
//   - Preview mode (this browser only), used when Supabase is not configured.

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const now = () => new Date().toISOString();

export const STATUSES = ['Saved', 'Preparing', 'Ready for my review', 'Applied', 'Interview', 'Offer', 'Rejected', 'Skipped'];

export const blankJob = (slug) => ({
  id: null, profile_slug: slug, company: '', title: '', location: '', work_mode: '', salary: '', description: '', skills: [],
  url: '', source: '', status: 'Saved', posted_on: '', notes: '', cover_letter: '', answers: '', overrides: {},
});

async function loadSeed() {
  try { const r = await fetch(`${(window.JEERGAL_CONFIG || {}).base || ''}/admin/seed.json`, { cache: 'no-store' }); return r.ok ? r.json() : { profiles: {}, jobs: {} }; }
  catch { return { profiles: {}, jobs: {} }; }
}

function previewStore(seed) {
  const KEY = 'jeergal-admin-preview-v1';
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db) {
    db = { profiles: seed.profiles, priv: {}, jobs: [] };
    Object.entries(seed.jobs || {}).forEach(([slug, list]) => list.forEach((j) => db.jobs.push({ ...blankJob(slug), ...j, id: uid(), created_at: now(), updated_at: now() })));
  }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage unavailable */ } };
  persist();
  return {
    mode: 'preview',
    auth: {
      async user() { return { email: 'preview@this-browser' }; },
      async signIn() {}, async signOut() {}, async updatePassword() { throw new Error('Passwords apply once Supabase is connected.'); },
      async token() { return null; },
    },
    profiles: {
      async list() { return Object.entries(db.profiles).map(([slug, data]) => ({ slug, data })); },
      async save(slug, data) { db.profiles[slug] = data; persist(); },
      async getPrivate(slug) { return db.priv[slug] || {}; },
      async savePrivate(slug, data) { db.priv[slug] = data; persist(); },
    },
    jobs: {
      async list(slug) { return db.jobs.filter((j) => j.profile_slug === slug).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
      async save(job) {
        const row = { ...job, updated_at: now() };
        if (!row.id) { row.id = uid(); row.created_at = now(); db.jobs.push(row); }
        else db.jobs = db.jobs.map((j) => (j.id === row.id ? row : j));
        persist(); return row;
      },
      async remove(id) { db.jobs = db.jobs.filter((j) => j.id !== id); persist(); },
    },
    files: { async uploadResume() { throw new Error('Uploads work once Supabase is connected.'); } },
    async exportAll() { return db; },
    reset() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };
}

function supabaseStore(cfg, seed) {
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const JOB_COLS = ['profile_slug', 'company', 'title', 'location', 'work_mode', 'salary', 'description', 'skills', 'url', 'source', 'status', 'posted_on', 'notes', 'cover_letter', 'answers', 'overrides'];
  const pick = (job) => Object.fromEntries(JOB_COLS.map((c) => [c, job[c] ?? (c === 'skills' ? [] : c === 'overrides' ? {} : '')]));
  return {
    mode: 'supabase',
    auth: {
      async user() { return (await sb.auth.getSession()).data.session?.user || null; },
      async signIn(email, password) { check(await sb.auth.signInWithPassword({ email, password })); },
      async signOut() { await sb.auth.signOut(); },
      async updatePassword(password) { check(await sb.auth.updateUser({ password })); },
      async token() { return (await sb.auth.getSession()).data.session?.access_token || null; },
    },
    profiles: {
      async list() {
        const user = (await sb.auth.getSession()).data.session?.user;
        const rows = check(await sb.from('profiles').select('slug,data').contains('owner_emails', [user.email]).order('slug'));
        // First sign-in: fill empty profiles from the content shipped with the site.
        return rows.map((r) => ({ slug: r.slug, data: r.data && r.data.name ? r.data : seed.profiles[r.slug] || { slug: r.slug, name: r.slug, skills: [], projects: [], links: [], education: [], certifications: [] }, fresh: !(r.data && r.data.name) }));
      },
      async save(slug, data) { check(await sb.from('profiles').update({ data, updated_at: now() }).eq('slug', slug).select('slug')); },
      async getPrivate(slug) { const rows = check(await sb.from('private_profiles').select('data').eq('slug', slug)); return rows[0]?.data || {}; },
      async savePrivate(slug, data) { check(await sb.from('private_profiles').upsert({ slug, data, updated_at: now() }).select('slug')); },
    },
    jobs: {
      async list(slug) { return check(await sb.from('jobs').select('*').eq('profile_slug', slug).order('created_at', { ascending: false })); },
      async save(job) {
        const row = { ...pick(job), updated_at: now() };
        const res = job.id ? await sb.from('jobs').update(row).eq('id', job.id).select().single() : await sb.from('jobs').insert(row).select().single();
        return check(res);
      },
      async remove(id) { check(await sb.from('jobs').delete().eq('id', id)); },
    },
    files: {
      async uploadResume(slug, file) {
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
        const path = `${slug}.${ext}`;
        check(await sb.storage.from('resumes').upload(path, file, { upsert: true, contentType: file.type || 'application/pdf', cacheControl: '300' }));
        return sb.storage.from('resumes').getPublicUrl(path).data.publicUrl;
      },
    },
    async exportAll() {
      const profiles = await this.profiles.list(); const out = { profiles: {}, priv: {}, jobs: [] };
      for (const p of profiles) { out.profiles[p.slug] = p.data; out.priv[p.slug] = await this.profiles.getPrivate(p.slug); out.jobs.push(...await this.jobs.list(p.slug)); }
      return out;
    },
    reset() {},
  };
}

export async function createStore() {
  const cfg = window.JEERGAL_CONFIG || {};
  const seed = await loadSeed();
  const store = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase ? supabaseStore(cfg, seed) : previewStore(seed);
  store.seed = seed;
  store.config = cfg;
  return store;
}
