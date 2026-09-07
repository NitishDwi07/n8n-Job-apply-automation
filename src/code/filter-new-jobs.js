// Anti-join the scrape against everything already in the sheet, then cap the
// batch so one run cannot burn the whole model quota on a broad scrape.
//
// BOTH tabs feed the dedupe set. An application already sent and a job already
// rejected are equally jobs we must not pay to score a second time - reading
// only Applications means every reject gets re-scored every single run.
const config = $('Config').first().json;
const maxJobs = Number(config.maxJobsPerRun) || 25;

const key = (value) => String(value ?? '').trim().toLowerCase().split('?')[0].replace(/\/$/, '');

const seen = new Set();
for (const row of [...$('Get Logged Jobs').all(), ...$('Get Skipped Jobs').all()]) {
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
