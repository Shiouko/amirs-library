# Amir's Library

A personal anime / manga / manhwa / manhua tracking shelf. Not a SaaS, not a
marketing site — the page opens straight onto the library: a manga-chapter
masthead, a stats strip, filters, and a card grid. Clicking a card opens a full
detail view. 100% static; the single source of truth is `data/library.json`,
fetched at load.

**Live URL:** https://amirs-library.pages.dev

## How updates work

Amir reports progress ("finished ch. 120 of X") and the maintainer (Liora)
edits `data/library.json` via the helper CLI below, then commits and redeploys.
There is no client-side editing, no localStorage, no backend.

```bash
# record progress (appends a history entry dated today, +08:00)
python3 scripts/library_update.py progress --id al-2 --value 365 --note "caught up"

# change status (completed auto-sets completedAt); optional score 0-10
python3 scripts/library_update.py status --id al-2 --status completed --score 10

# add a brand-new entry (full JSON object)
python3 scripts/library_update.py add --json '{"id":"al-21","type":"manga","title":"Death Note","progressLabel":"Ch.","status":"reading","progressCurrent":1}'

# list the shelf
python3 scripts/library_update.py list
```

The script is stdlib-only, writes atomically (temp file + rename), and keeps
the JSON pretty-printed (2-space indent, `ensure_ascii=False` so JP/KR titles
stay readable). Every mutation bumps `meta.lastUpdated` and the entry's
`updatedAt`.

## Data schema — `data/library.json`

```json
{
  "meta": { "owner": "Amir Hafizi", "lastUpdated": "…+08:00", "schemaVersion": 1 },
  "entries": [ { … } ]
}
```

### Entry fields

| Field | Type | Required | Example | Notes |
|---|---|---|---|---|
| `id` | string | ✅ | `"al-2"` | `al-<anilistId>` or `custom-<n>` |
| `type` | string | ✅ | `"manga"` | `anime` / `manga` / `manhwa` / `manhua` |
| `title` | string | ✅ | `"Berserk"` | Display title |
| `altTitles` | string[] | optional | `["ベルセルク"]` | Alt / native names |
| `coverUrl` | string | optional | `"https://s4.anilist.co/…/bx2.jpg"` | Cover image; falls back to a glyph tile |
| `anilistId` | int/null | optional | `2` | Powers the AniList link |
| `malId` | int/null | optional | `2` | Powers the MAL link |
| `status` | string | ✅ | `"reading"` | `reading` / `completed` / `plan` / `paused` / `dropped` |
| `progressCurrent` | int | ✅ | `364` | Chapters/episodes consumed |
| `progressTotal` | int/null | optional | `179` | `null` when ongoing/unknown |
| `progressLabel` | string | ✅ | `"Ch."` | `"Ch."` for print, `"Ep."` for anime |
| `score` | number/null | optional | `9.5` | 1–10, decimals allowed |
| `genres` | string[] | optional | `["Action","Fantasy"]` | |
| `synopsis` | string | optional | `"…"` | Clamped with a "Read more" toggle if >300 chars |
| `year` | int/null | optional | `1989` | Start year |
| `format` | string | optional | `"Manga"` | `Manga` / `TV` / `Manhwa` … |
| `authors` | string[] | optional | `["Kentarou Miura"]` | |
| `startedAt` | string/null | optional | `"2025-11-15"` | `YYYY-MM-DD` |
| `completedAt` | string/null | optional | `"2026-05-18"` | `YYYY-MM-DD` |
| `notes` | string | optional | `""` | Free text, shown if non-empty |
| `history` | object[] | optional | see below | Append-only progress log |
| `addedAt` | string | optional | `"2025-11-15"` | |
| `updatedAt` | string | optional | `"2026-07-28"` | |

**History entry:** `{ "date": "2026-07-30", "progress": 120, "note": "" }` —
newest last in the file; the UI renders it newest-first as a timeline and uses
it for the "this month" stat.

## Local development

The app fetches `data/library.json`, so opening `index.html` via `file://` will
fail (CORS). Serve over HTTP instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Design system

- **Theme:** light manga-paper (`#FAF7F2`) + ruby accent (`#E0115F` / `#9B111E`).
- **Fonts:** Bebas Neue (display), Zen Kaku Gothic New (body), Shippori Mincho (decorative JP).
- **Hard rules:** zero border-radius everywhere; 3px ink borders on panels, 2px on cards;
  offset solid shadows only (no blur); flat fills, no gradients; halftone dot texture;
  caption strips on ruby-dark; `prefers-reduced-motion` disables all animation.
- **Type badges:** ANIME ア (ruby-dark), MANGA 漫 (ink), MANHWA 만 (steel blue), MANHUA 漫 (bronze).
- **Status treatments:** reading (ruby underline), completed (matcha ribbon),
  plan (dashed amber box), paused (slate), dropped (grayscale cover).

## Structure

```
amirs-library/
├── index.html          # SPA shell
├── css/styles.css      # Design system + components
├── js/app.js           # Router, data loading, rendering, interactions
├── data/library.json   # THE data file (ships empty)
├── assets/favicon.svg  # Ruby book mark, sharp edges
├── scripts/library_update.py  # Update CLI
└── README.md
```
