#!/usr/bin/env node
// Runs each Code node's source outside n8n against fixtures, with $input, $
// and $json stubbed. The scraper-shape handling in particular is the kind of
// thing you do not want to debug by re-running a paid Apify actor.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Executes a Code node source file.
 * @param file      filename under src/code
 * @param items     items on the node's own input
 * @param nodeData  { 'Node Name': [items] } for $('Node Name') lookups
 * @param json      value of $json (defaults to the first input item)
 */
const run = (file, items = [], nodeData = {}, json) => {
  const src = readFileSync(join(root, 'src/code', file), 'utf8');
  const wrap = (list) => list.map((i) => (i && 'json' in i ? i : { json: i }));

  const $input = { all: () => wrap(items), first: () => wrap(items)[0] };
  const $ = (name) => {
    if (!(name in nodeData)) throw new Error(`test stub: no data registered for $('${name}')`);
    const list = wrap(nodeData[name]);
    return { all: () => list, first: () => list[0], last: () => list[list.length - 1] };
  };
  const $json = json ?? wrap(items)[0]?.json ?? {};

  // eslint-disable-next-line no-new-func
  return new Function('$input', '$', '$json', `${src}\n`)($input, $, $json);
};

const CONFIG = {
  googleSheetId: 'sheet-123',
  masterResumeDocId: 'doc-123',
  driveFolderId: 'folder-abc',
  maxJobsPerRun: 3,
  relevanceThreshold: 70,
  candidateName: 'Ada Lovelace',
  notifyEmail: 'ada@example.com',
  searchQueries: [{ title: 'Platform Engineer', location: 'Germany' }, { title: 'SRE', location: 'EU', rows: 10 }],
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
test('expand-searches fills defaults and keeps overrides', () => {
  const out = run('expand-searches.js', [{}], { Config: [CONFIG] });
  assert.equal(out.length, 2);
  assert.equal(out[0].json.rows, 50, 'default rows');
  assert.equal(out[0].json.publishedAt, 'r604800');
  assert.equal(out[1].json.rows, 10, 'per-search override wins');
  assert.equal(out[1].json.searchIndex, 1);
});

test('expand-searches throws on an empty config', () => {
  assert.throws(() => run('expand-searches.js', [{}], { Config: [{ searchQueries: [] }] }), /searchQueries is empty/);
});

// ---------------------------------------------------------------------------
test('normalize-jobs handles three different actor output shapes', () => {
  const items = [
    // shape A: flat item, LinkedIn-ish field names
    { id: '111', title: 'Platform Engineer', companyName: 'Acme', location: 'Berlin', jobUrl: 'https://www.linkedin.com/jobs/view/111?refId=xyz', descriptionText: 'Own the platform.' },
    // shape B: nested company object, html description, one item wrapping an array
    { jobs: [{ jobId: '222', jobTitle: 'SRE', company: { name: 'Globex' }, formattedLocation: 'Remote', link: 'https://linkedin.com/jobs/view/222/', descriptionHtml: '<p>Run <strong>things</strong>.</p><script>bad()</script>' }] },
    // shape C: an error item from a failed actor run
    { error: 'actor-timeout' },
    // shape D: a duplicate of shape A
    { id: '111', title: 'Platform Engineer', jobUrl: 'https://www.linkedin.com/jobs/view/111' },
  ];
  const out = run('normalize-jobs.js', items, {});
  assert.equal(out.length, 2, 'error item skipped, duplicate collapsed');

  const [first, second] = out.map((i) => i.json);
  assert.equal(first.url, 'https://www.linkedin.com/jobs/view/111', 'query string stripped');
  assert.equal(first.company, 'Acme');
  assert.equal(second.company, 'Globex', 'nested company object flattened');
  assert.equal(second.url, 'https://linkedin.com/jobs/view/222', 'trailing slash stripped');
  assert.equal(second.description, 'Run things.', 'html stripped, script removed');
  assert.ok(second.scrapedAt.endsWith('Z'));
});

test('normalize-jobs drops items with neither a title nor a url', () => {
  const out = run('normalize-jobs.js', [{ companyName: 'Ghost Inc' }], {});
  assert.equal(out.length, 0);
});

// ---------------------------------------------------------------------------
test('filter-new-jobs anti-joins the sheet and honours the cap', () => {
  const scraped = [
    { jobId: '1', url: 'https://linkedin.com/jobs/view/1' }, // already logged by URL
    { jobId: '2', url: 'https://linkedin.com/jobs/view/2' }, // already logged by ID
    { jobId: '3', url: 'https://linkedin.com/jobs/view/3' },
    { jobId: '4', url: 'https://linkedin.com/jobs/view/4' },
    { jobId: '5', url: 'https://linkedin.com/jobs/view/5' },
    { jobId: '6', url: 'https://linkedin.com/jobs/view/6' }, // beyond maxJobsPerRun
  ];
  const logged = [
    { 'Job URL': 'https://linkedin.com/jobs/view/1?trk=foo', 'Job ID': '1' },
    { 'Job URL': '', 'Job ID': '2' },
  ];
  const out = run('filter-new-jobs.js', logged, { Config: [CONFIG], 'Normalize Jobs': scraped });
  assert.deepEqual(out.map((i) => i.json.jobId), ['3', '4', '5'], 'dedupes then caps at 3');
});

test('filter-new-jobs works on a first run with an empty sheet', () => {
  const out = run('filter-new-jobs.js', [], { Config: [{ maxJobsPerRun: 10 }], 'Normalize Jobs': [{ jobId: 'a', url: 'u' }] });
  assert.equal(out.length, 1);
});

// ---------------------------------------------------------------------------
test('merge-score re-attaches the job and clamps the score', () => {
  const job = { jobId: '9', title: 'SRE', company: 'Acme' };
  const out = run('merge-score.js', [], { 'Loop Over Jobs': [job] }, {
    output: { relevant: true, score: 142.7, verdict: 'strong match', matchReasons: 'ok', gaps: '', dealBreakerHit: false },
  });
  const result = out[0].json;
  assert.equal(result.title, 'SRE');
  assert.equal(result.score, 100, 'clamped to 100');
  assert.equal(result.relevant, true);
  assert.equal(result.dealBreakerHit, false);
});

test('merge-score survives a malformed model response', () => {
  const out = run('merge-score.js', [], { 'Loop Over Jobs': [{ jobId: '9' }] }, { output: undefined });
  assert.equal(out[0].json.score, 0);
  assert.equal(out[0].json.relevant, false);
});

// ---------------------------------------------------------------------------
test('clean-resume-html strips fences and preamble, and wraps a fragment', () => {
  const body = `<h1>Ada Lovelace</h1><p>${'Experienced platform engineer. '.repeat(20)}</p>`;
  const out = run('clean-resume-html.js', [], { 'Merge Score': [{ title: 'SRE' }] }, {
    text: `Here you go!\n\`\`\`html\n${body}\n\`\`\``,
  });
  const html = out[0].json.resumeHtml;
  assert.ok(!html.includes('```'), 'code fence removed');
  assert.ok(!html.includes('Here you go'), 'preamble removed');
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'fragment wrapped into a document');
  assert.ok(html.includes('<title>SRE</title>'));
});

