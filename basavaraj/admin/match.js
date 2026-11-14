// Keyword matching between a profile and a job description.
// Deterministic and local: nothing leaves the browser.

const T = (label, pattern) => [label, new RegExp(pattern, 'i')];
const w = (s) => `(?<![\\w+#.])(?:${s})(?![\\w+#])`;

export const TERMS = [
  // Languages
  T('JavaScript', w('javascript|js|es6')), T('TypeScript', w('typescript|ts')), T('Python', w('python')), T('Java', w('java')),
  T('C#', w('c#|\\.net|dotnet')), T('C++', w('c\\+\\+')), T('Go', w('golang|go lang')), T('Kotlin', w('kotlin')), T('SQL', w('sql|mysql|postgresql|postgres|ms sql')),
  // Frontend
  T('React', w('react(?:\\.?js)?')), T('Next.js', w('next(?:\\.?js)')), T('Angular', w('angular')), T('Vue', w('vue(?:\\.?js)?')),
  T('HTML', w('html5?')), T('CSS', w('css3?|scss|sass|tailwind')), T('Redux', w('redux')), T('Chart.js', w('chart\\.?js')),
  // Backend
  T('Node.js', w('node(?:\\.?js)?')), T('Express', w('express(?:\\.?js)?')), T('FastAPI', w('fastapi')), T('Django', w('django')), T('Flask', w('flask')),
  T('Spring Boot', w('spring(?: boot)?')), T('REST APIs', w('rest(?:ful)?(?: api| apis| services)?|web services')), T('GraphQL', w('graphql')),
  T('Microservices', w('micro-?services?')), T('API design', w('api design|designing apis')), T('Caching', w('cach(?:e|ing)|redis')),
  // Data
  T('MongoDB', w('mongo(?:db)?')), T('SQLite', w('sqlite')), T('PostgreSQL', w('postgres(?:ql)?')), T('MySQL', w('mysql')), T('Cosmos DB', w('cosmos ?db')),
  T('Pandas', w('pandas')), T('NumPy', w('numpy')), T('Machine learning', w('machine learning|ml|scikit-learn|sklearn')), T('Data pipelines', w('data pipelines?|etl')),
  // Tools and cloud
  T('Git', w('git|github|gitlab|version control')), T('Docker', w('docker|containers?')), T('Kubernetes', w('kubernetes|k8s')), T('AWS', w('aws|amazon web services')),
  T('Azure', w('azure')), T('GCP', w('gcp|google cloud')), T('Linux', w('linux|unix')), T('CI/CD', w('ci/?cd|continuous integration|jenkins|github actions')),
  T('Terraform', w('terraform')), T('Vercel', w('vercel')), T('Testing', w('unit tests?|testing|jest|pytest|junit')), T('Agile', w('agile|scrum')),
  // Fundamentals
  T('Data structures and algorithms', w('data structures?|algorithms?|dsa|problem[- ]solving')), T('OOP', w('oop|object[- ]oriented')),
  T('DBMS', w('dbms|database systems?|databases?')), T('Operating systems', w('operating systems?')), T('Computer networks', w('computer networks?|networking')),
  T('System design', w('system design|distributed systems?|scalab(?:le|ility)')),
  // AI
  T('LLMs', w('llms?|large language models?|generative ai|gen ?ai')), T('Prompt engineering', w('prompt engineering|prompts?')),
  T('AI agents', w('ai agents?|agentic|agentforce|mcp|claude code')), T('RAG', w('rag|retrieval[- ]augmented|vector search')),
  // Salesforce
  T('Salesforce', w('salesforce|sfdc|force\\.com')), T('Apex', w('apex')), T('LWC', w('lwc|lightning web components?')), T('Aura', w('aura')),
  T('Visualforce', w('visualforce')), T('Flows', w('flows?|process builder')), T('SOQL', w('soql|sosl')), T('Async Apex', w('async(?:hronous)? apex|batch apex|queueable|future methods?')),
  T('Platform Events', w('platform events?|change data capture')), T('Approval Processes', w('approval process(?:es)?')), T('OmniStudio', w('omnistudio|vlocity|omniscripts?')),
  T('CPQ', w('cpq|revenue cloud|quote[- ]to[- ]cash')), T('Sales Cloud', w('sales cloud')), T('Service Cloud', w('service cloud')), T('Health Cloud', w('health cloud')),
  T('Experience Cloud', w('experience cloud|community cloud|communities')), T('Data Cloud', w('data cloud|data 360')), T('MuleSoft', w('mule ?soft')),
  T('Integration patterns', w('integrations?(?: patterns?)?')), T('OAuth', w('oauth(?: 2\\.0)?|jwt')), T('SSO', w('sso|saml|oidc|single sign[- ]on')),
  T('SFDX', w('sfdx|salesforce dx|salesforce cli|scratch orgs?')), T('Sharing model', w('sharing (?:model|rules|settings)|data visibility|permission sets?')),
  T('Large data volumes', w('large data volumes?|ldv|governor limits?')), T('Packaging', w('2gp|managed packages?|second[- ]generation packag\\w*')),
  T('Code reviews', w('code reviews?|coding standards')), T('Team leadership', w('lead(?:ing)? (?:a )?teams?|mentor\\w*|tech(?:nical)? lead')),
  T('Architecture', w('architect(?:ure|ural)?|technical design|solution design')),
];

export function keywordsIn(text) {
  const found = [];
  const s = String(text || '');
  for (const [label, re] of TERMS) if (re.test(s)) found.push(label);
  return found;
}

export function profileText(profile) {
  const p = profile || {};
  return [
    p.headline, p.summary, ...(p.about || []),
    ...(p.skills || []).flatMap((g) => [g.group, ...(g.items || [])]),
    ...(p.experience || []).flatMap((e) => [e.title, ...(e.bullets || [])]),
    ...(p.projects || []).flatMap((x) => [x.name, ...(x.stack || []), x.summary, ...(x.bullets || [])]),
    ...(p.certifications || []), ...(p.achievements || []),
  ].filter(Boolean).join('\n');
}

export function jobText(job) {
  const j = job || {};
  return [j.title, j.description, (j.skills || []).join(', ')].filter(Boolean).join('\n');
}

// Compares what the job asks for with what the profile shows.
export function analyze(profile, job, confirmed = []) {
  const wanted = keywordsIn(jobText(job));
  const have = new Set([...keywordsIn(profileText(profile)), ...confirmed]);
  const matched = wanted.filter((k) => have.has(k));
  const missing = wanted.filter((k) => !have.has(k));
  const score = wanted.length ? Math.round((matched.length / wanted.length) * 100) : null;
  return { wanted, matched, missing, score };
}

// How many of the job's keywords a piece of text mentions.
export function relevance(text, wanted) {
  const set = new Set(keywordsIn(text));
  return wanted.reduce((n, k) => n + (set.has(k) ? 1 : 0), 0);
}
