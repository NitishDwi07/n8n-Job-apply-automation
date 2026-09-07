// The loop node's "done" output replays every item that was fed back into it,
// which is exactly the two log-row shapes - so the run summary needs no state.
const rows = $input.all().map((item) => item.json ?? {});
const applied = rows.filter((row) => row.Status === 'Resume ready');
const skipped = rows.filter((row) => row.Status === 'Skipped');

const byScore = [...applied].sort((a, b) => Number(b.Score) - Number(a.Score));

const escape = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const list = byScore
  .map(
    (row) =>
      `<li><strong>${escape(row.Score)}</strong> - ${escape(row.Title)} at ${escape(row.Company)} (${escape(row.Location)})<br>` +
      `<a href="${escape(row['Resume Doc'])}">Tailored resume</a> &middot; <a href="${escape(row['Job URL'])}">Posting</a></li>`,
  )
  .join('\n');

const html = `<p>Scored <strong>${rows.length}</strong> new postings.</p>
<p><strong>${applied.length}</strong> cleared the threshold and have a tailored resume waiting. <strong>${skipped.length}</strong> were skipped.</p>
${list ? `<ul>\n${list}\n</ul>` : '<p>Nothing cleared the threshold this run.</p>'}`;

return [
  {
    json: {
      scored: rows.length,
      resumesGenerated: applied.length,
      skipped: skipped.length,
      topScore: byScore.length ? Number(byScore[0].Score) : 0,
      subject: `${applied.length} tailored resume${applied.length === 1 ? '' : 's'} ready (${rows.length} jobs scored)`,
      html,
    },
  },
];
