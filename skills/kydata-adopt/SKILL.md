---
name: kydata-adopt
description: Use when pointing KyData at a codebase other than KyPost - generates a graph for the new project, retargets the theme and branding, and produces a working architecture map in one pass.
---

# Adopting KyData for another project

Retarget KyData at a different codebase. The compiler, schema, and client are generic and must
not be modified — everything project-specific lives in three places: the graph file, the theme
tokens, and the README.

If you find yourself editing `src/graph.js`, `src/emit.js`, or `src/app/main.js` to make a
project fit, stop. Either the schema genuinely needs extending for everyone, or the graph is
being described wrongly.

## 1. Survey the target

Establish, before writing any JSON:

- What are the deployable units? Each becomes a **level 0** node.
- What external systems does it depend on that a reader would ask about? Also level 0, with
  `kind: "external"`.
- Within each unit, what are the subsystems someone would need to know to navigate the code?
  Those are **level 1**.

Read `README`, `AGENTS.md`, and any docs first — a maintainer's own account beats a directory
listing. Fall back to package and module boundaries where there is no prose.

## 2. Write the graph

Create `data/<project>.json` following `schema/kydata.schema.json`. Use `data/example.json` as
the shape reference; it exercises every field.

Guidance that matters more than completeness:

- **Ids are permanent.** Choose them as if people will link to them, because they will.
  Lowercase, dotted, mirroring the hierarchy: `api`, `api.auth`, `api.store`.
- **Author edges at the most specific level that is true.** KyData lifts an edge to whichever
  ancestor is on screen and merges duplicates, so one honest edge is correct at every zoom.
  Adding a coarse level-0 edge alongside it produces a double-counted line.
- **Fill `security` and `performance` only from evidence.** Omitting them renders "not assessed",
  which is honest. A confident wrong claim about encryption is the worst output this tool can
  produce.
- **`summary` is prose someone will read.** One or two plain sentences on what the thing is for,
  not a restatement of its name.

Set `meta.project`, `meta.tagline`, `meta.generated`, `meta.repoBase` (the GitHub org or user
URL), and `meta.commits` for provenance.

## 3. Retheme

Edit `src/theme.js`. It holds two theme objects and is the only place colour is defined — the
client assigns CSS classes and never computes a colour.

Replace the eight base tokens (`bg`, `panel`, `ink`, `ink-strong`, `accent`, `accent-soft`,
`line`, `glow`) plus `edge` with the target project's palette. If the project has an existing
stylesheet or design tokens, copy the values rather than approximating them.

Leave the semantic tokens (`kind-*`, `surface-*`, `sens-*`, `lat-*`) alone unless they clash —
they carry meaning, not brand, and they are tuned for contrast against both backgrounds. If you
do change them, keep red for internet-facing and check contrast against `bg` in both themes.

Swap `assets/ky.png` for the project's mark, keeping the filename or updating both references in
`src/emit.js`.

## 4. Wire it up

Point the default build at the new graph in `package.json`:

```json
"build": "node src/build.js data/<project>.json",
"validate": "node src/validate.js data/<project>.json data/example.json"
```

## 5. Verify

```sh
npm run validate && npm test && npm run build && npm run serve
```

Check that the macro view settles without jitter, every system expands, the four view modes each
say something different, and both themes are legible. Open `dist/index.html` directly from disk
too — it must work with no server.

## 6. Rewrite the README

Update `README.md` for the new project: what it maps, how to rebuild, where the graph lives.
Keep the "Why it works this way" section — the extraction/JSON/compiler split is the reason the
tool stays honest, and the next person needs to know it.

Leave the AGPL-3.0 licence in place.
