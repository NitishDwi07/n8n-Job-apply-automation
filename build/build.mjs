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
        { id: 'c04', name: 'apifyActorId', type: 'string', value: 'bebity~linkedin-jobs-scraper' },
        { id: 'c05', name: 'maxJobsPerRun', type: 'number', value: 25 },
        { id: 'c06', name: 'relevanceThreshold', type: 'number', value: 70 },
        { id: 'c07', name: 'candidateName', type: 'string', value: 'Your Name' },
        { id: 'c08', name: 'candidateEmail', type: 'string', value: 'you@example.com' },
        { id: 'c09', name: 'candidatePhone', type: 'string', value: '+1 555 0100' },
        { id: 'c10', name: 'candidateLinkedIn', type: 'string', value: 'linkedin.com/in/your-handle' },
        { id: 'c11', name: 'candidateLocation', type: 'string', value: 'Berlin, Germany - open to remote in EU, no relocation' },
        { id: 'c12', name: 'desiredRoles', type: 'string', value: 'Senior Backend Engineer, Platform Engineer, Data Engineer' },
        { id: 'c13', name: 'mustHaves', type: 'string', value: 'Python or Go, cloud infrastructure ownership, remote-friendly' },
        { id: 'c14', name: 'dealBreakers', type: 'string', value: 'On-site five days a week, unpaid internship, commission-only pay, security clearance required' },
        { id: 'c15', name: 'minSalary', type: 'string', value: '80000 EUR base' },
        { id: 'c16', name: 'notifyEmail', type: 'string', value: 'you@example.com' },
        {
          id: 'c17',
          name: 'searchQueries',
          type: 'array',
          value:
            '={{ [\n' +
            "  { title: 'Senior Backend Engineer', location: 'Germany', rows: 50, publishedAt: 'r604800' },\n" +
            "  { title: 'Platform Engineer', location: 'European Union', rows: 50, publishedAt: 'r604800' }\n" +
            '] }}',
        },
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

  node('Scrape LinkedIn Jobs', 'n8n-nodes-base.httpRequest', 4.2, [220, 300], {
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
  codeNode('Normalize Jobs', [440, 300], 'normalize-jobs.js'),

  node('Get Logged Jobs', 'n8n-nodes-base.googleSheets', 4.5, [660, 300], {
    ...GOOGLE_SHEET('Applications'),
    options: {},
  }, { alwaysOutputData: true, onError: 'continueRegularOutput' }),

  codeNode('Filter New Jobs', [880, 300], 'filter-new-jobs.js'),

  node('Loop Over Jobs', 'n8n-nodes-base.splitInBatches', 3, [1100, 300], {
    options: { reset: false },
  }),

  // -------------------------------------------------------------------------
  // Part 4 - AI relevance scoring
  // -------------------------------------------------------------------------
  node('Score Job Relevance', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [1340, 420], {
    promptType: 'define',
    text: `=${prompt('relevance-user.md')}`,
    hasOutputParser: true,
    messages: { messageValues: [{ message: prompt('relevance-system.md') }] },
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 4000 }),

  node('Scoring Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [1300, 640], {
    model: { __rl: true, value: 'gpt-4o', mode: 'list', cachedResultName: 'gpt-4o' },
    options: { temperature: 0.1, maxTokens: 700 },
  }),

  node('Relevance Schema', '@n8n/n8n-nodes-langchain.outputParserStructured', 1.2, [1480, 640], {
    schemaType: 'fromJson',
    jsonSchemaExample: schema('relevance.example.json'),
  }),

  codeNode('Merge Score', [1560, 420], 'merge-score.js'),

  // -------------------------------------------------------------------------
  // Part 5 - filter out the jobs that are not worth a resume
  // -------------------------------------------------------------------------
  node('Worth Applying?', 'n8n-nodes-base.if', 2.2, [1780, 420], {
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
  node('Write Tailored Resume', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [2020, 300], {
    promptType: 'define',
    text: `=${prompt('resume-user.md')}`,
    messages: { messageValues: [{ message: prompt('resume-system.md') }] },
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 4000 }),

  node('Resume Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [2020, 520], {
    model: { __rl: true, value: 'gpt-4o', mode: 'list', cachedResultName: 'gpt-4o' },
    options: { temperature: 0.4, maxTokens: 4000 },
  }),

  codeNode('Clean Resume HTML', [2240, 300], 'clean-resume-html.js'),

  // -------------------------------------------------------------------------
  // Part 7 - turn the HTML into a real Google Doc
  // -------------------------------------------------------------------------
  codeNode('Build Drive Upload', [2460, 300], 'build-drive-upload.js'),

  node('Create Google Doc', 'n8n-nodes-base.httpRequest', 4.2, [2680, 300], {
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
  codeNode('Build Log Row', [2900, 300], 'build-log-row.js'),

  node('Log Application', 'n8n-nodes-base.googleSheets', 4.5, [3120, 300], {
    operation: 'append',
    ...GOOGLE_SHEET('Applications'),
    columns: { mappingMode: 'autoMapInputData', matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),

  codeNode('Build Skipped Row', [2020, 700], 'build-skipped-row.js'),

  node('Log Skipped', 'n8n-nodes-base.googleSheets', 4.5, [2240, 700], {
    operation: 'append',
    ...GOOGLE_SHEET('Skipped'),
    columns: { mappingMode: 'autoMapInputData', matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),

  codeNode('Build Run Summary', [1340, 140], 'build-summary.js'),

  node('Email Run Summary', 'n8n-nodes-base.gmail', 2.1, [1560, 140], {
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
  sticky(1, 460, 660, [-700, 60],
    '## Part 1 - Config and master resume\n\nEverything you need to change lives in the **Config** node: sheet ID, master resume Doc ID, Drive folder, your contact details, your deal-breakers, and your saved searches.\n\n`Fetch Master Resume` exports your Google Doc resume as plain text, so you edit your resume in Docs and this workflow always picks up the latest version.\n\nSee `docs/SETUP.md`.'),
  sticky(2, 460, 420, [-20, 60],
    '## Part 2 - Scrape LinkedIn\n\nOne Apify actor run per saved search, via `run-sync-get-dataset-items`.\n\nAny keys you add to a search in Config are forwarded to the actor untouched, so swapping actors is a config change.\n\nCredential: **Header Auth**, `Authorization` = `Bearer <APIFY_TOKEN>`.\n\nSet to continue on error - one dead search will not kill the run.'),
  sticky(3, 460, 640, [420, 60],
    '## Part 3 - Normalise and de-duplicate\n\n`Normalize Jobs` flattens whatever shape the actor returned into one consistent job object.\n\n`Get Logged Jobs` + `Filter New Jobs` anti-join against the sheet so a job is never scored twice, and cap the batch at `maxJobsPerRun` so a 700-result scrape cannot blow your OpenAI budget.\n\n`Loop Over Jobs` runs one job at a time from here on.'),
  sticky(4, 420, 420, [1280, 860],
    '## Part 4 - AI relevance scoring\n\nGPT-4o at temperature 0.1 with a structured output schema, so the score is a number you can filter on rather than prose.\n\nThe prompt hard-caps scores on deal-breakers, seniority gaps, location conflicts, and salary - tune it in `src/prompts/relevance-system.md`.'),
  sticky(5, 200, 420, [1720, 860],
    '## Part 5 - Filter\n\nKeeps jobs scoring at or above `relevanceThreshold` with no deal-breaker hit. Everything else is logged to the **Skipped** tab, which is how you find out your threshold or your search queries need tuning.'),
  sticky(6, 420, 420, [1980, 60],
    '## Part 6 - Write the resume\n\nA brand-new resume per job, in HTML, from your master resume only.\n\nThe system prompt forbids inventing anything and restricts the HTML to tags and CSS that survive conversion into a Google Doc.'),
  sticky(7, 420, 420, [2420, 60],
    '## Part 7 - Create the Google Doc\n\nDrive only converts an upload into a native Google Doc when the metadata declares `application/vnd.google-apps.document`, which needs a `multipart/related` body - so `Build Drive Upload` assembles it and the HTTP node sends it raw.\n\nResult: a real, editable Doc per application.'),
  sticky(8, 420, 420, [2860, 60],
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
  'Expand Searches': { main: main('Scrape LinkedIn Jobs') },
  'Scrape LinkedIn Jobs': { main: main('Normalize Jobs') },
  'Normalize Jobs': { main: main('Get Logged Jobs') },
  'Get Logged Jobs': { main: main('Filter New Jobs') },
  'Filter New Jobs': { main: main('Loop Over Jobs') },

  // Output 0 is the "done" branch, output 1 is the per-batch branch.
  'Loop Over Jobs': {
    main: [
      [{ node: 'Build Run Summary', type: 'main', index: 0 }],
      [{ node: 'Score Job Relevance', type: 'main', index: 0 }],
    ],
  },

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
