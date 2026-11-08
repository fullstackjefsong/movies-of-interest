'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { createApp, validateImage } = require('../app.cjs');
const fixture = { source: 'wikidata', sourceId: 'Q1', title: 'Example film', kind: 'movie', year: 2020, rating: null,
  genres: ['Drama'], directors: ['A Director'], cast: ['A Lead'], summary: 'A short summary.', poster: '', imdb: '',
  sourceUrl: 'https://www.wikidata.org/wiki/Q1', providers: [], runtime: 90, fetchedAt: '2026-01-01T00:00:00Z' };
async function setup(t, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moi-test-'));
  const app = createApp({ dataDir, lookup: async () => ({ results: [fixture], notice: 'Test' }), detail: async () => fixture, ...extra });
  const origin = await app.listen(0);
  const html = await (await fetch(origin)).text();
  const token = /name="moi-token" content="([^"]+)"/.exec(html)[1];
  t.after(async () => {
    if (app.server.listening) await new Promise(resolve => { app.server.once('close', resolve); app.close(); });
    for (const name of fs.readdirSync(dataDir)) fs.unlinkSync(path.join(dataDir, name));
    fs.rmdirSync(dataDir);
  });
  return { app, origin, dataDir, token, request: (route, method = 'GET', data, headers = {}) =>
    fetch(origin + '/api/' + route, { method, headers: { 'X-MOI-Token': token, ...headers, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }) };
}
test('library add, duplicate guard, viewed toggle, notes, refresh and delete', async t => {
  const { request } = await setup(t);
  assert.equal((await request('entries', 'POST', { source: 'wikidata', sourceId: 'Q1', kind: 'movie' })).status, 201);
  assert.equal((await request('entries', 'POST', { source: 'wikidata', sourceId: 'Q1', kind: 'movie' })).status, 409);
  let state = await (await request('state')).json();
  assert.equal(state.entries[0].title, fixture.title);
  assert.equal(state.entries[0].serviceLinks.length, 8);
  assert.ok(state.entries[0].serviceLinks.every(item => !item.verified));
  assert.equal((await request('entries/1', 'PATCH', { viewed: true, notes: 'A note' })).status, 200);
  state = await (await request('state')).json();
  assert.equal(state.entries[0].viewed, true);
  assert.ok(state.entries[0].viewedAt);
  const timestamp = state.entries[0].viewedAt;
  await request('entries/1', 'PATCH', { notes: 'Changed' });
  assert.equal((await (await request('state')).json()).entries[0].viewedAt, timestamp);
  await request('entries/1/refresh', 'POST', {});
  state = await (await request('state')).json();
  assert.equal(state.entries[0].notes, 'Changed');
  assert.equal(state.entries[0].viewed, true);
  await request('entries/1', 'PATCH', { viewed: false });
  assert.equal((await (await request('state')).json()).entries[0].viewedAt, null);
  assert.equal((await request('entries/1', 'DELETE')).status, 200);
  assert.equal((await request('entries/1', 'DELETE')).status, 404);
});
test('manual entries stay in addition order; data survives server restart', async t => {
  const { request, dataDir, app } = await setup(t);
  for (const title of ['Z last alphabetically', 'A first alphabetically']) {
    assert.equal((await request('entries', 'POST', { source: 'manual', title, kind: 'movie' })).status, 201);
  }
  assert.deepEqual((await (await request('state')).json()).entries.map(item => item.title), ['Z last alphabetically', 'A first alphabetically']);
  await new Promise(resolve => { app.server.once('close', resolve); app.close(); });
  const second = createApp({ dataDir });
  const origin = await second.listen(0);
  const html = await (await fetch(origin)).text();
  const token = /name="moi-token" content="([^"]+)"/.exec(html)[1];
  const state = await (await fetch(origin + '/api/state', { headers: { 'X-MOI-Token': token } })).json();
  assert.equal(state.entries.length, 2);
  await new Promise(resolve => { second.server.once('close', resolve); second.close(); });
});
test('reject unauthenticated, cross-origin, DNS-rebinding and invalid requests', async t => {
  const { origin, request, token } = await setup(t);
  assert.equal((await fetch(origin + '/api/state')).status, 403);
  assert.equal((await request('state', 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const req = http.get(origin + '/api/state', { headers: { Host: 'evil.example', 'X-MOI-Token': token } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(rebindingStatus, 403);
  assert.equal((await request('search?q=x&kind=music')).status, 400);
  assert.equal((await request('search?q=&kind=movie')).status, 400);
  assert.equal((await request('entries', 'POST', { source: 'manual', title: '', kind: 'movie' })).status, 400);
  assert.equal((await request('settings', 'PUT', { accent: 'red' })).status, 400);
  assert.equal((await request('settings', 'PUT', { country: 'usa' })).status, 400);
  assert.equal((await request('settings', 'PUT', { fake: 'x' })).status, 400);
  assert.equal((await request('stop', 'POST', { confirm: 'wrong' })).status, 400);
  assert.equal((await request('export?format=wrong')).status, 400);
  await request('entries', 'POST', { source: 'manual', title: 'Test', kind: 'tv' });
  assert.equal((await request('entries/1', 'PATCH', { viewed: 'yes' })).status, 400);
  assert.equal((await request('entries/1/refresh', 'POST', {})).status, 400);
});
test('settings round trip, all export shapes and credential redaction', async t => {
  const { request, dataDir } = await setup(t);
  await request('settings', 'PUT', { banner: 'My cinema', tmdbToken: 'private-secret', country: 'GB' });
  let state = await (await request('state')).json();
  assert.equal(state.settings.banner, 'My cinema');
  assert.equal(state.settings.hasTmdbToken, true);
  assert.equal(state.settings.tmdbToken, undefined);
  await request('entries', 'POST', { source: 'manual', title: '=FORMULA("quote")', kind: 'movie' });
  const csv = await (await request('export?format=csv')).text();
  assert.ok(csv.includes(`"'=FORMULA(""quote"")"`));
  const json = await (await request('export?format=json')).json();
  assert.equal(json.version, 1);
  assert.equal(json.entries.length, 1);
  assert.ok(!JSON.stringify(json).includes('private-secret'));
  const backup = Buffer.from(await (await request('export?format=sqlite')).arrayBuffer());
  assert.equal(backup.subarray(0, 15).toString(), 'SQLite format 3');
  const backupPath = path.join(dataDir, 'backup.db');
  fs.writeFileSync(backupPath, backup);
  const db = new DatabaseSync(backupPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM entries').get().count, 1);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='tmdbToken'").get(), undefined);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='banner'").get().value, '"My cinema"');
  db.close();
  state = await (await request('state')).json();
  assert.equal(state.settings.hasTmdbToken, true);
  assert.ok(!fs.readdirSync(dataDir).some(file => file.startsWith('export-')));
});
test('image upload rejects active content and accepts raster headers', () => {
  assert.throws(() => validateImage('data:image/svg+xml;base64,PHN2Zz4='), /Choose a PNG/);
  assert.throws(() => validateImage('data:image/png;base64,PHN2Zz4='), /content does not match/);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(validateImage(png), png);
  assert.equal(validateImage(''), '');
});
test('metadata failures are explicit and do not create or overwrite entries', async t => {
  const { MetadataError } = require('../metadata.cjs');
  const { request } = await setup(t, { detail: async () => { throw new MetadataError('Service offline.'); } });
  const response = await request('entries', 'POST', { source: 'wikidata', sourceId: 'Q1', kind: 'movie' });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'Service offline.');
  assert.equal((await (await request('state')).json()).entries.length, 0);
});
