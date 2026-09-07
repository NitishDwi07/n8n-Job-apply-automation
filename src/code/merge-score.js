// The LLM chain only returns `output`, so re-attach the job it was scoring.
// Batch size is 1, which is what makes `.first()` the current job.
const job = $('Loop Over Jobs').first().json;
const score = $json.output ?? {};

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
