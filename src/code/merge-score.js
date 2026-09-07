// The LLM chain only returns `output`, so re-attach the job it was scoring.
// Batch size is 1, which is what makes `.first()` the current job.
const job = $('Loop Over Jobs').first().json;
const score = $json.output ?? {};

// A model that drifts off the schema used to land here as a silent score of 0,
// which is indistinguishable from a real rejection - so a broken screener
// would quietly skip every job while looking like it was working. Drift is
// systematic rather than per-job, so fail on the first one instead.
if (score === null || typeof score !== 'object' || Number.isNaN(Number(score.score))) {
  throw new Error(
    `Screener returned no usable "score" (got keys: ${Object.keys(score ?? {}).join(', ') || 'none'}). ` +
      'Check that the Relevance Schema output parser is still attached to Score Job Relevance.',
  );
}

const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

return [
  {
    json: {
      ...job,
      score: clamp(score.score),
      relevant: score.relevant === true,
      verdict: String(score.verdict ?? '').slice(0, 120),
      matchReasons: String(score.matchReasons ?? '').slice(0, 1000),
      gaps: String(score.gaps ?? '').slice(0, 1000),
      dealBreakerHit: score.dealBreakerHit === true,
      suggestedResumeAngle: String(score.suggestedResumeAngle ?? '').slice(0, 500),
      scoredAt: new Date().toISOString(),
    },
  },
];
