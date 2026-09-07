# AI Job Application Automation (n8n)

An n8n workflow that finds job postings, decides which ones are actually worth
your time, and writes a brand-new tailored resume for each one as a real Google
Doc — logging the whole thing to a spreadsheet you can work from.

Built from **["I Built an AI System That Automates My Job Applications"](https://www.youtube.com/watch?v=lq8OaM-SeJo)**
by Michele Torti, following the same eight-part structure.

```
Public job boards  ─►  keyword gate  ─►  AI relevance score  ─►  AI resume writer
(no API key)                                     │                       │
                                            below threshold        HTML ─► Google Doc
                                                 │                       │
                                           Skipped tab            Applications tab
```

**Runs on free tiers end to end** — no card, no Apify token, no OpenAI key.
See [Cost](#cost).

## What it does

1. **Finds jobs** from keyless public sources — the Arbeitnow and RemoteOK
   aggregators, plus any company's public Greenhouse / Lever / Ashby board.
   Flip one config field to use LinkedIn via Apify instead.
2. **Normalises** whatever shape the source returned into one consistent job
   object — ~40 field names across five different formats.
3. **Filters on keywords, then de-duplicates** against your spreadsheet, so a
   posting is never scored twice and irrelevant titles never reach a model at all.
4. **Scores each job 0–100** with Gemini Flash against your real resume and your
   real deal-breakers, returning a structured verdict rather than prose.
5. **Filters** — only jobs clearing your threshold with no deal-breaker hit get
   a resume. Everything else is logged with the reason it was rejected.
6. **Writes a new resume per job** in HTML, from your master resume only, with a
   prompt that forbids inventing anything you have not actually done.
7. **Creates a native Google Doc** per application — editable, formatted, ready
   to export as a PDF.
8. **Logs everything** to Google Sheets, then emails you a run summary.

The result is a spreadsheet each morning: a handful of genuinely relevant
postings, each with a score, the reasoning, the gaps to be aware of, and a
tailored resume already written.

## What it does not do

It does not press *Submit* for you, and that is deliberate. It gets you to the
point where applying is a two-minute review-and-send instead of an hour of
rewriting. Read the `Gaps` column before you send anything, and read the resume
— it is generated text with your name on it.

Also worth knowing: the default free sources are public, documented APIs, so
there is nothing untoward about using them. The **optional** Apify path scrapes
LinkedIn, which is against LinkedIn's terms of service — that one is a decision
you are making when you switch `jobSource` to `apify`.

## Quick start

```bash
git clone https://github.com/NitishDwi07/n8n-Job-apply-automation.git
cd n8n-Job-apply-automation

# optional: self-host n8n
cp .env.example .env      # set N8N_ENCRYPTION_KEY and a basic-auth password
docker compose up -d      # http://localhost:5678
```

Then in n8n: **Import from File** → `workflows/job-application-automation.json`.

Then create your credentials (Google OAuth + a free Gemini key), and let the
setup script build the Google side for you:

```bash
npm run setup -- --dry-run   # see what it would create
npm run setup                # creates folder + sheet + resume doc, writes the IDs into Config
```

Full walkthrough — Google Cloud OAuth, the sheet headers, and the test run — is
in **[docs/SETUP.md](docs/SETUP.md)**.

You will need:

<a id="cost"></a>

| Service | Why | Cost |
| --- | --- | --- |
| n8n | Runs the workflow | Free, self-hosted |
| Google Gemini | Scoring + resume writing | Free tier (`gemini-2.0-flash`) |
| Job sources | Arbeitnow, RemoteOK, Greenhouse/Lever/Ashby | Free, no API key |
| Google Drive/Docs/Sheets | Master resume, generated docs, database | Free |
| *Apify (optional)* | *LinkedIn coverage* | *Free $5/mo credit; check actor pricing* |

Two things to know about running free:

- Gemini's free tier is **rate-limited**, so `throttleSeconds` (default 10s)
  paces the loop. 25 jobs takes about five minutes.
- Free-tier usage **may be used to improve Google's models**, and this workflow
  sends your full resume on every call. If that's not acceptable, swapping the
  two model nodes for OpenAI costs roughly $6–17/month —
  [the trade and the numbers](docs/COSTS.md#the-privacy-trade).

Full breakdown: **[docs/COSTS.md](docs/COSTS.md)**.

## Configuration

Everything you ever need to change lives in the **Config** node — sheet ID,
master resume Doc ID, Drive folder, your contact line, your must-haves, your
deal-breakers, your spend cap, your threshold, and your saved searches:

```js
searchQueries = [
  { title: 'Senior Backend Engineer', location: 'Germany',        rows: 50, publishedAt: 'r604800' },
  { title: 'Platform Engineer',       location: 'European Union',  rows: 50, publishedAt: 'r86400' }
]
```

On the free path, the highest-signal source is companies' own ATS boards —
first-hand postings, public JSON, no key:

```js
greenhouseCompanies = ['stripe', 'figma']   // boards.greenhouse.io/stripe
leverCompanies      = ['netflix']           // jobs.lever.co/netflix
titleKeywords       = ['backend', 'platform', 'data engineer']
excludeKeywords     = ['intern', 'sales', 'director']
```

On this path `searchQueries` is unused — it is the Apify path's input. These
four fields are what find and filter your jobs.

Twenty companies you actually want beats a thousand aggregator postings. Slug
lookup table is in [docs/SETUP.md](docs/SETUP.md#finding-company-board-slugs).

Two fields carry most of the leverage. `dealBreakers` is what stops the workflow
writing resumes for jobs you would never accept. `titleKeywords` /
`excludeKeywords` run *before* any model call, so everything they drop is free —
tune these before anything else.

## Repository layout

| Path | |
| --- | --- |
| `workflows/job-application-automation.json` | The importable workflow. **This is the deliverable.** |
| `src/code/*.js` | Code node sources, as real reviewable JavaScript |
| `src/prompts/*.md` | The two AI prompts — edit these to change behaviour |
| `src/schemas/` | The screener's structured output shape |
| `build/` | Assembles the workflow JSON; validates it; tests the Code nodes; `setup.mjs` creates the Google resources |
| `docs/` | Setup, sheet schema, architecture, costs |
| `assets/master-resume.example.md` | What a good master resume looks like |

The workflow JSON is generated from `src/`. To change a prompt or a Code node,
edit the file, rebuild, re-import:

```bash
npm run build   # regenerate workflows/job-application-automation.json
npm test        # build + 25 Code node tests + structural validation
npm run e2e     # drive the whole pipeline end to end, without n8n
```

`npm run e2e` runs the committed workflow outside n8n — real Code nodes, real
prompts, real expressions, with only the outbound calls substituted. It parses
the Drive upload body the way Drive does and writes the generated resumes to
`build/e2e-output/`. Set `GEMINI_API_KEY` to drive the real model. Details and
the re-run check are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-end-to-end-runner).

`npm test` runs each Code node outside n8n against fixtures — 25 tests covering
seven different job-source output shapes (LinkedIn actors, Arbeitnow, RemoteOK,
Greenhouse, Lever), an empty first-run sheet, a malformed model response, and
the `multipart/related` body that makes Drive produce a Doc rather than an HTML
attachment. The validator then checks the built workflow for
dangling connections, unreachable nodes, unattached AI sub-nodes, and
`$('Node')` expressions pointing at nodes that do not exist.

Design decisions and why the Google Doc step is a raw HTTP node:
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Tuning

The `Skipped` tab is the feedback loop. After a few runs:

- Good jobs being skipped → lower `relevanceThreshold` or soften `dealBreakers`
- Junk clearing the bar → raise the threshold or sharpen `mustHaves`
- Aggregator noise swamping the run → set `useAggregators: false` and grow the
  company board lists instead
- Resumes reading generically → edit `src/prompts/resume-system.md`, rebuild
- Gemini rate-limit errors → raise `throttleSeconds` or lower `maxJobsPerRun`

## Credits

Original build and walkthrough: [Michele Torti](https://www.youtube.com/watch?v=lq8OaM-SeJo).

## License

MIT
