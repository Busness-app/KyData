# KyData

Progressive, force-directed architecture maps compiled to flat static HTML.

KyData turns a description of a software system into a single self-contained page: it opens on
the systems, and every node with a dashed outline opens up to reveal what is inside. The same
graph can be recoloured to show data flow, security posture, or where the load actually is.

Built for [KyPost](https://github.com/Yoshiofthewire), but the compiler knows nothing about
KyPost — point it at a different graph file and it renders that instead.

## Why it works this way

The hard part of an architecture diagram is not drawing it, it is keeping it true. So KyData
splits the fuzzy work from the mechanical work:

```
  extraction (AI, on demand)  →  graph JSON (committed)  →  compiler (deterministic)  →  dist/
```

The JSON in `data/` is the source of truth. It is plain, readable, and version-controlled, so a
refresh shows up as a reviewable diff rather than an opaque rebuild. The compiler is boring on
purpose: same input, same output, every time.

## Usage

```sh
npm install
npm run validate     # schema + semantic checks on the graph files
npm run build        # data/kypost.json -> dist/
npm run serve        # preview at http://localhost:4173
npm test
```

Build a different graph:

```sh
node src/build.js data/example.json --out dist-example
```

`dist/index.html` inlines its script, styles, and data, so it works when opened straight off
disk as well as when served. The only external files are the logo and the fonts.

## The graph format

Nodes are flat, with hierarchy by `parent` reference and depth by `level` (0 system, 1
subsystem, 2 component). Edges are authored between the most specific nodes that are genuinely
connected; when those nodes are collapsed, KyData lifts each edge onto the nearest visible
ancestor and merges whatever coincides. You describe a relationship once and it stays correct at
every zoom level.

```jsonc
{
  "meta": { "project": "KyPost", "generated": "2026-07-29", "repoBase": "https://github.com/..." },
  "nodes": [
    {
      "id": "server", "label": "KyPost Server", "level": 0, "parent": null,
      "kind": "service",            // service | client | module | datastore | external
      "language": "Go", "summary": "...", "repo": "kypost-server", "paths": ["backend/cmd"],
      "security":    { "attackSurface": "public", "encryption": "TLS", "handlesPii": true },
      "performance": { "hotPath": true, "latencyClass": "interactive" }
    }
  ],
  "edges": [
    {
      "from": "android", "to": "server", "kind": "api-call",
      "data": "what actually crosses this line", "sensitivity": "secret", "bidirectional": true
    }
  ]
}
```

`security` and `performance` are optional. Leaving them out renders the node neutral grey and
labels it "not assessed" — a gap you can see, rather than one that quietly reads as safe.

`schema/kydata.schema.json` is the full contract. `data/example.json` is a minimal graph using
every field.

## Keeping it current

Two skills drive this, so a refresh is one instruction rather than a chore:

- **`kydata-refresh`** re-reads the KyPost repos, rewrites `data/kypost.json`, rebuilds, shows
  you the diff, and publishes once you approve it.
- **`kydata-adopt`** retargets KyData at a different codebase: new graph, new palette, new
  README. The compiler is untouched.

## Theming

Two themes, matching the rest of KyPost: **Patina Ky** (dark) and **Polished Ky** (light).
Values are copied from `kypost-server/frontend/src/theme.ts`, and the CSS custom properties use
the same names as `kypost-site/css/styles.css` so the page can be dropped into that site without
restyling. The default follows `prefers-color-scheme`; the toggle persists to `localStorage`.

To retheme, edit `src/theme.js` — it is the only place colour is defined. The client assigns
classes and never computes a colour.

## Layout

The simulation runs in the browser so expansion animates outward, but it is seeded with
coordinates computed at build time. First paint is stable, settled, and identical on every load
instead of flying apart and reconverging while you are trying to read it. Under
`prefers-reduced-motion` the animation is skipped entirely and the settled layout is drawn
directly.

## Licence

AGPL-3.0-or-later. Fonts (Space Grotesk, IBM Plex Mono) are SIL OFL; see the licences alongside
them in `assets/fonts/`.
