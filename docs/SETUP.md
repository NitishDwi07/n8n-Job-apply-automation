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

## Shortcut: let the script create steps 3-5

Steps 3, 4 and 5 are mechanical, and step 4 has the one failure mode that is
easy to get wrong by hand (header names must match exactly). If you already
have a Google credential, one command does all three and writes the resulting
IDs into the Config node:

```bash
npm run setup -- --dry-run    # show exactly what it would do, no credentials needed

# then, with either kind of credential:
GOOGLE_ACCESS_TOKEN=ya29....  npm run setup
GOOGLE_SERVICE_ACCOUNT_JSON=./sa.json SHARE_WITH_EMAIL=you@example.com npm run setup
```

It creates the Drive folder, the spreadsheet with both tabs and correct bold
frozen headers, and a master resume Doc seeded from the example - then patches
`googleSheetId`, `masterResumeDocId` and `driveFolderId` into the workflow JSON.

It cannot create the credentials themselves; that is step 6, and it needs your
Google login. If you would rather click through it, steps 3-5 below do the same
thing by hand.

> Untested against a live Google account - it was written and verified in
> `--dry-run` only. Run the dry run first, and if a call fails it prints the
> status and body rather than half-finishing.

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

### Google Gemini (free)

The only AI credential you need, and it costs nothing.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
   click **Create API key**. No card required.
2. In n8n create a **Google Gemini(PaLM) API** credential and paste the key.
3. Assign it to both `Scoring Model` and `Resume Model`.

