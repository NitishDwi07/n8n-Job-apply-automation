// Aggregators return every job they have, not just yours, so the keyword gate
// runs before anything reaches a model. This is the cheapest filter in the
// pipeline - every job it drops is a job you do not pay to have screened.
//
// An empty titleKeywords list means "keep everything"; excludeKeywords always
// applies and always wins.
const config = $('Config').first().json;

const terms = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);

const include = terms(config.titleKeywords);
const exclude = terms(config.excludeKeywords);

const kept = [];
for (const item of $input.all()) {
  const job = item.json;
  const haystack = `${job.title ?? ''}`.toLowerCase();

  if (exclude.some((term) => haystack.includes(term))) continue;
  if (include.length > 0 && !include.some((term) => haystack.includes(term))) continue;

  kept.push({ json: job });
}

return kept;