test('clean-resume-html refuses a truncated resume', () => {
  assert.throws(
    () => run('clean-resume-html.js', [], { 'Merge Score': [{ title: 'SRE' }] }, { text: '<h1>Ada</h1>' }),
    /refusing to upload/,
  );
});

// ---------------------------------------------------------------------------
test('build-drive-upload emits a valid multipart/related body', () => {
  const job = { title: 'Platform Engineer', company: 'Acme / Globex', jobId: '1' };
  const html = `<!DOCTYPE html><html><body>${'x'.repeat(500)}</body></html>`;
  const out = run('build-drive-upload.js', [], { 'Merge Score': [job], Config: [CONFIG] }, { resumeHtml: html });
  const { uploadBody, uploadBoundary, docName } = out[0].json;

  assert.equal(docName, 'Resume - Acme Globex - Platform Engineer', 'slash stripped from filename');
  assert.ok(uploadBody.startsWith(`--${uploadBoundary}\r\n`));
  assert.ok(uploadBody.endsWith(`--${uploadBoundary}--\r\n`));
  assert.equal(uploadBody.split(`--${uploadBoundary}`).length - 1, 3, 'two parts plus the closing delimiter');

  const metadata = JSON.parse(uploadBody.split('\r\n')[3]);
  assert.equal(metadata.mimeType, 'application/vnd.google-apps.document', 'this is what makes Drive convert it');
  assert.deepEqual(metadata.parents, ['folder-abc']);
  assert.ok(uploadBody.includes('Content-Type: text/html; charset=UTF-8'));
  assert.ok(uploadBody.includes(html));
});

