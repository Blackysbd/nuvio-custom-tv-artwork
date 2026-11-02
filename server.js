import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const MDBLIST_LIST_URL =
  process.env.MDBLIST_LIST_URL ||
  "https://mdblist.com/lists/blackysbd650/highly-rated-series/json";

const CUSTOM_ARTWORK = {
  95480: {
    poster: "https://i.postimg.cc/Dm5XW3kv/poster.png",
    background: "https://i.postimg.cc/mhVHcWfZ/fanart.jpg",
    seasonPosters: {
      1: "https://i.postimg.cc/Z0jd9ztB/season01-poster.png",
      2: "https://i.postimg.cc/0rZw61RK/season02-poster.png",
      3: "https://i.postimg.cc/Lhv1qFKj/season03-poster.png",
      4: "https://i.postimg.cc/s1KhBCdS/season04-poster.png",
      5: "https://i.postimg.cc/Lhv1qFKX/season05-poster.png",
      6: "https://i.postimg.cc/QVSTBZGd/season06-poster.png"
    }
  }
};

const manifest = {
  id: "uk.blackysbd.nuvio.customtvartwork",
  version: "1.1.0",
  name: "My TV Artwork",
  description: "A personal TV catalogue sourced from MDBList, with custom show and season artwork.",
  resources: ["catalog", "meta"],
  types: ["series"],
  idPrefixes: ["tmdb:"],
  catalogs: [{ type: "series", id: "my-tv-shows", name: "My TV Shows" }],
  behaviorHints: { configurable: false, configurationRequired: false }
};

const metaCache = new Map();
let catalogueCache = { expires: 0, shows: [] };
let cataloguePromise = null;

function json(res, data, maxAge = 300) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": `public, max-age=${maxAge}`
  });
  res.end(JSON.stringify(data));
}

