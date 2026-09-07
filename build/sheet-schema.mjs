// The single source of truth for the two tabs' header rows.
//
// These must match the keys emitted by src/code/build-log-row.js and
// src/code/build-skipped-row.js exactly - the Sheets nodes are on auto-map, so
// a mismatch silently creates a new column instead of erroring. A test in
// build/test-code-nodes.mjs pins them together so they cannot drift apart.
export const APPLICATIONS_HEADERS = [
  'Date', 'Job ID', 'Title', 'Company', 'Location', 'Workplace', 'Salary',
  'Score', 'Verdict', 'Match Reasons', 'Gaps', 'Resume Doc', 'Job URL',
  'Apply URL', 'Status',
];

export const SKIPPED_HEADERS = [
  'Date', 'Job ID', 'Title', 'Company', 'Location', 'Score', 'Verdict',
  'Reason', 'Job URL', 'Status',
];

export const TABS = [
  { title: 'Applications', headers: APPLICATIONS_HEADERS },
  { title: 'Skipped', headers: SKIPPED_HEADERS },
];
