#!/usr/bin/env node
// End-to-end run of the committed workflow outside n8n.
//
// Every Code node, prompt, expression and node parameter is read from
// workflows/job-application-automation.json - nothing is re-implemented here.
// Only the outbound calls are substituted:
//
//   Fetch Master Resume    -> build/fixtures/master-resume.txt
//   Fetch Free Job Boards  -> build/fixtures/<source>.json
//   Create Google Doc      -> the multipart body is PARSED as Drive would parse
//                             it, and the extracted HTML is written to disk
//   Google Sheets nodes    -> in-memory tabs
//   Chat models            -> real Gemini when GEMINI_API_KEY is set,
//                             otherwise a deterministic local stub
//
// Usage:
//   node build/run-e2e.mjs
//   GEMINI_API_KEY=... NODE_USE_ENV_PROXY=1 node build/run-e2e.mjs   # real model
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build/e2e-output');
mkdirSync(outDir, { recursive: true });

const wf = JSON.parse(readFileSync(join(root, 'workflows/job-application-automation.json'), 'utf8'));
const N = (name) => {
  const found = wf.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`workflow has no node named "${name}"`);
  return found;
};

const USE_REAL_MODEL = Boolean(process.env.GEMINI_API_KEY);
const log = [];
const say = (line) => { console.log(line); log.push(line); };

// ---------------------------------------------------------------------------
// n8n-ish runtime: item store for $('Node'), and the expression engine
// ---------------------------------------------------------------------------
const store = new Map();
const wrap = (list) => list.map((i) => (i && typeof i === 'object' && 'json' in i ? i : { json: i }));
const put = (name, items) => { store.set(name, wrap(items)); return store.get(name); };

const $ = (name) => {
  if (!store.has(name)) throw new Error(`$('${name}') read before that node ran`);
  const list = store.get(name);
  return { all: () => list, first: () => list[0], last: () => list[list.length - 1] };
};

const runJs = (expr, $json) => new Function('$json', '$', `return (${expr})`)($json, $);

// `={{ x }}` alone yields the raw value; anything else is string interpolation.
const resolve = (value, $json = {}) => {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const body = value.slice(1);
  const whole = body.match(/^\{\{([\s\S]*)\}\}$/);
  if (whole && !whole[1].includes('}}')) return runJs(whole[1], $json);
  return body.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(runJs(e, $json) ?? ''));
};

// ---------------------------------------------------------------------------
// node executors
// ---------------------------------------------------------------------------
// E2E_CONFIG lets a run point at the fixture slugs or tighten a threshold
// without editing the committed workflow.
const CONFIG_OVERRIDES = process.env.E2E_CONFIG ? JSON.parse(process.env.E2E_CONFIG) : {};

const runSet = (name) => {
  const out = {};
  for (const a of N(name).parameters.assignments.assignments) out[a.name] = resolve(a.value, {});
  if (name === 'Config') {
    for (const [k, v] of Object.entries(CONFIG_OVERRIDES)) {
      if (!(k in out)) throw new Error(`E2E_CONFIG sets "${k}", which is not a Config field`);
      out[k] = v;
    }
  }
  return put(name, [out]);
};

const runCode = (name, items) => {
  const src = N(name).parameters.jsCode;
  const $input = { all: () => wrap(items), first: () => wrap(items)[0] };
  const result = new Function('$input', '$', '$json', src)($input, $, wrap(items)[0]?.json ?? {});
  return put(name, result ?? []);
};

const runIf = (name, item) => {
  const spec = N(name).parameters.conditions;
  const results = spec.conditions.map((c) => {
    const left = resolve(c.leftValue, item.json);
    const right = resolve(c.rightValue, item.json);
    const { type, operation } = c.operator;
    if (type === 'number' && operation === 'gte') return Number(left) >= Number(right);
    if (type === 'boolean' && operation === 'false') return left === false || left === 'false';
    if (type === 'boolean' && operation === 'true') return left === true || left === 'true';
    if (type === 'string' && operation === 'equals') return String(left) === String(right);
    throw new Error(`runner does not implement IF operator ${type}.${operation}`);
  });
  return spec.combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
};

// ---------------------------------------------------------------------------
// mocked outbound calls
// ---------------------------------------------------------------------------
const FIXTURES = {
  arbeitnow: 'arbeitnow.json',
  remoteok: 'remoteok.json',
  'greenhouse:acme-labs': 'greenhouse-acme.json',
  'lever:globex': 'lever-globex.json',
};

