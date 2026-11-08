'use strict';

class MetadataError extends Error {
  constructor(message) { super(message); this.name = 'MetadataError'; }
}
const USER_AGENT = 'MoviesOfInterest/1.0 (local-first personal watchlist; https://github.com/fullstackjefsong/movies-of-interest)';
async function request(url, token = '', transport = fetch) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try { response = await transport(url, { headers, signal: AbortSignal.timeout(20000) }); }
  catch (error) { throw new MetadataError(`Metadata service could not be reached (${error.message}). Your saved library is still available.`); }
  if (!response.ok) throw new MetadataError(`Metadata service returned HTTP ${response.status}. ${response.status === 429 ? 'Please wait before trying again.' : 'Check your connection or optional TMDB credential.'}`);
  try { return await response.json(); }
  catch { throw new MetadataError('Metadata service returned an unreadable response. Try again later.'); }
}
function plain(value = '') { return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }
function short(value) { const result = plain(value); return result.length > 320 ? result.slice(0, 317).replace(/\s+\S*$/, '') + '...' : result; }
function base(source, sourceId, title, kind) {
  return { source, sourceId: String(sourceId), title, kind, year: null, rating: null, genres: [], directors: [], cast: [],
    summary: '', poster: '', imdb: '', sourceUrl: '', providers: [], runtime: null, language: '', contentRating: '',
    trailer: `https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' official trailer')}`,
    trailerIsSearch: true, fetchedAt: new Date().toISOString(), metadataWarning: '' };
}
function tvItem(show) {
  const item = base('tvmaze', show.id, show.name, 'tv');
  return { ...item, year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    rating: show.rating?.average ?? null, genres: show.genres || [], summary: short(show.summary || ''),
    poster: show.image?.medium || '', imdb: show.externals?.imdb ? `https://www.imdb.com/title/${show.externals.imdb}/` : '',
    sourceUrl: show.url, runtime: show.averageRuntime || show.runtime, language: show.language || '',
    status: show.status, seasons: null, network: show.webChannel?.name || show.network?.name || '',
    metadataWarning: 'TVmaze rating, not IMDb. Network is original distributor, not verified current availability.' };
}
function claim(entity, property) {
  return (entity.claims?.[property] || []).filter(value => value.rank !== 'deprecated').map(value => value.mainsnak?.datavalue?.value).filter(value => value !== undefined);
}
async function wikidata(ids, transport) {
  return request(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids.join('|'))}&props=labels%7Cclaims%7Csitelinks&languages=en%7Cmul&format=json`, '', transport);
}
async function searchSource(query, kind, settings, transport) {
  if (settings.tmdbToken) {
    const data = await request(`https://api.themoviedb.org/3/search/${kind}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US`, settings.tmdbToken, transport);
    return { results: (data.results || []).slice(0, 12).map(item => ({
      ...base('tmdb', item.id, item.title || item.name, kind),
      year: (item.release_date || item.first_air_date) ? Number((item.release_date || item.first_air_date).slice(0, 4)) : null,
      summary: short(item.overview), poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '',
      rating: item.vote_average || null,
    })), notice: 'TMDB search results. Choose the matching title and release year.' };
  }
  if (kind === 'tv') {
    const data = await request(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, '', transport);
    return { results: data.slice(0, 12).map(result => tvItem(result.show)), notice: 'TV data by TVmaze (CC BY-SA). Choose the correct show.' };
  }
  const data = await request(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&type=item&limit=20&format=json`, '', transport);
  if (!data.search?.length) return { results: [], notice: 'No match found. Try another title, or add it manually.' };
  const full = await wikidata(data.search.map(item => item.id), transport);
  const candidates = data.search.filter(item => {
    const entity = full.entities[item.id];
    return claim(entity, 'P345').some(value => /^tt\d+$/.test(value))
      || claim(entity, 'P31').some(value => ['Q11424', 'Q24869', 'Q202866', 'Q5398426', 'Q506240'].includes(value.id))
      || /\b(film|movie)\b.*\b(directed|released)\b|\b(short film|feature film|animated film|television film)\b/i.test(item.description || '');
  }).filter(item => !/\b(television series|tv series|television episode|episode of|video game|novel|album|song)\b/i.test(item.description || ''));
  return { results: candidates.slice(0, 12).map(item => ({
    ...base('wikidata', item.id, item.label, 'movie'),
    year: yearFromEntity(full.entities[item.id]), summary: item.description || '',
  })), notice: 'Wikidata movie matches. Some records lack posters, ratings or cast. No availability is verified in keyless mode.' };
}

const STRONG_MATCH = 0.88;
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and']);
const COMMON_TYPOS = { teh: 'the', hte: 'the', adn: 'and', nad: 'and' };
function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the /, '');
}
// Optimal string alignment distance: Levenshtein plus adjacent transpositions ("teh" -> "the").
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}
const ratio = (a, b) => (a || b) ? 1 - distance(a, b) / Math.max(a.length, b.length) : 1;
function similarity(title, query) {
  const a = normalize(title), b = normalize(query);
  if (!a || !b) return 0;
  if (a === b) return 1;
  let score = ratio(a, b);
  if (b.length >= 3 && a.startsWith(b)) score = Math.max(score, 0.8 + 0.1 * (b.length / a.length));
  const words = b.split(' ').filter(word => !STOP_WORDS.has(word));
  const titleWords = a.split(' ');
  if (words.length) {
    const perWord = words.map(word => Math.max(...titleWords.map(candidate => ratio(candidate, word))));
    const coverage = Math.min(1, words.length / titleWords.filter(word => !STOP_WORDS.has(word)).length || 1);
    score = Math.max(score, (perWord.reduce((sum, value) => sum + value, 0) / words.length) * (0.7 + 0.3 * coverage));
  }
  return Math.min(1, score);
}
function tidy(query) {
  return query.normalize('NFKC').replace(/\s+/g, ' ').trim().split(' ')
    .map(word => COMMON_TYPOS[word.toLowerCase()] || word).join(' ');
}
function releaseYear(query) {
  const match = /^(.+?)[\s,]+\(?((?:18|19|20)\d\d)\)?$/.exec(query);
  const year = match ? Number(match[2]) : null;
  return year && year <= new Date().getFullYear() + 5 ? { title: match[1].trim(), year } : null;
}
async function optional(promise) {
  try { return await promise; }
  catch (error) { if (error instanceof MetadataError) return null; throw error; }
}
// Wikipedia's search corrects spelling ("did you mean") and supports per-word fuzzy title matching.
async function corrections(query, kind, transport) {
  const hint = kind === 'tv' ? 'television series' : 'film';
  const wiki = search => request(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(search)}&srinfo=suggestion&srprop=&srlimit=8&format=json`, '', transport);
  const strip = value => String(value || '').replace(new RegExp(`\\s*${hint}$`, 'i'), '').trim();
  const words = normalize(query).split(' ').filter(word => word && !STOP_WORDS.has(word)).slice(0, 6);
  const fuzzy = words.map(word => `intitle:${word}${word.length >= 4 ? '~' : ''}`).join(' ');
  const [spelled, titled] = await Promise.all([optional(wiki(`${query} ${hint}`)), fuzzy ? optional(wiki(`${fuzzy} ${hint}`)) : null]);
  let suggestion = strip(spelled?.query?.searchinfo?.suggestion);
  if (suggestion) {
    const refined = strip((await optional(wiki(`${suggestion} ${hint}`)))?.query?.searchinfo?.suggestion);
    if (refined) suggestion = refined;
  }
  const media = /\((?:\d{4} )?(?:[\w-]+ )*(?:film|movie|tv series|television series|miniseries|series|tv program|programme)\)$/i;
  const titles = [...(spelled?.query?.search || []), ...(titled?.query?.search || [])].map(hit => hit.title)
    .filter(title => !/^list of /i.test(title) && (!/\)$/.test(title) || media.test(title)))
    .map(title => title.replace(/\s*\([^)]*\)$/, ''))
    .map(title => ({ title, score: similarity(title, query) })).filter(item => item.score >= 0.6)
    .sort((a, b) => b.score - a.score).map(item => item.title);
  return { suggestion, titles };
}
async function lookup(query, kind, settings, transport = fetch) {
  const typed = tidy(query);
  const year = releaseYear(typed);
  const base = year ? year.title : typed;
  const queries = [typed];
  const merged = new Map();
  const typedScore = title => Math.max(similarity(title, typed), similarity(title, base));
  const add = (results, origin, minimum = 0) => {
    for (const item of results || []) {
      const key = item.source + ':' + item.sourceId;
      if (!merged.has(key) && typedScore(item.title) >= minimum) merged.set(key, { item, origin });
    }
  };
  // What the user typed dominates; corrected spellings help only as a tie-breaker.
  const score = item => 0.6 * typedScore(item.title) + 0.4 * Math.max(...queries.map(value => similarity(item.title, value)))
    + (year && item.year === year.year ? 0.05 : 0);
  const strong = () => [...merged.values()].some(entry => typedScore(entry.item.title) >= STRONG_MATCH);
  const primary = await searchSource(typed, kind, settings, transport);
  add(primary.results, 'typed');
  let alternatives = [];
  if (!strong()) {
    const found = await corrections(base, kind, transport);
    const seen = new Set([normalize(typed)]);
    alternatives = [...(year ? [{ value: year.title, rank: 2 }] : []),
      ...(found.suggestion ? [{ value: found.suggestion, rank: similarity(found.suggestion, base) + 0.05 }] : []),
      ...found.titles.map(value => ({ value, rank: similarity(value, base) }))]
      .sort((a, b) => b.rank - a.rank).map(entry => entry.value)
      .filter(value => { const key = normalize(value); if (!key || seen.has(key)) return false; seen.add(key); return true; });
    for (const alternative of alternatives.slice(0, 2)) {
      const response = await optional(searchSource(alternative, kind, settings, transport));
      if (!response?.results.length) continue;
      queries.push(alternative);
      add(response.results, 'corrected');
      if (strong()) break;
    }
    if (!merged.size) {
      // Phonetic misspellings ("incepshun") often still share a prefix with the real title.
      const prefix = base.slice(0, Math.max(4, Math.ceil(base.length * 0.55))).trim();
      if (prefix.length < base.length) add((await optional(searchSource(prefix, kind, settings, transport)))?.results, 'corrected', 0.5);
    }
  }
  const ranked = [...merged.values()].map((entry, index) => ({ ...entry, index, score: score(entry.item) }))
    .sort((a, b) => (Math.round(b.score * 50) - Math.round(a.score * 50)) || a.index - b.index).slice(0, 12);
  const results = ranked.map(entry => entry.item);
  const correctedQuery = ranked[0]?.origin === 'corrected' && typedScore(ranked[0].item.title) < 1 ? ranked[0].item.title : null;
  const suggestions = strong() ? [] : alternatives.filter(value => typedScore(value) >= 0.75 && normalize(value) !== normalize(correctedQuery)
    && !results.some(item => normalize(item.title) === normalize(value))).slice(0, 3);
  const notice = results.length ? primary.notice.replace(/^No match found.*$/, 'Closest matches. Choose the correct title.')
    : `No close match found. Check the spelling, try ${kind === 'tv' ? 'a movie' : 'a TV show'} search, or add it manually.`;
  return { results, notice, correctedQuery, suggestions, confident: strong() };
}
function yearFromEntity(entity) {
  const value = claim(entity, 'P577')[0]?.time;
  return value && /^\+\d{4}/.test(value) ? Number(value.slice(1, 5)) : null;
}
async function detail(source, id, kind, settings, transport = fetch) {
  if (source === 'tvmaze') {
    if (kind !== 'tv' || !/^\d+$/.test(id)) throw new MetadataError('Invalid TVmaze selection.');
    const show = await request(`https://api.tvmaze.com/shows/${id}?embed[]=cast&embed[]=crew`, '', transport);
    return { ...tvItem(show), cast: (show._embedded?.cast || []).slice(0, 8).map(item => item.person.name),
      directors: [...new Set((show._embedded?.crew || []).filter(item => ['Director', 'Creator'].includes(item.type)).map(item => item.person.name))].slice(0, 5) };
  }
  if (source === 'tmdb') {
    if (!settings.tmdbToken) throw new MetadataError('This entry needs a TMDB credential to refresh. Add one in Settings.');
    if (!/^\d+$/.test(id) || !['movie', 'tv'].includes(kind)) throw new MetadataError('Invalid TMDB selection.');
    const data = await request(`https://api.themoviedb.org/3/${kind}/${id}?append_to_response=credits,videos,external_ids,watch/providers&language=en-US`, settings.tmdbToken, transport);
    const item = base('tmdb', id, data.title || data.name, kind);
    const video = (data.videos?.results || []).find(value => value.site === 'YouTube' && value.type === 'Trailer' && /^[A-Za-z0-9_-]+$/.test(value.key));
    const availability = data['watch/providers']?.results?.[settings.country];
    const providers = [];
    for (const [key, access] of [['flatrate', 'Subscription'], ['free', 'Free'], ['ads', 'With ads'], ['rent', 'Rent'], ['buy', 'Buy']]) {
      for (const provider of availability?.[key] || []) providers.push({ name: provider.provider_name, access, url: availability.link || '', verified: true });
    }
    return { ...item, year: (data.release_date || data.first_air_date) ? Number((data.release_date || data.first_air_date).slice(0, 4)) : null,
      rating: data.vote_average || null, genres: (data.genres || []).map(value => value.name),
      directors: kind === 'movie' ? (data.credits?.crew || []).filter(value => value.job === 'Director').map(value => value.name) : (data.created_by || []).map(value => value.name),
      cast: (data.credits?.cast || []).slice(0, 8).map(value => value.name), summary: short(data.overview),
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '',
      imdb: (data.imdb_id || data.external_ids?.imdb_id) ? `https://www.imdb.com/title/${data.imdb_id || data.external_ids.imdb_id}/` : '',
      sourceUrl: `https://www.themoviedb.org/${kind}/${id}`, runtime: data.runtime || data.episode_run_time?.[0] || null,
      language: data.original_language, seasons: data.number_of_seasons || null,
      providers, providerCountry: settings.country,
      trailer: video ? `https://www.youtube.com/watch?v=${video.key}` : item.trailer, trailerIsSearch: !video,
      metadataWarning: `TMDB rating, not IMDb. Availability from TMDB / JustWatch for ${settings.country}, checked ${new Date().toISOString().slice(0, 10)}; may change. Provider links open a watch guide, not guaranteed playback.` };
  }
  if (source !== 'wikidata' || kind !== 'movie' || !/^Q\d+$/.test(id)) throw new MetadataError('Invalid metadata selection.');
  const data = await wikidata([id], transport);
  const entity = data.entities[id];
  if (!entity || entity.missing !== undefined) throw new MetadataError('This Wikidata record is no longer available.');
  const title = entity.labels?.en?.value || entity.labels?.mul?.value || id;
  const item = base('wikidata', id, title, 'movie');
  const people = { genres: claim(entity, 'P136'), directors: claim(entity, 'P57'), cast: claim(entity, 'P161').slice(0, 8), languages: claim(entity, 'P364') };
  const ids = [...new Set(Object.values(people).flat().map(value => value.id).filter(Boolean))];
  const labels = ids.length ? (await wikidata(ids, transport)).entities : {};
  const result = { ...item, year: yearFromEntity(entity), sourceUrl: `https://www.wikidata.org/wiki/${id}`,
    imdb: claim(entity, 'P345')[0] ? `https://www.imdb.com/title/${claim(entity, 'P345')[0]}/` : '',
    runtime: claim(entity, 'P2047')[0]?.amount ? Number(claim(entity, 'P2047')[0].amount) : null,
    metadataWarning: 'Wikidata (CC0) and Wikipedia (CC BY-SA). Ratings and streaming availability are not available in keyless movie mode.' };
  for (const [key, values] of Object.entries(people)) result[key] = values.map(value => labels[value.id]?.labels?.en?.value || labels[value.id]?.labels?.mul?.value).filter(Boolean);
  result.language = result.languages.join(', ');
  delete result.languages;
  const wikiTitle = entity.sitelinks?.enwiki?.title;
  if (wikiTitle) {
    // Facts remain usable if optional Wikipedia artwork/summary is unavailable.
    try {
      const wiki = await request(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(wikiTitle)}&prop=extracts%7Cpageimages&exintro=true&explaintext=true&pithumbsize=500&pilicense=any&format=json`, '', transport);
      const page = Object.values(wiki.query?.pages || {})[0];
      result.summary = short(page?.extract || '');
      result.poster = page?.thumbnail?.source || '';
      result.wikipedia = `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replaceAll(' ', '_'))}`;
    } catch (error) {
      if (!(error instanceof MetadataError)) throw error;
      result.metadataWarning += ` Wikipedia enrichment unavailable: ${error.message}`;
    }
  }
  return result;
}
module.exports = { lookup, detail, request, similarity, MetadataError };