test('build-drive-upload omits parents when the folder is still a placeholder', () => {
  const out = run(
    'build-drive-upload.js',
    [],
    { 'Merge Score': [{ title: 'T', company: 'C' }], Config: [{ driveFolderId: 'PUT_DRIVE_FOLDER_ID_HERE' }] },
    { resumeHtml: 'x'.repeat(500) },
  );
  const metadata = JSON.parse(out[0].json.uploadBody.split('\r\n')[3]);
  assert.equal(metadata.parents, undefined, 'an unset folder must not be sent as a parent ID');
});

// ---------------------------------------------------------------------------
test('build-log-row matches the Applications header and derives a doc link', () => {
  const job = { jobId: '1', title: 'SRE', company: 'Acme', location: 'Berlin', workplaceType: 'Remote', salary: '', score: 88, verdict: 'strong match', matchReasons: 'r', gaps: 'g', url: 'https://job', applyUrl: 'https://apply' };
  const out = run('build-log-row.js', [], { 'Build Drive Upload': [job] }, { id: 'doc-9' });
  const row = out[0].json;
  assert.equal(row['Resume Doc'], 'https://docs.google.com/document/d/doc-9/edit');
  assert.equal(row.Status, 'Resume ready');
  assert.equal(row.Score, 88);
  assert.deepEqual(Object.keys(row), [
    'Date', 'Job ID', 'Title', 'Company', 'Location', 'Workplace', 'Salary',
    'Score', 'Verdict', 'Match Reasons', 'Gaps', 'Resume Doc', 'Job URL', 'Apply URL', 'Status',
  ]);
});

test('build-log-row prefers the webViewLink Drive returns', () => {
  const out = run('build-log-row.js', [], { 'Build Drive Upload': [{}] }, { id: 'doc-9', webViewLink: 'https://drive/link' });
  assert.equal(out[0].json['Resume Doc'], 'https://drive/link');
});

// ---------------------------------------------------------------------------
test('build-skipped-row explains deal-breakers', () => {
  const out = run('build-skipped-row.js', [], {}, { jobId: '1', title: 'T', company: 'C', location: 'L', score: 15, verdict: 'no', gaps: 'on-site 5 days', dealBreakerHit: true, url: 'u' });
  assert.equal(out[0].json.Reason, 'Deal-breaker: on-site 5 days');
  assert.equal(out[0].json.Status, 'Skipped');
});

// ---------------------------------------------------------------------------
test('build-summary counts both branches and escapes html', () => {
  const rows = [
    { Status: 'Resume ready', Score: 91, Title: 'SRE & Ops', Company: 'A<b>', Location: 'Berlin', 'Resume Doc': 'https://d/1', 'Job URL': 'https://j/1' },
    { Status: 'Resume ready', Score: 75, Title: 'Platform', Company: 'B', Location: 'EU', 'Resume Doc': 'https://d/2', 'Job URL': 'https://j/2' },
    { Status: 'Skipped', Score: 20, Title: 'Intern', Company: 'C' },
  ];
  const out = run('build-summary.js', rows, {});
  const summary = out[0].json;
  assert.equal(summary.scored, 3);
  assert.equal(summary.resumesGenerated, 2);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.topScore, 91);
  assert.equal(summary.subject, '2 tailored resumes ready (3 jobs scored)');
  assert.ok(summary.html.includes('SRE &amp; Ops'), 'ampersand escaped');
  assert.ok(summary.html.includes('A&lt;b&gt;'), 'tags escaped');
  assert.ok(summary.html.indexOf('91') < summary.html.indexOf('75'), 'sorted by score');
});

test('build-summary handles a run where nothing cleared the threshold', () => {
  const out = run('build-summary.js', [{ Status: 'Skipped', Score: 10 }], {});
  assert.equal(out[0].json.subject, '0 tailored resumes ready (1 jobs scored)');
  assert.ok(out[0].json.html.includes('Nothing cleared the threshold'));
});

// ---------------------------------------------------------------------------
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  pass  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} code-node tests passed.`);
process.exit(failed === 0 ? 0 : 1);
