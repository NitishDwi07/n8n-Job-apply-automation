# Google Sheets schema

Two tabs. **Header names must match exactly** — both Sheets nodes use
auto-map-by-column-name, so a renamed or misspelled header silently creates a
new column instead of erroring.

Paste each row below into cell `A1` of its tab (tab-separated).

## Tab: `Applications`

One row per job that cleared the relevance threshold and got a tailored resume.
This tab is also the de-duplication source — `Filter New Jobs` reads `Job URL`
and `Job ID` from it so a posting is never scored or paid for twice.

| Column | Contents |
| --- | --- |
| `Date` | Run date, `YYYY-MM-DD` |
| `Job ID` | Actor's job ID, or the URL as a fallback |
| `Title` | Job title |
| `Company` | Company name |
| `Location` | Posting location |
| `Workplace` | Remote / hybrid / on-site, when the actor reports it |
| `Salary` | As advertised, blank when not stated |
| `Score` | 0–100 relevance score from the screener |
| `Verdict` | One-line verdict, e.g. `strong match` |
| `Match Reasons` | Why the screener scored it that way |
| `Gaps` | Requirements your resume does not cover — read these before you hit send |
| `Resume Doc` | Link to the generated Google Doc |
| `Job URL` | Canonical posting URL |
| `Apply URL` | Application link where the actor supplies one |
| `Status` | `Resume ready` on insert; overwrite it by hand as you progress |

```
Date	Job ID	Title	Company	Location	Workplace	Salary	Score	Verdict	Match Reasons	Gaps	Resume Doc	Job URL	Apply URL	Status
```

## Tab: `Skipped`

One row per job that was scored and rejected. Keeping these is what stops the
workflow re-scoring the same rejects every morning, and it is your only signal
that the threshold or the search queries need tuning.

| Column | Contents |
| --- | --- |
| `Date` | Run date |
| `Job ID` | Actor's job ID |
| `Title` | Job title |
| `Company` | Company name |
| `Location` | Posting location |
| `Score` | 0–100 |
| `Verdict` | One-line verdict |
| `Reason` | The deal-breaker or the gaps that sank it |
| `Job URL` | Canonical posting URL |
| `Status` | `Skipped` |

```
Date	Job ID	Title	Company	Location	Score	Verdict	Reason	Job URL	Status
```

## Suggested extras

Neither is required by the workflow:

- Freeze row 1 and add a filter view.
- Conditional formatting on `Score`: green ≥ 85, amber 70–84.
- A pivot on `Status` to track how many applications are actually in flight.
