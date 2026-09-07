// Every job source invents its own field names, and some wrap the list in an
// envelope instead of returning one item per job. Normalising here is what
// lets you mix LinkedIn (via Apify), the free aggregators, and company ATS
// boards in one pipeline without touching anything downstream.
const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // last, so &amp;lt; decodes to &lt; and not <

// Greenhouse returns entity-encoded HTML, so entities are decoded before tags
// are stripped - the other way round leaves "<p>" sitting in the text.
const stripHtml = (raw) => {
  const text = decodeEntities(raw);
  if (!text.includes('<')) return text.trim();
  return text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|br|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

const asText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return '';
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

const canonicalUrl = (url) => url.split('?')[0].replace(/\/$/, '');

// Company ATS boards do not name the company in the job object - it is the
// board slug in the URL.
const companyFromUrl = (url) => {
  const match =
    url.match(/(?:boards|job-boards)\.greenhouse\.io\/([^/]+)/) ??
    url.match(/jobs\.lever\.co\/([^/]+)/) ??
    url.match(/jobs\.ashbyhq\.com\/([^/]+)/);
  if (!match) return '';
  return match[1]
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
};

const jobs = [];
const seen = new Set();

for (const item of $input.all()) {
  const payload = item.json ?? {};

  // Fetch nodes are set to continue on error so one dead source cannot kill
  // the run; those items arrive with an `error` key and no job fields.
  if (payload.error && !payload.title && !payload.jobTitle && !payload.position) continue;

  const batch = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.jobs)
      ? payload.jobs
      : Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.results)
            ? payload.results
            : [payload];

  for (const job of batch) {
    if (!job || typeof job !== 'object') continue;

    const url = canonicalUrl(
      pick(job, ['jobUrl', 'absolute_url', 'hostedUrl', 'job_url', 'link', 'url', 'applyUrl', 'jobPostingUrl']),
    );
    const title = pick(job, ['title', 'jobTitle', 'position', 'text', 'name']);
    if (!url && !title) continue;

    const jobId = pick(job, ['id', 'jobId', 'jobPostingId', 'slug', 'trackingId']) || url;
    if (seen.has(jobId)) continue;
    seen.add(jobId);

    // Booleans are dropped by asText, so remote flags are mapped explicitly.
    const remoteFlag = job.remote ?? job.isRemote ?? job.remoteOk;
    let workplaceType = pick(job, ['workplaceType', 'workType', 'locationType']);
    if (!workplaceType && typeof remoteFlag === 'boolean') workplaceType = remoteFlag ? 'Remote' : 'On-site';

    jobs.push({
      json: {
        jobId,
        title,
        company:
          pick(job, [
            'companyName',
            'company_name',
            'company.name',
            'company',
            'companyDetails.name',
            'organization',
            'hiringOrganization.name',
          ]) || companyFromUrl(url),
        location: pick(job, [
          'location',
          'location.name',
          'jobLocation',
          'formattedLocation',
          'locationName',
          'categories.location',
          'secondaryLocations',
        ]),
        url,
        applyUrl: pick(job, ['applyUrl', 'applicationUrl', 'hostedUrl', 'absolute_url', 'jobUrl', 'link', 'url']),
        description: stripHtml(
          pick(job, [
            'descriptionText',
            'descriptionPlain',
            'description',
            'content',
            'jobDescription',
            'descriptionHtml',
            'snippet',
          ]),
        ).slice(0, 12000),
        postedAt: pick(job, [
          'postedAt',
          'publishedAt',
          'listedAt',
          'postedDate',
          'created_at',
          'createdAt',
          'updated_at',
          'date',
        ]),
        salary: pick(job, ['salary', 'salaryInfo', 'compensation', 'formattedSalary', 'salary_min']),
        employmentType: pick(job, [
          'employmentType',
          'employment_type',
          'contractType',
          'jobType',
          'job_types',
          'categories.commitment',
          'commitment',
        ]),
        seniority: pick(job, ['seniorityLevel', 'experienceLevel', 'seniority', 'categories.level']),
        workplaceType,
        source: asText(payload.sourceName) || 'job-board',
        scrapedAt: new Date().toISOString(),
      },
    });
  }
}

return jobs;
