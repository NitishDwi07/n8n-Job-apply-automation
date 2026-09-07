// The model is told to return bare HTML but wraps it in a fence often enough
// that stripping one is far cheaper than a retry.
const job = $('Merge Score').first().json;

let html = String($json.text ?? $json.output ?? $json.response ?? '').trim();
html = html
  .replace(/^```(?:html)?[ \t]*\r?\n?/i, '')
  .replace(/\r?\n?```$/, '')
  .trim();

// Drop anything the model said before the document itself.
const docStart = html.search(/<(!doctype|html|body|h1|div)\b/i);
if (docStart > 0) html = html.slice(docStart).trim();

if (!/<html/i.test(html)) {
  html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${job.title || 'Resume'}</title></head><body>${html}</body></html>`;
}

if (html.length < 400) {
  throw new Error(`Generated resume for "${job.title}" is only ${html.length} chars - refusing to upload it.`);
}

return [{ json: { ...job, resumeHtml: html } }];
