import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const SHOW = {
  tmdbId: 95480,
  id: "tmdb:95480",
  name: "Slow Horses",
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
};

const manifest = {
  id: "uk.blackysbd.nuvio.customtvartwork",
  version: "1.0.0",
  name: "My TV Artwork",
  description: "A personal TV catalogue with custom show and season artwork.",
  resources: ["catalog", "meta"],
  types: ["series"],
  idPrefixes: ["tmdb:", "tt"],
  catalogs: [{ type: "series", id: "my-tv-shows", name: "My TV Shows" }],
  behaviorHints: { configurable: false, configurationRequired: false }
};

const cache = new Map();

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

async function getMeta(requestedId = SHOW.id) {
  const cached = cache.get("show");
  if (cached && cached.expires > Date.now()) return cached.value;

  const [show, externalIds] = await Promise.all([
    tmdb(`/tv/${SHOW.tmdbId}?language=en-GB`),
    tmdb(`/tv/${SHOW.tmdbId}/external_ids`)
  ]);

  const seasons = (show.seasons || []).filter(s => s.season_number > 0);
  const seasonResults = await Promise.all(seasons.map(async season => {
    const data = await tmdb(`/tv/${SHOW.tmdbId}/season/${season.season_number}?language=en-GB`);
    return { seasonNumber: season.season_number, episodes: data.episodes || [] };
  }));

  const videos = seasonResults.flatMap(({ seasonNumber, episodes }) =>
    episodes.map(episode => {
      const id = `tmdb:${SHOW.tmdbId}:${seasonNumber}:${episode.episode_number}`;
      return {
        id,
        title: episode.name || `Episode ${episode.episode_number}`,
        season: seasonNumber,
        episode: episode.episode_number,
        number: episode.episode_number,
        released: episode.air_date ? `${episode.air_date}T00:00:00.000Z` : undefined,
        overview: episode.overview || "",
        thumbnail: episode.still_path
          ? `https://image.tmdb.org/t/p/w500${episode.still_path}`
          : undefined,
        // Nuvio reads this addon-specific field on episode metadata to use the season's artwork.
        seasonPoster: SHOW.seasonPosters[seasonNumber] || undefined
      };
    })
  );

  const imdbId = externalIds.imdb_id ? externalIds.imdb_id.toLowerCase() : null;
  const normalizedRequestedId = requestedId.toLowerCase();
  if (normalizedRequestedId !== SHOW.id && normalizedRequestedId !== imdbId) {
    throw new Error("Unsupported series ID.");
  }

  const meta = {
    id: requestedId,
    type: "series",
    name: SHOW.name,
    poster: SHOW.poster,
    posterShape: "poster",
    background: SHOW.background,
    description: show.overview || "",
    releaseInfo: show.first_air_date ? show.first_air_date.slice(0, 4) : "",
    genres: (show.genres || []).map(g => g.name),
    // Nuvio mobile reads this keyed map for the season selector artwork.
    app_extras: {
      seasonPosters: Object.fromEntries(
        Object.entries(SHOW.seasonPosters).map(([season, poster]) => [String(season), poster])
      )
    },
    videos
  };

  cache.set("show", { value: meta, expires: Date.now() + 15 * 60 * 1000 });
  return meta;
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
    return json(res, {
      metas: [{
        id: SHOW.id,
        type: "series",
        name: SHOW.name,
        poster: SHOW.poster,
        posterShape: "poster",
        background: SHOW.background
      }]
    });
  }

  const match = path.match(/^\/meta\/series\/(.+)\.json$/);
  if (match) {
    const requestedId = match[1];
    if (requestedId !== SHOW.id && !/^tt\d+$/i.test(requestedId)) {
      return json(res, { meta: {} }, 60);
    }
    try {
      return json(res, { meta: await getMeta(requestedId) }, 900);
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
