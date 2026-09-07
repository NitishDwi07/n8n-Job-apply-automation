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
  const logged = [{ 'Job URL': 'https://linkedin.com/jobs/view/1?trk=foo', 'Job ID': '1' }];
  const skipped = [{ 'Job URL': '', 'Job ID': '2' }];
  const out = run('filter-new-jobs.js', [], {
    Config: [CONFIG],
    'Match Search Terms': scraped,
    'Get Logged Jobs': logged,
    'Get Skipped Jobs': skipped,
  });
  assert.deepEqual(out.map((i) => i.json.jobId), ['3', '4', '5'], 'dedupes then caps at 3');
});

test('filter-new-jobs works on a first run with both tabs empty', () => {
  const out = run('filter-new-jobs.js', [], {
    Config: [{ maxJobsPerRun: 10 }],
    'Match Search Terms': [{ jobId: 'a', url: 'u' }],
    'Get Logged Jobs': [],
    'Get Skipped Jobs': [],
  });
  assert.equal(out.length, 1);
});

test('filter-new-jobs will not re-score a job already on the Skipped tab', () => {
  const out = run('filter-new-jobs.js', [], {
    Config: [{ maxJobsPerRun: 10 }],
    'Match Search Terms': [{ jobId: 'rejected', url: 'https://job/1' }, { jobId: 'brand-new', url: 'https://job/2' }],
    'Get Logged Jobs': [],
    'Get Skipped Jobs': [{ 'Job ID': 'rejected', 'Job URL': 'https://job/1' }],
  });
  assert.deepEqual(out.map((i) => i.json.jobId), ['brand-new'], 'a reject is never paid for twice');
});

// ---------------------------------------------------------------------------
test('normalize-jobs reads the free company-board and aggregator shapes', () => {
  const items = [
    // Greenhouse: entity-encoded html, nested location, company only in the URL
    { jobs: [{ id: 501, title: 'Backend Engineer', location: { name: 'Dublin' }, absolute_url: 'https://boards.greenhouse.io/acme-labs/jobs/501', content: '&lt;p&gt;Build &lt;strong&gt;systems&lt;/strong&gt;.&lt;/p&gt;', updated_at: '2026-09-01' }] },
    // Lever: `text` for title, `categories.location`, company only in the URL
    [{ id: 'abc', text: 'Platform Engineer', hostedUrl: 'https://jobs.lever.co/globex/abc', categories: { location: 'Remote', commitment: 'Full-time' }, descriptionPlain: 'Own the platform.', createdAt: 1756684800000 }],
    // Arbeitnow: `data` envelope, company_name, boolean remote flag
    { data: [{ slug: 'x1', title: 'Data Engineer', company_name: 'Initech', location: 'Berlin', url: 'https://arbeitnow.com/view/x1', description: 'ETL work.', remote: true }] },
    // RemoteOK: legal notice as the first element, `position` for title
    [{ legal: 'Data from remoteok.com' }, { id: '9', position: 'Site Reliability Engineer', company: 'Hooli', url: 'https://remoteok.com/l/9', description: 'Keep it up.', location: 'Worldwide' }],
  ];
  const out = run('normalize-jobs.js', items, {});
  const byTitle = Object.fromEntries(out.map((i) => [i.json.title, i.json]));

  assert.equal(Object.keys(byTitle).length, 4, 'legal notice dropped, all four jobs kept');
  assert.equal(byTitle['Backend Engineer'].company, 'Acme Labs', 'greenhouse company derived from the board slug');
  assert.equal(byTitle['Backend Engineer'].location, 'Dublin', 'nested location object flattened');
  assert.equal(byTitle['Backend Engineer'].description, 'Build systems.', 'entities decoded before tags stripped');
  assert.equal(byTitle['Platform Engineer'].company, 'Globex', 'lever company derived from the hosted URL');
  assert.equal(byTitle['Platform Engineer'].location, 'Remote', 'dot-path into categories');
  assert.equal(byTitle['Platform Engineer'].employmentType, 'Full-time');
  assert.equal(byTitle['Data Engineer'].company, 'Initech');
  assert.equal(byTitle['Data Engineer'].workplaceType, 'Remote', 'boolean remote flag mapped to text');
  assert.equal(byTitle['Site Reliability Engineer'].company, 'Hooli');
});

