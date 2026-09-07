// Skipped jobs are logged too: they are what tells you your threshold or your
// search queries are wrong, and they keep the dedupe set from re-scoring them.
const job = $json;

return [
  {
    json: {
      'Date': new Date().toISOString().slice(0, 10),
      'Job ID': job.jobId,
      'Title': job.title,
      'Company': job.company,
      'Location': job.location,
      'Score': job.score,
      'Verdict': job.verdict,
      'Reason': job.dealBreakerHit ? `Deal-breaker: ${job.gaps}` : job.gaps || job.matchReasons,
      'Job URL': job.url,
      'Status': 'Skipped',
    },
  },
];
