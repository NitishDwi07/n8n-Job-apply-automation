// One item per saved search. Whatever keys you put on a search in the Config
// node are forwarded verbatim to the Apify actor, so this only fills defaults
// and fails loudly on an empty config rather than scraping nothing.
const config = $('Config').first().json;
const queries = Array.isArray(config.searchQueries) ? config.searchQueries : [];

if (queries.length === 0) {
  throw new Error('Config.searchQueries is empty - add at least one { title, location } search.');
}

return queries.map((query, index) => ({
  json: {
    rows: 50,
    publishedAt: 'r604800', // LinkedIn's "past week" filter
    ...query,
    searchIndex: index,
  },
}));
