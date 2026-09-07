// Every LinkedIn jobs actor on Apify invents its own field names, and some
// return one item holding an array instead of one item per job. Normalising
// here is what lets you swap actors without touching the rest of the workflow.
const asText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (typeof value === 'object') return asText(value.name ?? value.text ?? value.title ?? value.value ?? '');
  return '';
};

const pick = (obj, paths) => {
  for (const path of paths) {
    const value = path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? acc : acc[key]), obj);
    const text = asText(value);
    if (text) return text;
  }
  return '';
};

const stripHtml = (text) =>
  text.includes('<')
    ? text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/(p|div|li|br|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : text;

const canonicalUrl = (url) => url.split('?')[0].replace(/\/$/, '');

const jobs = [];
const seen = new Set();

for (const item of $input.all()) {
  const payload = item.json ?? {};

  // The Apify node is set to continue on error so one dead search does not
  // kill the run; those items arrive with an `error` key and no job fields.
  if (payload.error && !payload.title && !payload.jobTitle) continue;

  const batch = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.jobs)
      ? payload.jobs
      : Array.isArray(payload.items)
        ? payload.items
        : [payload];

  for (const job of batch) {
    if (!job || typeof job !== 'object') continue;

    const url = canonicalUrl(pick(job, ['jobUrl', 'link', 'url', 'jobPostingUrl', 'applyUrl']));
    const title = pick(job, ['title', 'jobTitle', 'position', 'name']);
    if (!url && !title) continue;

    const jobId = pick(job, ['id', 'jobId', 'jobPostingId', 'trackingId']) || url;
    if (seen.has(jobId)) continue;
    seen.add(jobId);

    jobs.push({
      json: {
        jobId,
        title,
        company: pick(job, ['companyName', 'company.name', 'company', 'companyDetails.name', 'organization']),
        location: pick(job, ['location', 'jobLocation', 'formattedLocation', 'locationName']),
        url,
        applyUrl: pick(job, ['applyUrl', 'applicationUrl', 'jobUrl', 'link', 'url']),
        description: stripHtml(
          pick(job, ['descriptionText', 'description', 'jobDescription', 'descriptionHtml', 'snippet']),
        ).slice(0, 12000),
        postedAt: pick(job, ['postedAt', 'publishedAt', 'listedAt', 'postedDate', 'date']),
        salary: pick(job, ['salary', 'salaryInfo', 'compensation', 'formattedSalary']),
        employmentType: pick(job, ['employmentType', 'contractType', 'jobType']),
        seniority: pick(job, ['seniorityLevel', 'experienceLevel', 'seniority']),
        workplaceType: pick(job, ['workplaceType', 'workType', 'locationType', 'remote']),
        source: 'linkedin',
        scrapedAt: new Date().toISOString(),
      },
    });
  }
}

return jobs;
