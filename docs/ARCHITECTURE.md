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
                                      Route Job Source            on Config.jobSource
                                        │            │
                                 'free' │            │ 'apify'
                                        ▼            ▼
                            Build Free Requests   Scrape LinkedIn Jobs
                                        │            │
                             Fetch Free Job Boards   │
                                        │            │
                                        └──────┬─────┘
                                               ▼
                                       Normalize Jobs             any source shape -> one job shape
                                               │
                                               ▼
                                     Match Search Terms           keyword gate, before any model call
                                               │
                                               ▼
                                       Get Logged Jobs            read the Applications tab
                                               │
                                               ▼
                                       Get Skipped Jobs           read the Skipped tab too
                                              │
                                              ▼
                                       Filter New Jobs            anti-join + cap at maxJobsPerRun
                                              │
                                              ▼
                            ┌──────────► Loop Over Jobs ──────────► (done) Build Run Summary ─► Email
                            │                 │ (per job, batch size 1)
                            │                 ▼
                            │             Throttle                free-tier rate limiting
                            │                 │
                            │                 ▼
                            │          Score Job Relevance        Gemini Flash, temp 0.1, structured
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
                            │   (Gemini, 0.4)     ▼
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
| 2 | `Route Job Source`, `Build Free Requests`, `Fetch Free Job Boards`, `Scrape LinkedIn Jobs` | Keyless public boards by default; LinkedIn via Apify if you opt in |
| 3 | `Normalize Jobs`, `Match Search Terms`, `Get Logged Jobs`, `Filter New Jobs`, `Loop Over Jobs` | Normalise, keyword-filter, de-duplicate, cap, then iterate one job at a time |
| 4 | `Throttle`, `Score Job Relevance`, `Scoring Model`, `Relevance Schema`, `Merge Score` | Gemini Flash returns a structured score, not prose |
| 5 | `Worth Applying?` | Gate on score and deal-breakers |
| 6 | `Write Tailored Resume`, `Resume Model`, `Clean Resume HTML` | A brand-new resume per job, as HTML |
| 7 | `Build Drive Upload`, `Create Google Doc` | HTML converted into a native Google Doc |
| 8 | `Build Log Row`, `Log Application`, `Build Skipped Row`, `Log Skipped`, `Build Run Summary`, `Email Run Summary` | Log both outcomes, then a digest |

## Design decisions worth knowing

**Batch size 1 through the loop.** Slower than fanning out, but it means a
single bad posting fails one iteration instead of the run, and every downstream
`$('Node').first()` unambiguously refers to the current job.

**The dedupe set is the sheet, not workflow state.** `Filter New Jobs` reads
`Job URL` and `Job ID` back out of **both** tabs — `Applications` and
`Skipped`. Both matter: a job you applied to and a job you already rejected are
equally jobs you must not pay to score again, and reading only `Applications`
means every reject is re-scored on every run. (That was a real bug here, caught
by the re-run check in `npm run e2e` and not by any unit test — the unit tests
only saw the node that was wired.) Consequences: the workflow is safe to re-run
at any time, deleting a sheet row makes it reconsider that job, and there is no
hidden state to get out of sync. Both read nodes continue on error so the very
first run works against empty tabs.

**Skipped jobs are logged too.** Not just for the audit trail — without it the
same rejects get re-scored (and re-paid-for) every single morning.

**`maxJobsPerRun` is a quota cap, not a preference.** A broad search returns
hundreds of postings, and the workflow makes two model calls per job. Without
the cap, one run could push a few hundred job descriptions through the model
twice and exhaust a free-tier daily allowance in a single morning.

**Two filters, deliberately ordered cheapest-first.** `Match Search Terms` is a
string comparison and runs before anything reaches a model; `Worth Applying?`
costs a model call per job. The aggregator sources return every job they hold,
so without the keyword gate in front you would pay — in quota or in dollars —
to have a model read postings you could have rejected on the title alone.

**The free sources are third-party endpoints, and that is a real dependency.**
Arbeitnow, RemoteOK, and the ATS board APIs are public and keyless, which also
means nobody promises they will keep working. Both fetch nodes continue on
error so one dead source degrades the run instead of failing it, but if a
source disappears you edit `src/code/build-free-requests.js`. The
Greenhouse / Lever / Ashby boards are the most durable of the set — they are
how those companies publish their own jobs — and the least noisy.

**Free-tier models need pacing, not just capping.** The `Throttle` node exists
because free tiers limit requests per minute, which a batch loop would breach
immediately. It is a config value rather than a constant so raising your quota
is a one-field change.

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
build/run-e2e.mjs                           end-to-end run outside n8n (see below)
build/fixtures/                             vendor-shaped job board payloads
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
npm run e2e # drive the whole pipeline end to end, no n8n needed
```

## The end-to-end runner

`npm run e2e` executes the committed workflow outside n8n. Every Code node,
prompt, expression and node parameter is read from
`workflows/job-application-automation.json` — nothing is reimplemented — and
only the outbound calls are substituted:

| Node | Substituted with |
| --- | --- |
| `Fetch Master Resume` | `build/fixtures/master-resume.txt` |
| `Fetch Free Job Boards` | `build/fixtures/*.json`, in each vendor's real response shape. A source with no fixture returns an error item, exercising the continue-on-error path. |
| `Create Google Doc` | The `multipart/related` body is **parsed** the way Drive parses it — boundary, two parts, metadata mimeType, `text/html` content type — and the extracted HTML is written to `build/e2e-output/`. A malformed body fails here. |
| Sheets nodes | In-memory tabs, dumped to `build/e2e-output/applications.json` |
| Chat models | Real Gemini when `GEMINI_API_KEY` is set, otherwise a deterministic local stub that scores on resume/posting vocabulary overlap and applies the prompt's own hard caps |

Two switches make it useful beyond a smoke test:

```bash
# point at the fixture board slugs, or tighten a threshold
E2E_CONFIG='{"greenhouseCompanies":["acme-labs"],"leverCompanies":["globex"]}' npm run e2e

# replay a previous run's sheet: the re-run must find 0 new jobs
E2E_SEED_SHEET=build/e2e-output/applications.json npm run e2e

# drive the real model
GEMINI_API_KEY=... NODE_USE_ENV_PROXY=1 npm run e2e
```

The seeded re-run is the check worth keeping: it is the only one that proves a
second run costs nothing, and it is what caught the `Skipped`-tab dedupe bug.
