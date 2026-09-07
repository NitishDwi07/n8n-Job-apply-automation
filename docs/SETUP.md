# Setup

About 30 minutes end to end. Nothing here needs a paid n8n plan.

---

## 1. Get n8n running

Either n8n Cloud, or self-host with the bundled compose file:

```bash
cp .env.example .env
# edit .env: set N8N_ENCRYPTION_KEY and N8N_BASIC_AUTH_PASSWORD
docker compose up -d
open http://localhost:5678
```

## 2. Import the workflow

n8n → **Workflows** → **Import from File** → `workflows/job-application-automation.json`.

You should see eight labelled sections on the canvas matching the eight parts of the build.

---

## 3. Master resume (Google Docs)

1. Create a Google Doc with your full, unabridged resume — every role, every
   bullet, every number, every tool. This is the source of truth the AI is
   allowed to draw from and **not exceed**. Longer is better here; the AI cuts
   it down per job. See `assets/master-resume.example.md` for the shape.
2. Copy the Doc ID from its URL:
   `docs.google.com/document/d/`**`THIS_PART`**`/edit`

## 4. Google Sheets database

1. Create a new spreadsheet.
2. Create two tabs named exactly `Applications` and `Skipped`, with the header
   rows given in [`GOOGLE_SHEETS.md`](GOOGLE_SHEETS.md). **The headers must match
   exactly** — the Sheets nodes auto-map by column name.
3. Copy the spreadsheet ID from its URL.

## 5. Drive folder for the generated resumes

Create a folder in Drive, open it, copy the ID from the URL
(`drive.google.com/drive/folders/`**`THIS_PART`**). Optional — leave the
placeholder and the Docs land in your Drive root.

---

## 6. Credentials

Three credentials, created in n8n under **Credentials → New**.

### Google (one credential, used by three nodes)

Create a **Google Drive OAuth2 API** credential.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Sheets API**.
3. **OAuth consent screen**: External, add yourself as a test user.
4. **Credentials → Create Credentials → OAuth client ID → Web application**.
   Add the redirect URI that n8n shows you on the credential screen.
5. Paste the client ID and secret into n8n and click **Sign in with Google**.

Scopes needed: `drive` and `spreadsheets`. Assign this credential to:

| Node | Credential type |
| --- | --- |
| `Fetch Master Resume` | Google Drive OAuth2 (predefined, already selected) |
| `Create Google Doc` | Google Drive OAuth2 (predefined, already selected) |
| `Get Logged Jobs`, `Log Application`, `Log Skipped` | Google Sheets OAuth2 |

> The two Sheets nodes need a **Google Sheets OAuth2** credential. You can
> reuse the same Cloud project and OAuth client — just create the second
> credential type in n8n and sign in again.

### Apify

1. Sign up at [apify.com](https://apify.com) (free tier includes $5/month of credit).
2. **Settings → API & Integrations** → copy your personal API token.
3. In n8n create a **Header Auth** credential:
   - Name: `Authorization`
   - Value: `Bearer apify_api_your_token_here`
4. Assign it to the `Scrape LinkedIn Jobs` node.

### OpenAI

1. Create a key at [platform.openai.com](https://platform.openai.com/api-keys).
2. In n8n create an **OpenAI** credential with that key.
3. Assign it to both `Scoring Model` and `Resume Model`.

---

## 7. Fill in the Config node

Open the **Config** node. Everything you ever need to change is here.

| Field | What to put |
| --- | --- |
| `googleSheetId` | From step 4 |
| `masterResumeDocId` | From step 3 |
| `driveFolderId` | From step 5, or leave the placeholder |
| `apifyActorId` | `bebity~linkedin-jobs-scraper`, or any actor you prefer (see below) |
| `maxJobsPerRun` | Hard cap on jobs scored per run. Start at **5** while testing. |
| `relevanceThreshold` | Minimum score to earn a tailored resume. Start at **70**. |
| `candidateName` … `candidateLocation` | Your contact line, used verbatim in the resume header |
| `desiredRoles` | Roles you actually want |
| `mustHaves` | Non-negotiables the screener should reward |
| `dealBreakers` | Non-negotiables that cap a score at 20 — be specific and honest here, this is the single highest-leverage field |
| `minSalary` | Your floor, as free text |
| `notifyEmail` | Where the run summary goes |
| `searchQueries` | One object per saved search |

`searchQueries` is a plain array of objects, and **every key is forwarded to the
Apify actor untouched**:

```js
[
  { title: 'Senior Backend Engineer', location: 'Germany',       rows: 50, publishedAt: 'r604800' },
  { title: 'Platform Engineer',       location: 'European Union', rows: 50, publishedAt: 'r86400', workType: 'remote' }
]
```

`publishedAt` uses LinkedIn's own codes: `r86400` = past 24h, `r604800` = past
week, `r2592000` = past month.

---

## 8. Test it

1. Set `maxJobsPerRun` to **2** and `relevanceThreshold` to **0** — this forces
   both branches to run so you exercise the whole graph.
2. Click **Execute Workflow** (the `Run Manually` trigger).
3. Walk the nodes left to right and check:
   - `Scrape LinkedIn Jobs` returned items (if it returned an error item, the
     node is set to continue — read the error in its output)
   - `Normalize Jobs` produced clean `title` / `company` / `url` / `description`
   - `Create Google Doc` returned an `id`
   - Open the Doc: it should be a real, editable, formatted Google Doc
   - A row landed in `Applications`
4. Set `relevanceThreshold` back to `70`, raise `maxJobsPerRun`, and activate
   the workflow. The schedule trigger is set to **07:00 Mon–Fri**.
5. Optionally enable the `Email Run Summary` node (it ships disabled) and give
   it a Gmail credential.

## 9. Tune it

Read the `Skipped` tab after a few runs. That tab is the feedback loop:

- Good jobs being skipped → lower `relevanceThreshold`, or soften `dealBreakers`.
- Junk clearing the bar → raise the threshold, or sharpen `mustHaves`.
- The same irrelevant company every run → tighten `searchQueries`.
- Resumes reading generically → edit `src/prompts/resume-system.md`, run
  `npm run build`, re-import.

---

## Swapping the Apify actor

Nothing outside the Config node assumes a particular actor. To swap:

1. Change `apifyActorId` (the `username~actor-name` form from the actor's page).
2. Change the keys in `searchQueries` to whatever that actor's input expects.
3. Run once and check `Normalize Jobs`. It already maps ~30 common field names
   (`jobUrl`/`link`/`url`, `companyName`/`company.name`, `descriptionText`/
   `descriptionHtml`, …). If a field comes through blank, add its name to the
   relevant `pick([...])` list in `src/code/normalize-jobs.js`, then
   `npm run build`.
