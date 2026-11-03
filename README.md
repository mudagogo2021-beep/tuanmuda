# Tuan Muda — landing page

Static GitHub Pages site. `index.html` renders every project from **`projects.json`** in the browser.

## Add a project
Append one object to the array in `projects.json`:

```json
{"title": "My new thing", "category": "maps", "url": "https://...", "image": "img/thing.jpg", "date": "2026-11", "description": "One line."}
```

- `category`: `videos`, `shorts`, `books`, `maps`, `3d`, or `shop`.
- `url`: optional. Leave it `""` if there isn't a verified link yet, and the card shows without one.
- `image`: optional. Use a path under `img/` or a full URL.
- Optional extras: `meta` (a small gold line, e.g. a price), `featured: true` (a big banner card, maps only), `short: true` (marks a YouTube Short).

Keep the JSON valid: commas between entries, no trailing comma.
Preview locally with `python3 -m http.server`, because `fetch` won't work from `file://`.
The old static page is kept as `index.old.html`.
