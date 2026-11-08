'use strict';

class MetadataError extends Error {
  constructor(message) { super(message); this.name = 'MetadataError'; }
}
const USER_AGENT = 'MoviesOfInterest/1.0 (local-first personal watchlist; Node.js)';
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
async function lookup(query, kind, settings, transport = fetch) {
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
  }).filter(item => !/\b(television series|tv series|television episode|video game|novel|album|song)\b/i.test(item.description || ''));
  return { results: candidates.slice(0, 12).map(item => ({
    ...base('wikidata', item.id, item.label, 'movie'),
    year: yearFromEntity(full.entities[item.id]), summary: item.description || '',
  })), notice: 'Wikidata movie matches. Some records lack posters, ratings or cast. No availability is verified in keyless mode.' };
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
module.exports = { lookup, detail, request, MetadataError };