// ---------------------------------------------------------------------------
test('build-free-requests builds keyless URLs for every configured board', () => {
  const out = run('build-free-requests.js', [{}], {
    Config: [{ useAggregators: true, greenhouseCompanies: ['stripe'], leverCompanies: ['netflix'], ashbyCompanies: [] }],
  });
  const urls = out.map((i) => i.json.url);
  assert.equal(urls.length, 4, 'two aggregators plus two company boards');
  assert.ok(urls.includes('https://www.arbeitnow.com/api/job-board-api'));
  assert.ok(urls.includes('https://remoteok.com/api'));
  assert.ok(urls.includes('https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true'));
  assert.ok(urls.includes('https://api.lever.co/v0/postings/netflix?mode=json'));
  assert.ok(urls.every((u) => !u.includes('token') && !u.includes('key')), 'no credentials in any URL');
});

test('build-free-requests can run on company boards alone', () => {
  const out = run('build-free-requests.js', [{}], { Config: [{ useAggregators: false, greenhouseCompanies: ['figma'] }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].json.sourceName, 'greenhouse:figma');
});

test('build-free-requests refuses to run with no source at all', () => {
  assert.throws(
    () => run('build-free-requests.js', [{}], { Config: [{ useAggregators: false }] }),
    /No free job sources configured/,
  );
});

// ---------------------------------------------------------------------------
test('match-search-terms keeps includes, drops excludes, and excludes win', () => {
  const jobs = [
    { title: 'Senior Backend Engineer' },
    { title: 'Backend Engineering Intern' },   // include hit, but excluded
    { title: 'Enterprise Sales Executive' },   // neither
    { title: 'Platform Engineer' },
    { title: 'Head of Data Engineering' },     // include hit, excluded by "head of"
  ];
  const out = run('match-search-terms.js', jobs, {
    Config: [{ titleKeywords: ['backend', 'platform', 'data engineer'], excludeKeywords: ['intern', 'head of'] }],
  });
  assert.deepEqual(out.map((i) => i.json.title), ['Senior Backend Engineer', 'Platform Engineer']);
});

test('match-search-terms keeps everything when no keywords are set', () => {
  const out = run('match-search-terms.js', [{ title: 'Anything' }, { title: 'At All' }], { Config: [{}] });
  assert.equal(out.length, 2);
});

test('match-search-terms is case-insensitive', () => {
  const out = run('match-search-terms.js', [{ title: 'BACKEND ENGINEER' }], { Config: [{ titleKeywords: ['Backend'] }] });
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

test('merge-score fails loudly rather than silently scoring 0', () => {
  // A silent 0 looks exactly like a legitimate rejection, so schema drift
  // would hide a completely broken screener.
  assert.throws(
    () => run('merge-score.js', [], { 'Loop Over Jobs': [{ jobId: '9' }] }, { output: undefined }),
    /no usable "score"/,
  );
  assert.throws(
    () => run('merge-score.js', [], { 'Loop Over Jobs': [{ jobId: '9' }] }, { output: { matchScore: 98 } }),
    /got keys: matchScore/,
  );
});

test('merge-score accepts a score of 0 that the model actually returned', () => {
  const out = run('merge-score.js', [], { 'Loop Over Jobs': [{ jobId: '9' }] }, {
    output: { score: 0, relevant: false, verdict: 'not a fit', dealBreakerHit: true },
  });
  assert.equal(out[0].json.score, 0, 'a real 0 is data, not an error');
  assert.equal(out[0].json.dealBreakerHit, true);
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
