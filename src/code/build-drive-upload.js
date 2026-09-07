// Drive v3 converts an upload into a native Google Doc only when the metadata
// part declares the target mimeType, and metadata + content in one request
// means a multipart/related body. Building the body here keeps the HTTP node
// to a single raw send.
const job = $('Merge Score').first().json;
const config = $('Config').first().json;
const html = $json.resumeHtml;

const boundary = `n8n_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const safe = (value) =>
  String(value ?? '')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const docName = [safe(job.company) || 'Unknown Company', safe(job.title) || 'Role']
  .join(' - ')
  .slice(0, 120);

const metadata = {
  name: `Resume - ${docName}`,
  mimeType: 'application/vnd.google-apps.document',
};

const folderId = String(config.driveFolderId ?? '').trim();
if (folderId && !folderId.startsWith('PUT_')) metadata.parents = [folderId];

const body = [
  `--${boundary}`,
  'Content-Type: application/json; charset=UTF-8',
  '',
  JSON.stringify(metadata),
  `--${boundary}`,
  'Content-Type: text/html; charset=UTF-8',
  '',
  html,
  `--${boundary}--`,
  '',
].join('\r\n');

return [{ json: { ...job, docName: metadata.name, uploadBoundary: boundary, uploadBody: body } }];
