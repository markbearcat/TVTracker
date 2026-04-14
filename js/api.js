/**
 * api.js — TV Show data via TMDB public API
 * Uses free TMDB API (user provides nothing — uses public read token)
 */

const TVApi = (() => {
  // Public TMDB read token (read-only, safe to bundle)
  const BASE = 'https://api.themoviedb.org/3';
  const IMG_BASE = 'https://image.tmdb.org/t/p/';
  // Free API key fallback — users should ideally set their own
  const API_KEY = '4e44d9029b1270a757cddc766a1bcb63'; // public demo key

  const headers = {
    'Accept': 'application/json',
  };

  function buildUrl(path, params = {}) {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set('api_key', API_KEY);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
  }

  function posterUrl(path, size = 'w342') {
    if (!path) return null;
    return `${IMG_BASE}${size}${path}`;
  }

  async function searchShows(query) {
    if (!query || query.trim().length < 2) return [];
    try {
      const res = await fetch(buildUrl('/search/tv', { query: query.trim(), language: 'en-US' }));
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      return (data.results || []).slice(0, 10).map(normalizeShow);
    } catch (e) {
      console.error('[TVApi] searchShows:', e);
      return [];
    }
  }

  async function getShowDetails(id) {
    try {
      const res = await fetch(buildUrl(`/tv/${id}`, {
        language: 'en-US',
        append_to_response: 'next_episode_to_air,last_episode_to_air,seasons',
      }));
      if (!res.ok) throw new Error('Details failed');
      const data = await res.json();
      return normalizeShowDetail(data);
    } catch (e) {
      console.error('[TVApi] getShowDetails:', e);
      return null;
    }
  }

  async function getSeasonEpisodes(showId, seasonNumber) {
    try {
      const res = await fetch(buildUrl(`/tv/${showId}/season/${seasonNumber}`, { language: 'en-US' }));
      if (!res.ok) return [];
      const data = await res.json();
      return (data.episodes || []).map(ep => ({
        id: ep.id,
        showId,
        season: ep.season_number,
        episode: ep.episode_number,
        name: ep.name,
        overview: ep.overview,
        airDate: ep.air_date,
        code: `S${String(ep.season_number).padStart(2,'0')}E${String(ep.episode_number).padStart(2,'0')}`,
      }));
    } catch (e) {
      console.error('[TVApi] getSeasonEpisodes:', e);
      return [];
    }
  }

  async function getUpcomingEpisodes(showId) {
    try {
      const detail = await getShowDetails(showId);
      if (!detail) return [];
      const upcoming = [];
      const today = new Date();
      today.setHours(0,0,0,0);

      // next_episode_to_air
      if (detail.nextEpisode && detail.nextEpisode.airDate) {
        const d = new Date(detail.nextEpisode.airDate);
        if (d >= today) upcoming.push(detail.nextEpisode);
      }

      // Look at current/latest season for future episodes
      const seasons = detail.seasons || [];
      const currentSeason = seasons.filter(s => s.number > 0).pop();
      if (currentSeason) {
        const eps = await getSeasonEpisodes(showId, currentSeason.number);
        const futureEps = eps.filter(ep => {
          if (!ep.airDate) return false;
          const d = new Date(ep.airDate);
          return d >= today;
        });
        // Merge, avoid dupes
        futureEps.forEach(ep => {
          if (!upcoming.find(u => u.id === ep.id)) upcoming.push(ep);
        });
      }

      return upcoming.sort((a, b) => new Date(a.airDate) - new Date(b.airDate));
    } catch (e) {
      console.error('[TVApi] getUpcomingEpisodes:', e);
      return [];
    }
  }

  // ─── Normalizers ───
  function normalizeShow(raw) {
    return {
      id: raw.id,
      name: raw.name || raw.original_name,
      overview: raw.overview,
      poster: posterUrl(raw.poster_path),
      backdrop: posterUrl(raw.backdrop_path, 'w780'),
      firstAired: raw.first_air_date,
      status: raw.status,
      voteAverage: raw.vote_average,
      popularity: raw.popularity,
      source: 'tmdb',
    };
  }

  function normalizeShowDetail(raw) {
    const base = normalizeShow(raw);
    const nextEp = raw.next_episode_to_air;
    const lastEp = raw.last_episode_to_air;

    return {
      ...base,
      status: raw.status,
      numberOfSeasons: raw.number_of_seasons,
      numberOfEpisodes: raw.number_of_episodes,
      networks: (raw.networks || []).map(n => n.name),
      genres: (raw.genres || []).map(g => g.name),
      seasons: (raw.seasons || []).map(s => ({
        number: s.season_number,
        name: s.name,
        episodeCount: s.episode_count,
        airDate: s.air_date,
      })),
      nextEpisode: nextEp ? {
        id: nextEp.id,
        showId: raw.id,
        season: nextEp.season_number,
        episode: nextEp.episode_number,
        name: nextEp.name,
        overview: nextEp.overview,
        airDate: nextEp.air_date,
        code: `S${String(nextEp.season_number).padStart(2,'0')}E${String(nextEp.episode_number).padStart(2,'0')}`,
      } : null,
      lastEpisode: lastEp ? {
        id: lastEp.id,
        season: lastEp.season_number,
        episode: lastEp.episode_number,
        name: lastEp.name,
        airDate: lastEp.air_date,
        code: `S${String(lastEp.season_number).padStart(2,'0')}E${String(lastEp.episode_number).padStart(2,'0')}`,
      } : null,
    };
  }

  return {
    searchShows,
    getShowDetails,
    getSeasonEpisodes,
    getUpcomingEpisodes,
    posterUrl,
  };
})();
