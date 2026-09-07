// Anti-join the scrape against everything already in the sheet (both tabs feed
// the same dedupe set), then cap the batch so one run cannot burn the whole
// OpenAI budget on a 700-result scrape.
const config = $('Config').first().json;
const maxJobs = Number(config.maxJobsPerRun) || 25;

const key = (value) => String(value ?? '').trim().toLowerCase().split('?')[0].replace(/\/$/, '');

const seen = new Set();
for (const row of $input.all()) {
  const record = row.json ?? {};
  for (const column of ['Job URL', 'Job ID']) {
    const value = key(record[column]);
    if (value) seen.add(value);
  }
}

const fresh = [];
for (const item of $('Match Search Terms').all()) {
  if (fresh.length >= maxJobs) break;

  const job = item.json;
  const urlKey = key(job.url);
  const idKey = key(job.jobId);
  if ((urlKey && seen.has(urlKey)) || (idKey && seen.has(idKey))) continue;

  if (urlKey) seen.add(urlKey);
  if (idKey) seen.add(idKey);
  fresh.push({ json: job });
}

return fresh;