const fetchMasterResume = () =>
  put('Fetch Master Resume', [{ data: readFileSync(join(root, 'build/fixtures/master-resume.txt'), 'utf8') }]);

const fetchFreeJobBoards = (requests) => {
  const responses = [];
  for (const { json: req } of wrap(requests)) {
    const fixture = FIXTURES[req.sourceName];
    if (!fixture) {
      // Exactly what a dead source looks like: the node continues on error.
      say(`    ${req.sourceName.padEnd(22)} -> no fixture, simulating a dead source`);
      responses.push({ error: 'ENOTFOUND (simulated)' });
      continue;
    }
    const body = JSON.parse(readFileSync(join(root, 'build/fixtures', fixture), 'utf8'));
    const count = Array.isArray(body) ? body.length : (body.jobs ?? body.data ?? []).length;
    say(`    ${req.sourceName.padEnd(22)} -> ${count} raw records`);
    // n8n splits a top-level array into one item per element.
    if (Array.isArray(body)) responses.push(...body);
    else responses.push(body);
  }
  return put('Fetch Free Job Boards', responses);
};

// Parses multipart/related the way Drive does, so a malformed body fails here.
const createGoogleDoc = (item, index) => {
  const params = N('Create Google Doc').parameters;
  const contentType = resolve(params.rawContentType, item.json);
  const body = resolve(params.body, item.json);

  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) throw new Error(`Create Google Doc: no boundary in "${contentType}"`);

  const parts = body.split(`--${boundary}`).slice(1, -1);
  if (parts.length !== 2) throw new Error(`Create Google Doc: expected 2 parts, got ${parts.length}`);

  const [metaPart, htmlPart] = parts.map((p) => {
    const [headers, ...rest] = p.replace(/^\r\n/, '').split('\r\n\r\n');
    return { headers, content: rest.join('\r\n\r\n').replace(/\r\n$/, '') };
  });

  const metadata = JSON.parse(metaPart.content);
  if (metadata.mimeType !== 'application/vnd.google-apps.document') {
    throw new Error(`Create Google Doc: metadata mimeType is "${metadata.mimeType}" - Drive would not convert this`);
  }
  if (!/text\/html/.test(htmlPart.headers)) throw new Error('Create Google Doc: content part is not text/html');

  const file = `resume-${index + 1}-${metadata.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.html`;
  writeFileSync(join(outDir, file), htmlPart.content);

  const id = `doc_${(index + 1).toString().padStart(3, '0')}`;
  return put('Create Google Doc', [{ id, name: metadata.name, webViewLink: `https://docs.google.com/document/d/${id}/edit` }]);
};

// E2E_SEED_SHEET replays a previous run's sheet, which is how the re-run
// (idempotency) check proves the anti-join works against real logged rows.
const sheets = process.env.E2E_SEED_SHEET
  ? JSON.parse(readFileSync(process.env.E2E_SEED_SHEET, 'utf8'))
  : { Applications: [], Skipped: [] };
const sheetTab = (name) => resolve(N(name).parameters.sheetName.value, {});
const appendedThisRun = [];
const sheetAppend = (name, items) => {
  for (const { json } of wrap(items)) { sheets[sheetTab(name)].push(json); appendedThisRun.push(json); }
  return put(name, items);
};
const sheetRead = (name) => put(name, sheets[sheetTab(name)]);

