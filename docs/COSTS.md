# Running costs

Rough per-job arithmetic, assuming GPT-4o and a ~4,000-token job description.

## Per job scored

| Step | Tokens (in / out) | Cost |
| --- | --- | --- |
| Relevance screen | ~5,500 / ~200 | ~$0.016 |
| Apify scrape (amortised, ~50 jobs per actor run) | — | ~$0.005 |

## Per job that clears the threshold

| Step | Tokens (in / out) | Cost |
| --- | --- | --- |
| Resume generation | ~6,500 / ~1,800 | ~$0.034 |
| Google Docs + Sheets | — | free |

## Realistic monthly totals

`maxJobsPerRun: 25`, weekdays only, ~30% clearing a threshold of 70:

- 25 × 22 = **550 jobs scored** → ~$11.50
- ~165 resumes generated → ~$5.60
- Apify → covered by the free $5/month credit at this volume
- **≈ $17/month**

Levers, in order of effect:

1. **Screen with a cheaper model.** Put `gpt-4o-mini` on `Scoring Model` and
   keep `gpt-4o` on `Resume Model`. Screening is ~2/3 of the spend and the
   cheap model handles it well. Drops the total to roughly **$7/month**.
2. **Truncate descriptions.** `Normalize Jobs` caps them at 12,000 characters;
   6,000 is usually still enough to screen on and halves the screening input.
3. **Tighten `searchQueries`.** Fewer, sharper searches beat filtering junk
   with an LLM — the cheapest job is the one you never scrape.
4. **Raise `relevanceThreshold`.** Resume generation is the expensive half;
   70 → 80 typically cuts it by a third.
5. **Narrow `publishedAt`.** `r86400` (past 24h) on a daily schedule means you
   scrape each posting once instead of re-scraping a week's worth every day.

Self-hosted n8n adds nothing beyond the box it runs on. n8n Cloud bills per
execution — note that this workflow is **one execution per run**, not one per
job, because the per-job iteration happens inside the loop node.
