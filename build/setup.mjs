#!/usr/bin/env node
// Creates the Google resources this workflow needs, then writes their IDs into
// the workflow's Config node. Replaces steps 3, 4 and 5 of docs/SETUP.md - in
// particular it removes the "headers must match exactly" failure mode, which is
// the easiest thing to get wrong by hand.
//
// It cannot create your credentials for you; it needs one that already exists.
//
//   # see exactly what it would do, no credentials needed:
//   npm run setup -- --dry-run
//
//   # with an OAuth access token (gcloud, or the OAuth playground):
//   GOOGLE_ACCESS_TOKEN=ya29.... npm run setup
//
//   # with a service account key (share the results with yourself):
//   GOOGLE_SERVICE_ACCOUNT_JSON=./sa.json SHARE_WITH_EMAIL=you@example.com npm run setup
import { readFileSync, writeFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABS } from './sheet-schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets';

const die = (msg) => { console.error(`\nerror: ${msg}\n`); process.exit(1); };

// --- auth -------------------------------------------------------------------
const serviceAccountToken = async (keyPath) => {
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  if (!key.client_email || !key.private_key) die(`${keyPath} is not a service account key`);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(key.private_key, 'base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) die(`token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { token: (await res.json()).access_token, isServiceAccount: true, email: key.client_email };
};

const getAuth = async () => {
  if (DRY) return { token: 'DRY_RUN', isServiceAccount: false };
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return serviceAccountToken(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (process.env.GOOGLE_ACCESS_TOKEN) return { token: process.env.GOOGLE_ACCESS_TOKEN, isServiceAccount: false };
  die('set GOOGLE_ACCESS_TOKEN or GOOGLE_SERVICE_ACCOUNT_JSON, or pass --dry-run');
};

// --- api --------------------------------------------------------------------
const calls = [];
const api = async (auth, method, url, body, contentType = 'application/json') => {
  calls.push({ method, url, body: contentType === 'application/json' ? body : '<raw>' });
  if (DRY) return { id: `DRY_${calls.length}`, spreadsheetId: `DRY_${calls.length}` };
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${auth.token}`, 'content-type': contentType },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  if (!res.ok) die(`${method} ${url}\n       ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
};

const share = async (auth, fileId) => {
  const email = process.env.SHARE_WITH_EMAIL;
  if (!auth.isServiceAccount || !email) return;
  // Files a service account creates live in ITS Drive; without this you cannot
  // see them at all.
  await api(auth, 'POST',
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false`,
    { role: 'writer', type: 'user', emailAddress: email });
};

// --- steps ------------------------------------------------------------------
const main = async () => {
  const auth = await getAuth();
  console.log(`\n${DRY ? '[DRY RUN] no requests will be sent' : `authenticated${auth.email ? ` as ${auth.email}` : ''}`}\n`);

  console.log('1/4  Drive folder for the generated resumes');
  const folder = await api(auth, 'POST', 'https://www.googleapis.com/drive/v3/files?fields=id',
    { name: 'Job Applications - Tailored Resumes', mimeType: 'application/vnd.google-apps.folder' });
  await share(auth, folder.id);
  console.log(`     -> ${folder.id}`);

  console.log('2/4  Spreadsheet with the Applications and Skipped tabs');
  const sheet = await api(auth, 'POST', 'https://sheets.googleapis.com/v4/spreadsheets',
    {
      properties: { title: 'Job Application Tracker' },
      sheets: TABS.map((t, i) => ({
        properties: { title: t.title, sheetId: i, gridProperties: { frozenRowCount: 1 } },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{ values: t.headers.map((h) => ({
            userEnteredValue: { stringValue: h },
            userEnteredFormat: { textFormat: { bold: true } },
          })) }],
        }],
      })),
    });
  await share(auth, sheet.spreadsheetId);
  console.log(`     -> ${sheet.spreadsheetId}  (${TABS.map((t) => `${t.title}: ${t.headers.length} cols`).join(', ')})`);

  console.log('3/4  Master resume Google Doc, seeded from the example');
  const example = readFileSync(join(root, 'assets/master-resume.example.md'), 'utf8');
  const seed = example.slice(example.indexOf('```') + 3, example.lastIndexOf('```')).trim();
  const boundary = `setup_${Date.now().toString(36)}`;
  const multipart = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
    JSON.stringify({ name: 'Master Resume (edit me)', mimeType: 'application/vnd.google-apps.document' }),
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '',
    `REPLACE EVERYTHING BELOW WITH YOUR REAL RESUME.\nThe AI may only use what is in this document and is forbidden from inventing anything outside it.\n\n${seed}`,
    `--${boundary}--`, '',
  ].join('\r\n');
  const doc = await api(auth, 'POST',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    multipart, `multipart/related; boundary=${boundary}`);
  await share(auth, doc.id);
  console.log(`     -> ${doc.id}`);

  console.log('4/4  Writing the IDs into the workflow Config node');
  const wfPath = join(root, 'workflows/job-application-automation.json');
  const wf = JSON.parse(readFileSync(wfPath, 'utf8'));
  const config = wf.nodes.find((n) => n.name === 'Config');
  const ids = { googleSheetId: sheet.spreadsheetId, masterResumeDocId: doc.id, driveFolderId: folder.id };
  for (const a of config.parameters.assignments.assignments) {
    if (a.name in ids) { a.value = ids[a.name]; console.log(`     ${a.name} = ${a.value}`); }
  }
  if (!DRY) writeFileSync(wfPath, `${JSON.stringify(wf, null, 2)}\n`);

  if (DRY) {
    console.log(`\n--- ${calls.length} API calls that would be sent ---`);
    for (const c of calls) console.log(`  ${c.method} ${c.url.replace('https://', '')}`);
  }

  console.log(`\nDone.${DRY ? ' (dry run - nothing created, workflow not modified)' : ''}

Still yours to do, because they need your Google login:
  - Create the n8n credentials (Drive OAuth2, Sheets OAuth2, Gemini) - docs/SETUP.md step 6
  - Paste your REAL resume into the master resume Doc
  - Fill in your contact details and dealBreakers in the Config node
  - Import ${DRY ? 'workflows/job-application-automation.json' : 'the updated workflow JSON'} into n8n and run the step 8 test
`);
};

main();
