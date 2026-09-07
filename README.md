# AI Job Application Automation (n8n)

An n8n workflow that finds job postings, decides which ones are actually worth
your time, and writes a brand-new tailored resume for each one as a real Google
Doc — logging the whole thing to a spreadsheet you can work from.

Built from **["I Built an AI System That Automates My Job Applications"](https://www.youtube.com/watch?v=lq8OaM-SeJo)**
by Michele Torti, following the same eight-part structure.

```
LinkedIn (via Apify)  ─►  GPT-4o relevance score  ─►  GPT-4o resume writer
                                   │                          │
                              below threshold            HTML ─► Google Doc
                                   │                          │
                             Skipped tab              Applications tab
```

## What it does

1. **Scrapes LinkedIn** for every saved search you define, via an Apify actor.
2. **Normalises** whatever shape the actor returned into one consistent job object.
3. **De-duplicates** against your spreadsheet so a posting is never scored twice,
   and caps the batch so a broad search cannot run away with your API spend.
4. **Scores each job 0–100** with GPT-4o against your real resume and your real
   deal-breakers, returning a structured verdict rather than prose.
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

Also worth knowing: automated scraping of LinkedIn is against LinkedIn's terms
of service, which is a decision you are making when you run this.

## Quick start

```bash
git clone https://github.com/NitishDwi07/n8n-Job-apply-automation.git
cd n8n-Job-apply-automation

# optional: self-host n8n
cp .env.example .env      # set N8N_ENCRYPTION_KEY and a basic-auth password
docker compose up -d      # http://localhost:5678
```

Then in n8n: **Import from File** → `workflows/job-application-automation.json`.

Full walkthrough — Google Cloud OAuth, the Apify token, the sheet headers, and
the test run — is in **[docs/SETUP.md](docs/SETUP.md)**.

You will need:

| Service | Why | Cost |
| --- | --- | --- |
| n8n | Runs the workflow | Free self-hosted |
| Apify | LinkedIn job scraping | Free $5/month credit covers this volume |
| OpenAI | Scoring + resume writing | ~$17/month at 550 jobs, ~$7 with a cheaper screener |
| Google (Drive, Docs, Sheets) | Master resume, generated docs, database | Free |

Cost breakdown and the five levers that reduce it: **[docs/COSTS.md](docs/COSTS.md)**.

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

Every key on a search is forwarded to the Apify actor untouched, so switching
to a different scraper is a config change rather than a rewrite.

The highest-leverage field by a wide margin is `dealBreakers`. Be specific and
honest — it is what stops the workflow spending money writing resumes for jobs
you would never accept.

## Repository layout

| Path | |
| --- | --- |
| `workflows/job-application-automation.json` | The importable workflow. **This is the deliverable.** |
| `src/code/*.js` | Code node sources, as real reviewable JavaScript |
| `src/prompts/*.md` | The two AI prompts — edit these to change behaviour |
| `src/schemas/` | The screener's structured output shape |
| `build/` | Assembles the workflow JSON; validates it; tests the Code nodes |
| `docs/` | Setup, sheet schema, architecture, costs |
| `assets/master-resume.example.md` | What a good master resume looks like |

The workflow JSON is generated from `src/`. To change a prompt or a Code node,
edit the file, rebuild, re-import:

```bash
npm run build   # regenerate workflows/job-application-automation.json
npm test        # build + 17 Code node tests + structural validation
```

`npm test` runs each Code node outside n8n against fixtures — including three
different Apify actor output shapes, an empty first-run sheet, a malformed model
response, and the `multipart/related` body that makes Drive produce a Doc rather
than an HTML attachment. The validator then checks the built workflow for
dangling connections, unreachable nodes, unattached AI sub-nodes, and
`$('Node')` expressions pointing at nodes that do not exist.

Design decisions and why the Google Doc step is a raw HTTP node:
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Tuning

The `Skipped` tab is the feedback loop. After a few runs:

- Good jobs being skipped → lower `relevanceThreshold` or soften `dealBreakers`
- Junk clearing the bar → raise the threshold or sharpen `mustHaves`
- Same irrelevant companies every run → tighten `searchQueries`
- Resumes reading generically → edit `src/prompts/resume-system.md`, rebuild

## Credits

Original build and walkthrough: [Michele Torti](https://www.youtube.com/watch?v=lq8OaM-SeJo).

## License

MIT