// ---------------------------------------------------------------------------
// the models
// ---------------------------------------------------------------------------
const promptsFor = (name, $json) => {
  const p = N(name).parameters;
  return { system: p.messages.messageValues[0].message, user: resolve(p.text, $json) };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Free-tier Flash returns 503 UNAVAILABLE under load often enough that a
// single attempt is not a real test. The workflow's own nodes retry too.
// n8n's outputParserStructured injects the schema into the prompt so the model
// emits the exact keys. The runner gets the same effect - more strictly - by
// deriving a responseSchema from the parser node's own jsonSchemaExample.
const responseSchemaFromExample = () => {
  const example = JSON.parse(N('Relevance Schema').parameters.jsonSchemaExample);
  const typeOf = (v) => (typeof v === 'number' ? 'NUMBER' : typeof v === 'boolean' ? 'BOOLEAN' : 'STRING');
  return {
    type: 'OBJECT',
    properties: Object.fromEntries(Object.entries(example).map(([k, v]) => [k, { type: typeOf(v) }])),
    required: Object.keys(example),
    propertyOrdering: Object.keys(example),
  };
};

const callGemini = async (nodeName, system, user, wantJson, attempt = 1) => {
  const model = process.env.E2E_MODEL ?? N(nodeName).parameters.modelName.replace(/^models\//, '');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: N(nodeName).parameters.options.temperature,
          maxOutputTokens: N(nodeName).parameters.options.maxOutputTokens,
          ...(wantJson
            ? { responseMimeType: 'application/json', responseSchema: responseSchemaFromExample() }
            : {}),
        },
      }),
    },
  );
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    const retryable = res.status === 503 || res.status === 429 || res.status >= 500;
    if (retryable && attempt < 5) {
      const wait = 2000 * 2 ** (attempt - 1);
      say(`       ${res.status} from ${model}, retry ${attempt}/4 in ${wait / 1000}s`);
      await sleep(wait);
      return callGemini(nodeName, system, user, wantJson, attempt + 1);
    }
    throw new Error(`Gemini ${res.status} after ${attempt} attempt(s): ${body}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (process.env.E2E_DUMP) {
    const u = data.usageMetadata ?? {};
    say(`       [${nodeName}] finish=${data.candidates?.[0]?.finishReason} thoughts=${u.thoughtsTokenCount ?? 0} out=${u.candidatesTokenCount ?? 0}`);
    say(`       [raw] ${text.replace(/\s+/g, ' ').slice(0, 420)}`);
  }
  return text;
};

// Deterministic stand-in: scores on how much of the posting's vocabulary the
// resume actually covers, and applies the prompt's own hard caps.
const stubScore = (job, resume) => {
  const words = (t) => new Set(String(t).toLowerCase().match(/[a-z+#.]{3,}/g) ?? []);
  const have = words(resume);
  const signals = ['python', 'go', 'sql', 'airflow', 'dbt', 'aws', 'terraform', 'kubernetes', 'postgres', 'snowflake', 'kafka', 'etl', 'docker'];
  const asked = signals.filter((s) => words(job.description).has(s));
  const met = asked.filter((s) => have.has(s));
  let score = asked.length ? Math.round((met.length / asked.length) * 95) : 35;

  const text = `${job.title} ${job.description}`.toLowerCase();
  const dealBreaker = /commission-only|unpaid|on-site five days|five days a week|security clearance/.test(text);
  if (dealBreaker) score = Math.min(score, 20);
  if (/\b(manager|director|head of)\b/.test(job.title.toLowerCase())) score = Math.min(score, 45);

  return {
    relevant: score >= 50,
    score,
    verdict: score >= 85 ? 'strong match' : score >= 70 ? 'good match' : score >= 50 ? 'stretch' : 'not a fit',
    matchReasons: met.length ? `Resume demonstrates ${met.join(', ')}, which the posting asks for.` : 'Little overlap with the posting.',
    gaps: asked.filter((s) => !have.has(s)).join(', ') || 'none identified',
    dealBreakerHit: dealBreaker,
    suggestedResumeAngle: `Lead with ${met.slice(0, 2).join(' and ') || 'platform ownership'}.`,
  };
};

const stubResume = (job, resume) => {
  const [name, contact] = resume.split('\n');
  const bullets = resume.split('\n').filter((l) => l.startsWith('- ')).slice(0, 6);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${job.title}</title>
<style>body{font-family:Georgia,serif;font-size:11pt;line-height:1.4}h1{font-size:20pt;margin:0}
h2{font-size:12pt;border-bottom:1px solid #333;margin:14pt 0 6pt}.c{font-size:9pt;color:#444}</style></head><body>
<h1>${name}</h1><p class="c">${contact}</p>
<h2>Professional Summary</h2><p>Backend and platform engineer targeting the ${job.title} role at ${job.company}. Eight years building and owning data platforms in Python, Go and AWS.</p>
<h2>Selected Experience</h2><ul>${bullets.map((b) => `<li>${b.slice(2)}</li>`).join('')}</ul>
<h2>Education</h2><p>BSc Computer Science, University of Manchester, 2017.</p>
</body></html>`;
};

const runChain = async (chainNode, modelNode, item, wantJson, stub) => {
  const { system, user } = promptsFor(chainNode, item.json);
  if (USE_REAL_MODEL) {
    const raw = await callGemini(modelNode, system, user, wantJson);
    return wantJson ? { output: JSON.parse(raw) } : { text: raw };
  }
  return wantJson ? { output: stub() } : { text: stub() };
};

