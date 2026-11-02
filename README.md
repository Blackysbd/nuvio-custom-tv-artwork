# My TV Artwork — Nuvio addon

A small Stremio-protocol addon that publishes a single home-screen TV row for **Slow Horses** (TMDB series ID 95480).

## Artwork and metadata
- Custom series poster and fanart are served from the supplied Postimages links.
- TMDB supplies the series description, genres, season list and episode information.
- The addon includes a `seasonPoster` field on episode records as an experimental Nuvio-specific extension. The public Stremio protocol does not define this field, and I have not yet verified that your installed Nuvio build reads it. The season artwork may therefore require a further app-specific adjustment after testing.
- The addon does not provide video streams. Your existing stream addons remain responsible for playback.

## Deploy on Render
1. In Render, choose **New → Web Service** and connect this repository.
2. Use the settings in `render.yaml` (build: `npm install`, start: `npm start`).
3. Add an environment variable named `TMDB_API_KEY` containing your TMDB v3 API key. Keep it private; do not commit it to GitHub.
4. Deploy. Render will provide a service URL such as `https://your-service-name.onrender.com`.

## Install in Nuvio
Add this URL in **Settings → Addons**:

`https://YOUR-SERVICE-NAME.onrender.com/manifest.json`

The addon publishes a catalogue row named **My TV Shows**.

## Endpoints
- `/manifest.json`
- `/catalog/series/my-tv-shows.json`
- `/meta/series/tmdb:95480.json`
- `/health`

Metadata is cached in memory for 15 minutes.
