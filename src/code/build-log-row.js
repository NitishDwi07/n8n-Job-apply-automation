// Keys must match the "Applications" header row exactly - the Sheets node is
// on auto-map, so a renamed key silently creates a new column.
const job = $('Build Drive Upload').first().json;
const doc = $json ?? {};
const docUrl = doc.webViewLink || (doc.id ? `https://docs.google.com/document/d/${doc.id}/edit` : '');

return [
  {
    json: {
      'Date': new Date().toISOString().slice(0, 10),
      'Job ID': job.jobId,
      'Title': job.title,
      'Company': job.company,
      'Location': job.location,
      'Workplace': job.workplaceType,
      'Salary': job.salary,
      'Score': job.score,
      'Verdict': job.verdict,
      'Match Reasons': job.matchReasons,
      'Gaps': job.gaps,
      'Resume Doc': docUrl,
      'Job URL': job.url,
      'Apply URL': job.applyUrl,
      'Status': 'Resume ready',
    },
  },
];
