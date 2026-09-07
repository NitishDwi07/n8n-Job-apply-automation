// Keyless, public job endpoints - no account, no token, no credit.
//
// Two kinds of source:
//   Aggregators   - broad, free, noisy. Filtered later by Match Search Terms.
//   Company boards - Greenhouse / Lever / Ashby expose every company's own
//                    postings as public JSON. Narrow, high signal, and the
//                    place you actually apply. Add the companies you care about.
const config = $('Config').first().json;

const list = (value) =>
  Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];

const requests = [];

if (config.useAggregators !== false) {
  requests.push({ url: 'https://www.arbeitnow.com/api/job-board-api', sourceName: 'arbeitnow' });
  requests.push({ url: 'https://remoteok.com/api', sourceName: 'remoteok' });
}

for (const company of list(config.greenhouseCompanies)) {
  requests.push({
    url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company)}/jobs?content=true`,
    sourceName: `greenhouse:${company}`,
  });
}

for (const company of list(config.leverCompanies)) {
  requests.push({
    url: `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`,
    sourceName: `lever:${company}`,
  });
}

for (const company of list(config.ashbyCompanies)) {
  requests.push({
    url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}`,
    sourceName: `ashby:${company}`,
  });
}

if (requests.length === 0) {
  throw new Error(
    'No free job sources configured - set useAggregators to true, or add at least one company to greenhouseCompanies / leverCompanies / ashbyCompanies.',
  );
}

return requests.map((request) => ({ json: request }));