// ---------------------------------------------------------------------------
// drive the graph
// ---------------------------------------------------------------------------
say(`\n=== END-TO-END RUN =============================================`);
say(`workflow : ${wf.name}`);
say(`model    : ${USE_REAL_MODEL ? `REAL Gemini (${N('Scoring Model').parameters.modelName})` : 'local deterministic stub (no GEMINI_API_KEY set)'}`);

say(`\n[Part 1] Config + master resume`);
const config = runSet('Config').json ?? runSet('Config')[0].json;
const cfg = store.get('Config')[0].json;
say(`    jobSource=${cfg.jobSource}  maxJobsPerRun=${cfg.maxJobsPerRun}  threshold=${cfg.relevanceThreshold}  throttle=${cfg.throttleSeconds}s`);
const resumeText = fetchMasterResume()[0].json.data;
say(`    master resume: ${resumeText.length} chars`);

say(`\n[Part 2] Find the jobs`);
runCode('Expand Searches', [{ json: {} }]);
const isFree = runIf('Route Job Source', { json: {} });
say(`    Route Job Source -> ${isFree ? 'FREE path' : 'APIFY path'}`);
if (!isFree) throw new Error('this runner only drives the free path');
const requests = runCode('Build Free Requests', [{ json: {} }]);
say(`    ${requests.length} source requests built`);
const raw = fetchFreeJobBoards(requests);

say(`\n[Part 3] Normalise, filter, de-duplicate`);
const normalised = runCode('Normalize Jobs', raw);
say(`    Normalize Jobs      -> ${normalised.length} jobs`);
for (const { json: j } of normalised) say(`         ${String(j.score ?? '').padStart(0)}${j.title} @ ${j.company} (${j.location || 'n/a'})`);
const matched = runCode('Match Search Terms', normalised);
say(`    Match Search Terms  -> ${matched.length} kept, ${normalised.length - matched.length} dropped on title`);
sheetRead('Get Logged Jobs');
sheetRead('Get Skipped Jobs');
say(`    dedupe set         -> ${sheets.Applications.length} applied + ${sheets.Skipped.length} skipped rows`);
const fresh = runCode('Filter New Jobs', store.get('Get Skipped Jobs'));
say(`    Filter New Jobs     -> ${fresh.length} new`);

say(`\n[Parts 4-8] Per-job loop`);
let docIndex = 0;
for (const job of fresh) {
  put('Loop Over Jobs', [job]);
  const scored = await runChain('Score Job Relevance', 'Scoring Model', job, true, () => stubScore(job.json, resumeText));
  const merged = runCode('Merge Score', [{ json: scored }])[0];
  const worth = runIf('Worth Applying?', merged);
  say(`  ${String(merged.json.score).padStart(3)}  ${worth ? 'WRITE ' : 'skip  '} ${merged.json.title} @ ${merged.json.company}`);

  if (worth) {
    const written = await runChain('Write Tailored Resume', 'Resume Model', merged, false, () => stubResume(merged.json, resumeText));
    const cleaned = runCode('Clean Resume HTML', [{ json: written }])[0];
    const upload = runCode('Build Drive Upload', [cleaned])[0];
    const doc = createGoogleDoc(upload, docIndex++)[0];
    const row = runCode('Build Log Row', [doc])[0];
    sheetAppend('Log Application', [row]);
    say(`       resume ${cleaned.json.resumeHtml.length} chars -> ${doc.json.webViewLink}`);
  } else {
    const row = runCode('Build Skipped Row', [merged])[0];
    sheetAppend('Log Skipped', [row]);
  }
}

say(`\n[Part 8] Run summary`);
const loopDone = appendedThisRun.map((json) => ({ json }));
const summary = runCode('Build Run Summary', loopDone)[0].json;
say(`    subject: ${summary.subject}`);
say(`    scored=${summary.scored} resumes=${summary.resumesGenerated} skipped=${summary.skipped} topScore=${summary.topScore}`);

say(`\n=== SHEET: Applications (${sheets.Applications.length} rows) ===`);
for (const r of sheets.Applications) say(`  ${r.Score}  ${r.Title} | ${r.Company} | ${r['Resume Doc']}`);
say(`=== SHEET: Skipped (${sheets.Skipped.length} rows) ===`);
for (const r of sheets.Skipped) say(`  ${r.Score}  ${r.Title} | ${r.Company} | ${r.Reason}`);

writeFileSync(join(outDir, 'applications.json'), JSON.stringify(sheets, null, 2));
writeFileSync(join(outDir, 'run.log'), `${log.join('\n')}\n`);
say(`\nArtifacts in build/e2e-output/: ${docIndex} resume HTML file(s), applications.json, run.log`);
