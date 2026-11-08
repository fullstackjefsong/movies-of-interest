'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookup, detail, MetadataError } = require('../metadata.cjs');
const transport = value => async () => ({ ok: true, json: async () => value });
test('TVmaze metadata retains its rating source and separates network from availability', async () => {
  const show = { id: 10, name: 'Test Show', premiered: '2022-01-01', rating: { average: 8.5 }, genres: ['Drama'],
    summary: '<p>A show.</p>', externals: { imdb: 'tt123' }, url: 'https://www.tvmaze.com/shows/10',
    webChannel: { name: 'Netflix' }, _embedded: { cast: [{ person: { name: 'Lead' } }], crew: [{ type: 'Creator', person: { name: 'Creator' } }] } };
  const result = await detail('tvmaze', '10', 'tv', {}, transport(show));
  assert.equal(result.summary, 'A show.');
  assert.deepEqual(result.cast, ['Lead']);
  assert.deepEqual(result.directors, ['Creator']);
  assert.equal(result.year, 2022);
  assert.equal(result.network, 'Netflix');
  assert.deepEqual(result.providers, []);
  assert.match(result.metadataWarning, /not verified/);
});
test('TMDB distinguishes subscription, free, ads, rent and buy with region and trailer', async () => {
  const data = { title: 'Film', release_date: '2020-02-01', vote_average: 7, overview: 'x'.repeat(400),
    videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'valid_id' }] },
    credits: { cast: [{ name: 'Lead' }], crew: [{ job: 'Director', name: 'Director' }] },
    'watch/providers': { results: { US: { link: 'https://www.themoviedb.org/movie/1/watch',
      flatrate: [{ provider_name: 'Netflix' }], free: [{ provider_name: 'Free TV' }], ads: [{ provider_name: 'Ads TV' }],
      rent: [{ provider_name: 'Apple TV' }], buy: [{ provider_name: 'Prime Video' }] }, GB: { flatrate: [{ provider_name: 'Other' }] } } } };
  let auth;
  const result = await detail('tmdb', '1', 'movie', { country: 'US', tmdbToken: 'token' }, async (url, options) => { auth = options.headers.Authorization; return transport(data)(); });
  assert.equal(auth, 'Bearer token');
  assert.deepEqual(result.providers.map(item => item.access), ['Subscription', 'Free', 'With ads', 'Rent', 'Buy']);
  assert.ok(result.providers.every(item => item.verified));
  assert.equal(result.providerCountry, 'US');
  assert.equal(result.trailerIsSearch, false);
  assert.equal(result.summary.length, 320);
  assert.deepEqual(result.directors, ['Director']);
  await assert.rejects(() => detail('tmdb', '1', 'movie', {}, transport(data)), /needs a TMDB credential/);
});
test('Wikidata label fallback, Wikipedia artwork, concise summary and accurate movie filtering', async () => {
  const entities = {
    Q1: { labels: { en: { value: 'Film' } }, claims: {
      P57: [{ mainsnak: { datavalue: { value: { id: 'Q2' } } } }],
      P577: [{ mainsnak: { datavalue: { value: { time: '+2010-01-01T00:00:00Z' } } } }],
      P345: [{ mainsnak: { datavalue: { value: 'tt123' } } }],
    }, sitelinks: { enwiki: { title: 'Film' } } },
    Q2: { labels: { mul: { value: 'Director Name' } } },
    Q3: { claims: {} },
  };
  const fake = async url => {
    if (url.includes('wbsearchentities')) return transport({ search: [{ id: 'Q1', label: 'Film', description: '2010 film directed by Someone' }, { id: 'Q3', label: 'Sound', description: 'sound effect common in film trailers' }] })();
    if (url.includes('wbgetentities')) return transport({ entities })();
    return transport({ query: { pages: { 1: { extract: 'A film.', thumbnail: { source: 'https://upload.wikimedia.org/poster.jpg' } } } } })();
  };
  const results = await lookup('Film', 'movie', {}, fake);
  assert.equal(results.results.length, 1);
  const film = await detail('wikidata', 'Q1', 'movie', {}, fake);
  assert.deepEqual(film.directors, ['Director Name']);
  assert.equal(film.poster, 'https://upload.wikimedia.org/poster.jpg');
  assert.equal(film.year, 2010);
  assert.equal(film.rating, null);
  assert.equal(film.trailerIsSearch, true);
});
test('metadata errors are surfaced, optional enrichment reports partial failures', async () => {
  await assert.rejects(() => lookup('x', 'tv', {}, async () => ({ ok: false, status: 429 })), /HTTP 429/);
  await assert.rejects(() => detail('invalid', 'x', 'movie', {}), MetadataError);
  await assert.rejects(() => detail('tvmaze', '../x', 'tv', {}), /Invalid TVmaze/);
  const item = await detail('wikidata', 'Q1', 'movie', {}, async url => {
    if (url.includes('wikidata')) return transport({ entities: { Q1: { labels: { en: { value: 'Title' } }, claims: {}, sitelinks: { enwiki: { title: 'Title' } } } } })();
    return { ok: false, status: 503 };
  });
  assert.match(item.metadataWarning, /Wikipedia enrichment unavailable/);
  assert.equal(item.title, 'Title');
});
