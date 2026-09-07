# Architecture

## Flow

```
Schedule (07:00 Mon-Fri) ─┐
Manual trigger ───────────┴─► Config ─► Fetch Master Resume (Drive export as text)
                                              │
                                              ▼
                                       Expand Searches            one item per saved search
                                              │
                                              ▼
                                    Scrape LinkedIn Jobs          Apify run-sync-get-dataset-items
                                              │
                                              ▼
                                       Normalize Jobs             any actor shape -> one job shape
                                              │
                                              ▼
                                       Get Logged Jobs            read the Applications tab
                                              │
                                              ▼
                                       Filter New Jobs            anti-join + cap at maxJobsPerRun
                                              │
                                              ▼
                            ┌──────────► Loop Over Jobs ──────────► (done) Build Run Summary ─► Email
                            │                 │ (per job, batch size 1)
                            │                 ▼
                            │          Score Job Relevance        GPT-4o, temp 0.1, structured output
                            │                 │
                            │                 ▼
                            │            Merge Score              re-attach the job to the score
                            │                 │
                            │                 ▼
                            │           Worth Applying?           score >= threshold AND no deal-breaker
                            │              │        │
                            │        true  │        │  false
                            │              ▼        ▼
                            │   Write Tailored    Build Skipped Row
                            │   Resume            │
                            │   (GPT-4o, 0.4)     ▼
                            │        │          Log Skipped ──────┐
                            │        ▼                            │
                            │   Clean Resume HTML                 │
                            │        │                            │
                            │        ▼                            │
                            │   Build Drive Upload                │
                            │        │                            │
                            │        ▼                            │
                            │   Create Google Doc                 │
                            │        │                            │
                            │        ▼                            │
                            │   Build Log Row                     │
                            │        │                            │
                            │        ▼                            │
                            └─── Log Application ─────────────────┘
```

## The eight parts

| Part | Nodes | What it does |
| --- | --- | --- |
| 1 | `Config`, `Fetch Master Resume` | Single source of settings; exports your Docs resume as plain text so you edit it in Docs, not in n8n |
| 2 | `Expand Searches`, `Scrape LinkedIn Jobs` | One Apify actor run per saved search |
| 3 | `Normalize Jobs`, `Get Logged Jobs`, `Filter New Jobs`, `Loop Over Jobs` | Normalise, de-duplicate, cap, then iterate one job at a time |
| 4 | `Score Job Relevance`, `Scoring Model`, `Relevance Schema`, `Merge Score` | GPT-4o returns a structured score, not prose |
| 5 | `Worth Applying?` | Gate on score and deal-breakers |
| 6 | `Write Tailored Resume`, `Resume Model`, `Clean Resume HTML` | A brand-new resume per job, as HTML |
| 7 | `Build Drive Upload`, `Create Google Doc` | HTML converted into a native Google Doc |
| 8 | `Build Log Row`, `Log Application`, `Build Skipped Row`, `Log Skipped`, `Build Run Summary`, `Email Run Summary` | Log both outcomes, then a digest |

## Design decisions worth knowing

**Batch size 1 through the loop.** Slower than fanning out, but it means a
single bad posting fails one iteration instead of the run, and every downstream
`$('Node').first()` unambiguously refers to the current job.

**The dedupe set is the sheet, not workflow state.** `Filter New Jobs` reads
`Job URL` and `Job ID` back out of the `Applications` tab. Consequences: the
workflow is safe to re-run at any time, deleting a sheet row makes the workflow
reconsider that job, and there is no hidden state to get out of sync. `Get
Logged Jobs` is set to continue on error so the very first run works against an
empty sheet.

**Skipped jobs are logged too.** Not just for the audit trail — without it the
same rejects get re-scored (and re-paid-for) every single morning.

**`maxJobsPerRun` is a spend cap, not a preference.** A broad LinkedIn search
returns hundreds of postings. Without the cap, one run could push a few hundred
job descriptions through GPT-4o twice.

**Structured output on the screener, free text on the writer.** The screener's
result is branched on, so it goes through an output parser and comes back as a
typed object at temperature 0.1. The writer's result is prose, so it runs at
0.4 and is cleaned by code afterwards.

**Why `Create Google Doc` is a raw HTTP node, not the Drive node.** Drive v3
converts an upload into a native Google Doc only when the request's *metadata*
part declares `mimeType: application/vnd.google-apps.document`. Metadata plus
content in one request means a `multipart/related` body, which the Drive node
does not expose. `Build Drive Upload` assembles that body and the HTTP node
sends it raw with the boundary in the content type. Skip this and you get an
`.html` attachment sitting in Drive instead of a Doc.

**The Apify node continues on error.** A dead actor run, a rate limit, or a
timeout on one saved search produces an error item that `Normalize Jobs` drops,
so the other searches still complete.

**The resume prompt is a closed world.** The system prompt forbids adding any
claim not in the master resume — it may re-order, re-word, compress, and drop,
but not invent. It also restricts the HTML to tags and CSS properties that
survive conversion into a Google Doc (no flexbox, grid, or float).

## Repository layout

```
workflows/job-application-automation.json   the importable workflow (generated, committed)
build/build.mjs                             assembles that JSON from src/
build/validate.mjs                          structural checks on the built workflow
build/test-code-nodes.mjs                   runs each Code node against fixtures
src/code/*.js                               Code node sources
src/prompts/*.md                            the two AI prompts, system + user
src/schemas/relevance.example.json          the screener's output shape
docs/                                       setup, schema, architecture, costs
assets/master-resume.example.md             the shape of a good master resume
```

The workflow JSON is generated. Edit `src/`, run `npm run build`, re-import.
Editing the JSON by hand works too, but the next build overwrites it.

```bash
npm test    # build + code-node tests + structural validation
```
