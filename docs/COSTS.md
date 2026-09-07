# Running costs

The default configuration is **free**. Nothing here requires a card.

| Service | Plan used | Cost |
| --- | --- | --- |
| n8n | Self-hosted (`docker-compose.yml`) | Free |
| Google Gemini | Free tier, `gemini-2.0-flash` | Free |
| Job sources | Keyless public endpoints | Free |
| Google Drive / Docs / Sheets | Personal account | Free |

## What "free tier" actually buys you

Gemini's free tier is rate-limited rather than metered — the constraint is
requests, not dollars. This workflow makes **two model calls per job** (one
screen, one resume), so:

| `maxJobsPerRun` | Model calls per run | Comfortable? |
| --- | --- | --- |
| 10 | 20 | Yes |
| 25 (default) | 50 | Yes |
| 100 | 200 | Check your current daily quota first |

Two settings keep you inside it:

- **`throttleSeconds`** (default `10`) — the `Throttle` node pauses between
  jobs so you never breach the per-minute limit. At 25 jobs a run takes about
  five minutes. Lower it only if you have raised your quota.
- **`maxJobsPerRun`** (default `25`) — the ceiling on jobs scored per run.

Google publishes current free-tier limits at
[ai.google.dev/pricing](https://ai.google.dev/pricing); they change, so check
rather than trusting a number written here.

## The privacy trade

Free-tier Gemini usage may be reviewed by humans and used to improve Google's
models. This workflow sends your **full resume** on every call. That is a real
trade, and it is the actual price of the free tier.

If that is not acceptable, you have two options:

- **Paid Gemini or OpenAI.** Paid API usage is not used for training. Replace
  the two `Google Gemini Chat Model` nodes with `OpenAI Chat Model` nodes;
  nothing else in the graph changes. Roughly **$17/month** at 550 jobs on
  GPT-4o, or about **$6/month** if you use GPT-4o-mini for screening (two
  thirds of the volume) and keep the better model for resume writing.
- **Local models.** Point n8n at [Ollama](https://ollama.com) — genuinely free
  and fully private, but you need hardware that can run a capable model, and
  resume quality drops noticeably below the hosted models.

## If you switch to Apify (`jobSource: 'apify'`)

LinkedIn has better coverage than the free sources, and Apify's free tier
includes a $5/month credit that renews. Two things to check on the actor's own
page before a large run:

- Some actors are **rented** — a flat monthly fee on top of compute.
- Some charge **per result**, which a 500-row scrape reaches quickly.

Neither is visible from the workflow, so read the pricing on the actor page.

## Reducing load regardless of provider

1. **Tighten `titleKeywords` and `excludeKeywords`.** This filter runs *before*
   any model call, so everything it drops is free. Highest leverage by far.
2. **Prefer company boards over aggregators.** Set `useAggregators: false` and
   list the companies you actually want. Far less noise per job scored.
3. **Truncate descriptions.** `Normalize Jobs` caps them at 12,000 characters;
   6,000 is usually enough to screen on.
4. **Raise `relevanceThreshold`.** Resume writing is the more expensive call;
   70 → 80 typically cuts it by a third.

Self-hosted n8n adds nothing beyond the machine it runs on. n8n Cloud bills per
execution — note this workflow is **one execution per run**, not one per job,
because the per-job iteration happens inside the loop node.