**On the model name.** Both nodes use `models/gemini-flash-latest`, a floating
alias, on purpose: a pinned version that Google retires makes the workflow fail
on import with "model not found". Check what your key actually offers with

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY&pageSize=100" \
  | grep -o '"name": "models/[^"]*"'
```

Pin a specific version if you would rather have stable scoring over time. If
you hit repeated `503 UNAVAILABLE`, the alias is pointing at a busy model —
pin a quieter one. Both AI nodes retry four times with 8s backoff.

**Do not lower `maxOutputTokens`.** Gemini 3.x Flash spends output budget on
reasoning tokens before emitting anything — measured at 550–740 thinking
tokens on the screening prompt alone. The 700-token cap this workflow shipped
with left 63 tokens for the answer and truncated the JSON. The budgets are now
3000 (scoring) and 8000 (resume) to cover thinking plus the result.

> Free-tier Gemini usage may be used to improve Google's models, and this
> workflow sends your full resume on every call. See
> [COSTS.md](COSTS.md#the-privacy-trade) for the trade and the paid alternatives.

### Job sources (no credential needed)

The default `jobSource: 'free'` uses keyless public endpoints — Arbeitnow,
RemoteOK, and the public Greenhouse / Lever / Ashby board APIs. Nothing to set up.

### Apify — optional, only for `jobSource: 'apify'`

LinkedIn coverage is better, but check the actor's pricing first (some are
rented monthly, some charge per result).

1. Sign up at [apify.com](https://apify.com) — free tier includes $5/month credit.
2. **Settings → API & Integrations** → copy your token.
3. In n8n create a **Header Auth** credential:
   - Name: `Authorization`
   - Value: `Bearer apify_api_your_token_here`
4. Assign it to the `Scrape LinkedIn Jobs` node.

---

## 7. Fill in the Config node

Open the **Config** node. Everything you ever need to change is here.

| Field | What to put |
| --- | --- |
| `googleSheetId` | From step 4 |
| `masterResumeDocId` | From step 3 |
| `driveFolderId` | From step 5, or leave the placeholder |
| `jobSource` | `free` (keyless public boards) or `apify` (LinkedIn, needs a token) |
| `useAggregators` | `true` to include Arbeitnow + RemoteOK on the free path |
| `greenhouseCompanies` | Board slugs, e.g. `['stripe', 'figma']` — see below |
| `leverCompanies` | Board slugs, e.g. `['netflix']` |
| `ashbyCompanies` | Board slugs |
| `titleKeywords` | Keep only titles containing one of these. Empty = keep all. |
| `excludeKeywords` | Always drop titles containing one of these |
| `throttleSeconds` | Pause between jobs, keeps you under the Gemini free-tier rate limit |
| `apifyActorId` | Only used when `jobSource` is `apify` |
| `maxJobsPerRun` | Hard cap on jobs scored per run. Start at **5** while testing. |
| `relevanceThreshold` | Minimum score to earn a tailored resume. Start at **70**. |
| `candidateName` … `candidateLocation` | Your contact line, used verbatim in the resume header |
| `desiredRoles` | Roles you actually want |
| `mustHaves` | Non-negotiables the screener should reward |
| `dealBreakers` | Non-negotiables that cap a score at 20 — be specific and honest here, this is the single highest-leverage field |
| `minSalary` | Your floor, as free text |
| `notifyEmail` | Where the run summary goes |
| `searchQueries` | **Apify path only.** Leave the default when `jobSource` is `free`. |

> **Which fields actually find your jobs?** It depends on `jobSource`:
> - **`free` (default)** — `greenhouseCompanies` / `leverCompanies` /
>   `ashbyCompanies` / `useAggregators` choose the sources, and
>   `titleKeywords` / `excludeKeywords` do the filtering. `searchQueries` is
>   **not used** — but leave at least one entry in it, because `Expand
>   Searches` fails on an empty list.
> - **`apify`** — `searchQueries` is the search, and `titleKeywords` still
>   filters what comes back.

`searchQueries` is a plain array of objects, and on the Apify path **every key
is forwarded to the actor untouched**:

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

1. Set `maxJobsPerRun` to **2**, `relevanceThreshold` to **0**, and
   `throttleSeconds` to **2** — this forces both branches to run so you
   exercise the whole graph, without waiting.
2. Click **Execute Workflow** (the `Run Manually` trigger).
3. Walk the nodes left to right and check:
   - `Fetch Free Job Boards` returned items for each source. Both fetch nodes
     are set to continue on error, so a dead source shows up as an error item
     in the output rather than a failed run — read it there. **These are
     third-party endpoints that can change or rate-limit; if one returns
     nothing, drop it from `Build Free Requests` and lean on company boards.**
   - `Match Search Terms` kept a sensible number. Everything dropped, or
     nothing dropped, means your keywords need work.
   - `Normalize Jobs` produced clean `title` / `company` / `url` / `description`
   - `Create Google Doc` returned an `id`
   - Open the Doc: it should be a real, editable, formatted Google Doc
   - A row landed in `Applications`
4. Set `relevanceThreshold` back to `70`, `throttleSeconds` back to `10`,
   raise `maxJobsPerRun`, and activate the workflow. The schedule trigger is set to **07:00 Mon–Fri**.
5. Optionally enable the `Email Run Summary` node (it ships disabled) and give
   it a Gmail credential.

## 9. Tune it

Read the `Skipped` tab after a few runs. That tab is the feedback loop:

- Good jobs being skipped → lower `relevanceThreshold`, or soften `dealBreakers`.
- Junk clearing the bar → raise the threshold, or sharpen `mustHaves`.
- The same irrelevant company every run → drop it from the company lists, or
  add a word to `excludeKeywords`. (On the Apify path, tighten `searchQueries`.)
- Resumes reading generically → edit `src/prompts/resume-system.md`, run
  `npm run build`, re-import.
- Hitting a Gemini rate limit → raise `throttleSeconds` or lower
  `maxJobsPerRun`.
- Aggregator noise swamping the run → set `useAggregators: false` and grow the
  company board lists instead.

## Finding company board slugs

The free path's best source is companies' own ATS boards — public JSON, no key,
and the postings are first-hand rather than scraped. Find the slug in the
careers page URL:

| ATS | Careers URL | Slug | Check it |
| --- | --- | --- | --- |
| Greenhouse | `boards.greenhouse.io/`**`stripe`** | `stripe` | `boards-api.greenhouse.io/v1/boards/stripe/jobs` |
| Lever | `jobs.lever.co/`**`netflix`** | `netflix` | `api.lever.co/v0/postings/netflix?mode=json` |
| Ashby | `jobs.ashbyhq.com/`**`ramp`** | `ramp` | `api.ashbyhq.com/posting-api/job-board/ramp` |

Open the check URL in a browser. JSON back means the slug is right; a 404 means
either the wrong slug or the company uses a different ATS.

This is the highest-signal, lowest-noise source available, and it costs nothing.
Twenty companies you actually want beats a thousand aggregator postings.

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
