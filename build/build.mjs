#!/usr/bin/env node
// Assembles workflows/job-application-automation.json from the editable
// sources in src/. Code nodes and prompts live as real .js / .md files so they
// stay reviewable and diffable instead of being escaped one-liners in JSON.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (name) => readFileSync(join(root, 'src/code', name), 'utf8').trimEnd();
const prompt = (name) => readFileSync(join(root, 'src/prompts', name), 'utf8').trimEnd();
const schema = (name) => readFileSync(join(root, 'src/schemas', name), 'utf8').trimEnd();

const GOOGLE_SHEET = (tab) => ({
  documentId: { __rl: true, value: "={{ $('Config').first().json.googleSheetId }}", mode: 'id' },
  sheetName: { __rl: true, value: tab, mode: 'name' },
});

let nodeId = 0;
const uid = (name) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${++nodeId}`;

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  id: uid(name),
  name,
  type,
  typeVersion,
  position,
  parameters,
  ...extra,
});

const sticky = (part, height, width, position, content) =>
  node(`Part ${part}`, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color: 4 });

const codeNode = (name, position, file, extra = {}) =>
  node(name, 'n8n-nodes-base.code', 2, position, { jsCode: code(file) }, extra);

// ---------------------------------------------------------------------------
// Part 1 - triggers and configuration
// ---------------------------------------------------------------------------
const nodes = [
  node('Run Every Weekday Morning', 'n8n-nodes-base.scheduleTrigger', 1.2, [-660, 200], {
    rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * 1-5' }] },
  }),

  node('Run Manually', 'n8n-nodes-base.manualTrigger', 1, [-660, 400], {}),

  node('Config', 'n8n-nodes-base.set', 3.4, [-440, 300], {
    assignments: {
      assignments: [
        { id: 'c01', name: 'googleSheetId', type: 'string', value: 'PUT_GOOGLE_SHEET_ID_HERE' },
        { id: 'c02', name: 'masterResumeDocId', type: 'string', value: 'PUT_MASTER_RESUME_GOOGLE_DOC_ID_HERE' },
        { id: 'c03', name: 'driveFolderId', type: 'string', value: 'PUT_DRIVE_FOLDER_ID_HERE' },
        // 'free' uses keyless public job boards. 'apify' uses the LinkedIn
        // scraper, which needs an Apify token and burns credit.
        { id: 'c04', name: 'jobSource', type: 'string', value: 'free' },
        { id: 'c05', name: 'apifyActorId', type: 'string', value: 'bebity~linkedin-jobs-scraper' },
        { id: 'c06', name: 'useAggregators', type: 'boolean', value: true },
        // Seconds between jobs. Gemini's free tier is rate-limited per minute;
        // 10s keeps two model calls per job comfortably under the cap.
        { id: 'c07', name: 'throttleSeconds', type: 'number', value: 10 },
        { id: 'c08', name: 'maxJobsPerRun', type: 'number', value: 25 },
        { id: 'c09', name: 'relevanceThreshold', type: 'number', value: 70 },
        { id: 'c19', name: 'candidateName', type: 'string', value: 'Your Name' },
        { id: 'c20', name: 'candidateEmail', type: 'string', value: 'you@example.com' },
        { id: 'c18', name: 'candidatePhone', type: 'string', value: '+1 555 0100' },
        { id: 'c19', name: 'candidateLinkedIn', type: 'string', value: 'linkedin.com/in/your-handle' },
        { id: 'c20', name: 'candidateLocation', type: 'string', value: 'Berlin, Germany - open to remote in EU, no relocation' },
        { id: 'c18', name: 'desiredRoles', type: 'string', value: 'Senior Backend Engineer, Platform Engineer, Data Engineer' },
        { id: 'c19', name: 'mustHaves', type: 'string', value: 'Python or Go, cloud infrastructure ownership, remote-friendly' },
        { id: 'c20', name: 'dealBreakers', type: 'string', value: 'On-site five days a week, unpaid internship, commission-only pay, security clearance required' },
        { id: 'c18', name: 'minSalary', type: 'string', value: '80000 EUR base' },
        { id: 'c19', name: 'notifyEmail', type: 'string', value: 'you@example.com' },
        {
          id: 'c20',
          name: 'searchQueries',
          type: 'array',
          value:
            '={{ [\n' +
            "  { title: 'Senior Backend Engineer', location: 'Germany', rows: 50, publishedAt: 'r604800' },\n" +
            "  { title: 'Platform Engineer', location: 'European Union', rows: 50, publishedAt: 'r604800' }\n" +
            '] }}',
        },
        // The cheapest filter in the pipeline: every job dropped here is a job
        // you never pay a model to read. Empty titleKeywords keeps everything.
        {
          id: 'c21',
          name: 'titleKeywords',
          type: 'array',
          value: "={{ ['backend', 'platform', 'data engineer', 'infrastructure', 'devops', 'site reliability'] }}",
        },
        {
          id: 'c22',
          name: 'excludeKeywords',
          type: 'array',
          value: "={{ ['intern', 'internship', 'sales', 'recruiter', 'manager', 'director', 'principal'] }}",
        },
        // Public ATS boards - add the companies you actually want to work for.
        // The slug is the last path segment of their careers page URL.
        { id: 'c23', name: 'greenhouseCompanies', type: 'array', value: "={{ ['stripe', 'figma'] }}" },
        { id: 'c24', name: 'leverCompanies', type: 'array', value: "={{ ['netflix'] }}" },
        { id: 'c25', name: 'ashbyCompanies', type: 'array', value: '={{ [] }}' },
      ],
    },
    options: {},
  }),

  node('Fetch Master Resume', 'n8n-nodes-base.httpRequest', 4.2, [-220, 300], {
    url: "=https://www.googleapis.com/drive/v3/files/{{ $('Config').first().json.masterResumeDocId }}/export",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleDriveOAuth2Api',
    sendQuery: true,
    queryParameters: { parameters: [{ name: 'mimeType', value: 'text/plain' }] },
    options: { response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),

  // -------------------------------------------------------------------------
  // Part 2 - scrape LinkedIn jobs with Apify
  // -------------------------------------------------------------------------
  codeNode('Expand Searches', [0, 300], 'expand-searches.js'),

  node('Route Job Source', 'n8n-nodes-base.if', 2.2, [200, 300], {
    conditions: {
      options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        {
          id: 'src',
          leftValue: "={{ $('Config').first().json.jobSource }}",
          rightValue: 'free',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  }),

  codeNode('Build Free Requests', [420, 180], 'build-free-requests.js'),

  node('Fetch Free Job Boards', 'n8n-nodes-base.httpRequest', 4.2, [640, 180], {
    url: '={{ $json.url }}',
    options: { timeout: 30000, response: { response: { neverError: false } } },
  }, {
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  }),

  node('Scrape LinkedIn Jobs', 'n8n-nodes-base.httpRequest', 4.2, [420, 420], {
    method: 'POST',
    url: "=https://api.apify.com/v2/acts/{{ $('Config').first().json.apifyActorId }}/run-sync-get-dataset-items",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendQuery: true,
    queryParameters: { parameters: [{ name: 'timeout', value: '280' }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      '={{ JSON.stringify(Object.fromEntries(Object.entries($json).filter(([key, value]) => key !== \'searchIndex\' && value !== \'\' && value !== null && value !== undefined))) }}',
    options: { timeout: 300000 },
  }, {
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  }),

  // -------------------------------------------------------------------------
  // Part 3 - normalise and de-duplicate
  // -------------------------------------------------------------------------
  codeNode('Normalize Jobs', [880, 300], 'normalize-jobs.js'),

  codeNode('Match Search Terms', [1100, 300], 'match-search-terms.js'),

  node('Get Logged Jobs', 'n8n-nodes-base.googleSheets', 4.5, [1320, 300], {
    ...GOOGLE_SHEET('Applications'),
    options: {},
  }, { alwaysOutputData: true, onError: 'continueRegularOutput' }),

  // The Skipped tab is read too, so a rejected job is never re-scored.
  node('Get Skipped Jobs', 'n8n-nodes-base.googleSheets', 4.5, [1540, 300], {
    ...GOOGLE_SHEET('Skipped'),
    options: {},
  }, { alwaysOutputData: true, onError: 'continueRegularOutput' }),

  codeNode('Filter New Jobs', [1760, 300], 'filter-new-jobs.js'),

  node('Loop Over Jobs', 'n8n-nodes-base.splitInBatches', 3, [1980, 300], {
    options: { reset: false },
  }),

  // -------------------------------------------------------------------------
  // Part 4 - AI relevance scoring
  // -------------------------------------------------------------------------
  // Free-tier models are rate-limited per minute, so pace the loop.
  node('Throttle', 'n8n-nodes-base.wait', 1.1, [2200, 420], {
    amount: "={{ $('Config').first().json.throttleSeconds }}",
    unit: 'seconds',
  }, { webhookId: 'throttle-between-jobs' }),

  node('Score Job Relevance', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [2200, 420], {
    promptType: 'define',
    text: `=${prompt('relevance-user.md')}`,
    hasOutputParser: true,
    messages: { messageValues: [{ message: prompt('relevance-system.md') }] },
    // Free-tier Flash returns 503 UNAVAILABLE under load; observed in testing.
  }, { retryOnFail: true, maxTries: 4, waitBetweenTries: 8000 }),

  // Gemini Flash on the free tier. `gemini-flash-latest` is a floating alias
  // rather than a pinned version deliberately: a pin that Google retires makes
  // the workflow fail on import with "model not found", which is exactly what
  // a stale `gemini-2.0-flash` did here. Pin a version if you would rather
  // have stable scoring - see docs/SETUP.md.
  // Swap in lmChatOpenAi here if you would rather pay for GPT-4o; nothing
  // else in the graph changes.
  node('Scoring Model', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, [2160, 660], {
    modelName: 'models/gemini-flash-latest',
    // Gemini 3.x Flash spends output budget on reasoning tokens before it
    // emits anything - measured ~550-660 thinking tokens on this prompt. A
    // 700-token cap left 63 tokens for the answer and truncated the JSON, so
    // this budget covers thinking AND the structured result.
    options: { temperature: 0.1, maxOutputTokens: 3000 },
  }),

  node('Relevance Schema', '@n8n/n8n-nodes-langchain.outputParserStructured', 1.2, [2340, 660], {
    schemaType: 'fromJson',
    jsonSchemaExample: schema('relevance.example.json'),
  }),

  codeNode('Merge Score', [2420, 420], 'merge-score.js'),

  // -------------------------------------------------------------------------
  // Part 5 - filter out the jobs that are not worth a resume
  // -------------------------------------------------------------------------
  node('Worth Applying?', 'n8n-nodes-base.if', 2.2, [2640, 420], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        {
          id: 'g1',
          leftValue: '={{ $json.score }}',
          rightValue: "={{ $('Config').first().json.relevanceThreshold }}",
          operator: { type: 'number', operation: 'gte' },
        },
        {
          id: 'g2',
          leftValue: '={{ $json.dealBreakerHit }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'false', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  }),

  // -------------------------------------------------------------------------
  // Part 6 - write a tailored resume for this one job
  // -------------------------------------------------------------------------
  node('Write Tailored Resume', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [2880, 300], {
    promptType: 'define',
    text: `=${prompt('resume-user.md')}`,
    messages: { messageValues: [{ message: prompt('resume-system.md') }] },
  }, { retryOnFail: true, maxTries: 4, waitBetweenTries: 8000 }),

  node('Resume Model', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, [2880, 540], {
    modelName: 'models/gemini-flash-latest',
    // Same reason, plus a full resume document to emit.
    options: { temperature: 0.4, maxOutputTokens: 8000 },
  }),

  codeNode('Clean Resume HTML', [3100, 300], 'clean-resume-html.js'),

  // -------------------------------------------------------------------------
  // Part 7 - turn the HTML into a real Google Doc
  // -------------------------------------------------------------------------
  codeNode('Build Drive Upload', [3320, 300], 'build-drive-upload.js'),

  node('Create Google Doc', 'n8n-nodes-base.httpRequest', 4.2, [3540, 300], {
    method: 'POST',
    url: 'https://www.googleapis.com/upload/drive/v3/files',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleDriveOAuth2Api',
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: 'uploadType', value: 'multipart' },
        { name: 'supportsAllDrives', value: 'true' },
        { name: 'fields', value: 'id,name,webViewLink' },
      ],
    },
    sendBody: true,
    contentType: 'raw',
    rawContentType: '=multipart/related; boundary={{ $json.uploadBoundary }}',
    body: '={{ $json.uploadBody }}',
    options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),

  // -------------------------------------------------------------------------
  // Part 8 - log everything
  // -------------------------------------------------------------------------
  codeNode('Build Log Row', [3760, 300], 'build-log-row.js'),

  node('Log Application', 'n8n-nodes-base.googleSheets', 4.5, [3980, 300], {
    operation: 'append',
    ...GOOGLE_SHEET('Applications'),
    columns: { mappingMode: 'autoMapInputData', matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),

  codeNode('Build Skipped Row', [2880, 780], 'build-skipped-row.js'),

  node('Log Skipped', 'n8n-nodes-base.googleSheets', 4.5, [3100, 780], {
    operation: 'append',
    ...GOOGLE_SHEET('Skipped'),
    columns: { mappingMode: 'autoMapInputData', matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),

  codeNode('Build Run Summary', [2220, 120], 'build-summary.js'),

  node('Email Run Summary', 'n8n-nodes-base.gmail', 2.1, [2440, 120], {
    sendTo: "={{ $('Config').first().json.notifyEmail }}",
    subject: '={{ $json.subject }}',
    message: '={{ $json.html }}',
    options: { appendAttribution: false },
  }, { disabled: true }),
];

// ---------------------------------------------------------------------------
// Documentation shown on the canvas
// ---------------------------------------------------------------------------
nodes.push(
  sticky(1, 520, 800, [-700, 60],
    '## Part 1 - Config and master resume\n\nEverything you need to change lives in the **Config** node: sheet ID, master resume Doc ID, Drive folder, your contact details, your deal-breakers, and your saved searches.\n\n`Fetch Master Resume` exports your Google Doc resume as plain text, so you edit your resume in Docs and this workflow always picks up the latest version.\n\nSee `docs/SETUP.md`.'),
  sticky(2, 520, 840, [140, 60],
    '## Part 2 - Find the jobs\n\n`Config.jobSource` picks the path.\n\n**`free` (default)** - keyless public endpoints, no account and no credit:\n- **Arbeitnow** and **RemoteOK** aggregators (broad, noisy, filtered in Part 3)\n- **Greenhouse / Lever / Ashby** company boards - narrow, high signal, and where you actually apply. Add companies in Config.\n\n**`apify`** - the LinkedIn scraper. Better coverage, but needs an Apify token and burns credit. Credential: **Header Auth**, `Authorization` = `Bearer <APIFY_TOKEN>`.\n\nBoth paths continue on error, so one dead source cannot kill the run.'),
  sticky(3, 520, 860, [1000, 60],
    '## Part 3 - Normalise, filter, de-duplicate\n\n`Normalize Jobs` flattens whatever shape the source returned into one consistent job object - it maps ~40 field names across LinkedIn, the aggregators, and the three ATS formats.\n\n`Match Search Terms` is the cheapest filter here: `titleKeywords` / `excludeKeywords` drop jobs **before** any model reads them. The aggregators return everything they have, so this is what keeps the run relevant.\n\n`Get Logged Jobs` + `Get Skipped Jobs` + `Filter New Jobs` anti-join against **both** sheet tabs, so neither a job you applied to nor one you already rejected is ever scored twice, and cap the batch at `maxJobsPerRun`.\n\n`Loop Over Jobs` runs one job at a time from here on.'),
  sticky(4, 480, 460, [2120, 900],
    '## Part 4 - AI relevance scoring\n\n**Gemini Flash on the free tier**, temperature 0.1, with a structured output schema so the score is a number you can filter on rather than prose.\n\n`Throttle` paces the loop at `throttleSeconds` (default 10s) to stay under the free tier per-minute limit.\n\nTo pay for better output instead, replace this node with an **OpenAI Chat Model** - nothing else changes.\n\nPrompt: `src/prompts/relevance-system.md`.'),
  sticky(5, 220, 420, [2600, 900],
    '## Part 5 - Filter\n\nKeeps jobs scoring at or above `relevanceThreshold` with no deal-breaker hit. Everything else is logged to the **Skipped** tab, which is how you find out your threshold or your search queries need tuning.'),
  sticky(6, 440, 420, [2840, 60],
    '## Part 6 - Write the resume\n\nA brand-new resume per job, in HTML, from your master resume only.\n\nThe system prompt forbids inventing anything and restricts the HTML to tags and CSS that survive conversion into a Google Doc.'),
  sticky(7, 440, 420, [3280, 60],
    '## Part 7 - Create the Google Doc\n\nDrive only converts an upload into a native Google Doc when the metadata declares `application/vnd.google-apps.document`, which needs a `multipart/related` body - so `Build Drive Upload` assembles it and the HTTP node sends it raw.\n\nResult: a real, editable Doc per application.'),
  sticky(8, 440, 420, [3720, 60],
    '## Part 8 - Log it\n\nAppends one row per application to the **Applications** tab, including the score, the reasoning, the resume Doc link, and the posting URL.\n\nThat sheet is also the dedupe source for Part 3.\n\nEnable `Email Run Summary` for a digest at the end of each run.'),
);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const main = (...targets) => [targets.map((name) => ({ node: name, type: 'main', index: 0 }))];

const connections = {
  'Run Every Weekday Morning': { main: main('Config') },
  'Run Manually': { main: main('Config') },
  Config: { main: main('Fetch Master Resume') },
  'Fetch Master Resume': { main: main('Expand Searches') },
  'Expand Searches': { main: main('Route Job Source') },

  // Output 0 is the free path, output 1 is the paid Apify path. Both converge
  // on Normalize Jobs; only the selected branch produces data.
  'Route Job Source': {
    main: [
      [{ node: 'Build Free Requests', type: 'main', index: 0 }],
      [{ node: 'Scrape LinkedIn Jobs', type: 'main', index: 0 }],
    ],
  },
  'Build Free Requests': { main: main('Fetch Free Job Boards') },
  'Fetch Free Job Boards': { main: main('Normalize Jobs') },
  'Scrape LinkedIn Jobs': { main: main('Normalize Jobs') },
  'Normalize Jobs': { main: main('Match Search Terms') },
  'Match Search Terms': { main: main('Get Logged Jobs') },
  'Get Logged Jobs': { main: main('Get Skipped Jobs') },
  'Get Skipped Jobs': { main: main('Filter New Jobs') },
  'Filter New Jobs': { main: main('Loop Over Jobs') },

  // Output 0 is the "done" branch, output 1 is the per-batch branch.
  'Loop Over Jobs': {
    main: [
      [{ node: 'Build Run Summary', type: 'main', index: 0 }],
      [{ node: 'Throttle', type: 'main', index: 0 }],
    ],
  },
  Throttle: { main: main('Score Job Relevance') },

  'Scoring Model': { ai_languageModel: [[{ node: 'Score Job Relevance', type: 'ai_languageModel', index: 0 }]] },
  'Relevance Schema': { ai_outputParser: [[{ node: 'Score Job Relevance', type: 'ai_outputParser', index: 0 }]] },
  'Score Job Relevance': { main: main('Merge Score') },
  'Merge Score': { main: main('Worth Applying?') },

  'Worth Applying?': {
    main: [
      [{ node: 'Write Tailored Resume', type: 'main', index: 0 }],
      [{ node: 'Build Skipped Row', type: 'main', index: 0 }],
    ],
  },

  'Resume Model': { ai_languageModel: [[{ node: 'Write Tailored Resume', type: 'ai_languageModel', index: 0 }]] },
  'Write Tailored Resume': { main: main('Clean Resume HTML') },
  'Clean Resume HTML': { main: main('Build Drive Upload') },
  'Build Drive Upload': { main: main('Create Google Doc') },
  'Create Google Doc': { main: main('Build Log Row') },
  'Build Log Row': { main: main('Log Application') },

  // Both branches feed back into the loop; the loop's done output replays them.
  'Log Application': { main: main('Loop Over Jobs') },
  'Build Skipped Row': { main: main('Log Skipped') },
  'Log Skipped': { main: main('Loop Over Jobs') },

  'Build Run Summary': { main: main('Email Run Summary') },
};

const workflow = {
  name: 'AI Job Application Automation',
  active: false,
  nodes,
  connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
  pinData: {},
  tags: [],
};

const outPath = join(root, 'workflows/job-application-automation.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(workflow, null, 2)}\n`);

const counts = nodes.reduce((acc, n) => {
  const kind = n.type === 'n8n-nodes-base.stickyNote' ? 'sticky notes' : 'nodes';
  acc[kind] = (acc[kind] || 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${outPath}`);
console.log(`  ${counts.nodes} nodes, ${counts['sticky notes']} sticky notes, ${Object.keys(connections).length} wired sources`);