async function tmdb(path) {
  if (!TMDB_API_KEY) throw new Error("TMDB_API_KEY is not configured.");
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TMDB request failed: HTTP ${response.status}`);
  return response.json();
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.shows)) return payload.shows;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function normalizeShow(item) {
  const rawId =
    item?.ids?.tmdb ??
    item?.tmdbid ??
    item?.tmdb_id ??
    item?.tmdbId ??
    item?.id;

  const tmdbId = Number(rawId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;

  const mediaType = String(item?.mediatype ?? item?.media_type ?? item?.type ?? "").toLowerCase();
  if (mediaType && !["show", "series", "tv", "tvshow"].includes(mediaType)) return null;

  return {
    tmdbId,
    id: `tmdb:${tmdbId}`,
    name: item?.title || item?.name || "",
    year: item?.release_year || item?.year || ""
  };
}

async function getCatalogue() {
  if (catalogueCache.expires > Date.now()) return catalogueCache.shows;
  if (cataloguePromise) return cataloguePromise;

  cataloguePromise = (async () => {
    try {
      const response = await fetch(MDBLIST_LIST_URL, {
        headers: { "Accept": "application/json", "User-Agent": "My-TV-Artwork/1.1" }
      });
      if (!response.ok) throw new Error(`MDBList feed returned HTTP ${response.status}`);
      const payload = await response.json();
      const unique = new Map();

      for (const item of extractItems(payload)) {
        const show = normalizeShow(item);
        if (show) unique.set(show.tmdbId, show);
      }

      // Keep the already-working custom entry present even if the feed omits it.
      if (!unique.has(95480)) {
        unique.set(95480, { tmdbId: 95480, id: "tmdb:95480", name: "Slow Horses" });
      }

      const shows = [...unique.values()];
      catalogueCache = { shows, expires: Date.now() + 10 * 60 * 1000 };
      console.log(`Loaded ${shows.length} series from MDBList.`);
      return shows;
    } catch (error) {
      console.error("MDBList catalogue refresh failed:", error);
      if (catalogueCache.shows.length) return catalogueCache.shows;
      return [{ tmdbId: 95480, id: "tmdb:95480", name: "Slow Horses" }];
    } finally {
      cataloguePromise = null;
    }
  })();

  return cataloguePromise;
}

async function getMeta(requestedId) {
  const match = String(requestedId).match(/^tmdb:(\d+)$/i);
  if (!match) throw new Error("Unsupported series ID.");

  const tmdbId = Number(match[1]);
  const shows = await getCatalogue();
  const listedShow = shows.find(show => show.tmdbId === tmdbId);
  const custom = CUSTOM_ARTWORK[tmdbId] || {};

  // Slow Horses remains available even if the MDBList feed is temporarily unavailable.
  if (!listedShow && tmdbId !== 95480) throw new Error("Series is not in the MDBList catalogue.");

  const cached = metaCache.get(tmdbId);
  if (cached && cached.expires > Date.now()) {
    return { ...cached.value, id: requestedId };
  }

  const show = await tmdb(`/tv/${tmdbId}?language=en-GB`);
  const seasons = (show.seasons || []).filter(season => season.season_number > 0);
  const seasonResults = await Promise.all(seasons.map(async season => {
    const data = await tmdb(`/tv/${tmdbId}/season/${season.season_number}?language=en-GB`);
    return { seasonNumber: season.season_number, episodes: data.episodes || [] };
  }));

  const videos = seasonResults.flatMap(({ seasonNumber, episodes }) =>
    episodes.map(episode => ({
      id: `tmdb:${tmdbId}:${seasonNumber}:${episode.episode_number}`,
      title: episode.name || `Episode ${episode.episode_number}`,
      season: seasonNumber,
      episode: episode.episode_number,
      number: episode.episode_number,
      released: episode.air_date ? `${episode.air_date}T00:00:00.000Z` : undefined,
      overview: episode.overview || "",
      thumbnail: episode.still_path
        ? `https://image.tmdb.org/t/p/w500${episode.still_path}`
        : undefined,
      seasonPoster: custom.seasonPosters?.[seasonNumber] || undefined
    }))
  );

  const meta = {
    id: `tmdb:${tmdbId}`,
    type: "series",
    name: show.name || listedShow?.name || "Unknown series",
    poster: custom.poster || (show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : undefined),
    posterShape: "poster",
    background: custom.background || (show.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}`
      : undefined),
    description: show.overview || "",
    releaseInfo: show.first_air_date ? show.first_air_date.slice(0, 4) : "",
    genres: (show.genres || []).map(genre => genre.name),
    app_extras: {
      seasonPosters: Object.fromEntries(
        Object.entries(custom.seasonPosters || {}).map(([season, poster]) => [String(season), poster])
      )
    },
    videos
  };

  metaCache.set(tmdbId, { value: meta, expires: Date.now() + 15 * 60 * 1000 });
  return { ...meta, id: requestedId };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = decodeURIComponent(url.pathname);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  if (path === "/health") return json(res, { ok: true, addon: manifest.name }, 0);
  if (path === "/manifest.json") return json(res, manifest, 3600);

  if (path === "/catalog/series/my-tv-shows.json") {
    const shows = await getCatalogue();
    return json(res, {
      metas: shows.map(show => {
        const custom = CUSTOM_ARTWORK[show.tmdbId] || {};
        return {
          id: show.id,
          type: "series",
          name: show.name || `TMDB series ${show.tmdbId}`,
          poster: custom.poster,
          posterShape: "poster",
          background: custom.background
        };
      })
    }, 300);
  }

  const match = path.match(/^\/meta\/series\/(.+)\.json$/);
  if (match) {
    try {
      return json(res, { meta: await getMeta(match[1]) }, 900);
    } catch (error) {
      console.error(error);
      return json(res, { meta: {}, error: error.message }, 30);
    }
  }

  return json(res, { error: "Not found" }, 0);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`My TV Artwork addon listening on port ${PORT}`);
});
