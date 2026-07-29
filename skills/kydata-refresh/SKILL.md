---
name: kydata-refresh
description: Use when the KyPost architecture map is stale or the code has changed - re-reads the KyPost repos, rewrites the KyData graph, rebuilds the static site, and publishes it after review.
---

# Refreshing the KyPost architecture map

Re-extract the architecture from the KyPost repos into `data/kypost.json`, rebuild, and publish.

The graph is the deliverable, not the diagram. A wrong diagram is worse than a stale one, because
people believe it. Prefer leaving something out over guessing at it.

## Before you start

Work in the KyData repo. Confirm the KyPost repos are present and note where they are; the
default layout is siblings under `~/git/`:

`kypost-server`, `kypost-android`, `kypost-for-Mac`, `kypost-Linux`, `kypost-site`

## 1. Read the current graph first

Read `data/kypost.json` before reading any source. You are editing an existing description, not
writing a new one. Two things must survive:

- **`id` values.** They are how the diff stays readable and how deep links in the wild keep
  working. Never renumber or rename an id to tidy it up. If a component genuinely disappears,
  remove its node and its edges.
- **Hand-written `summary` prose.** Someone chose those words. Only rewrite a summary when the
  thing it describes has actually changed.

Also read `schema/kydata.schema.json` so you know the exact allowed values.

## 2. Extract

For each repo, in this order of trust:

1. `README.md` and `AGENTS.md` — the maintainers' own description of the architecture
2. `docs/*.md` — protocol and design docs
3. Directory structure — module and package boundaries
4. Route registration and handler files — the real API surface

Aim for **level 0** (one node per repo, plus external systems that are genuinely part of the
picture) and **level 1** (subsystems within each). Go to level 2 only where a subsystem is large
enough that its internals are a real question.

For every node, fill in `security` and `performance` **only where you have evidence**. Absent is
a valid, meaningful answer that renders as "not assessed". Inventing a reassuring
`attackSurface: "internal"` is the single most damaging thing you can do here.

For every edge, say what actually crosses it in `data`, and classify `sensitivity`. Authored
edges should connect the most specific nodes that are really connected — KyData lifts them to
whatever level is on screen, so do not also add a coarse duplicate at level 0.

## 3. Record provenance

Update `meta.generated` to today's date and `meta.commits` to each repo's current short SHA:

```sh
git -C ../kypost-server rev-parse --short HEAD
```

This is what lets a reader tell whether the map predates the change they are looking for.

## 4. Build

```sh
npm run validate && npm test && npm run build
```

Validation catches dangling edges, missing parents, bad levels, and cycles — the failures an
extraction pass actually produces. Fix them in the data, never by loosening the schema.

## 5. Check the result

```sh
npm run serve
```

Confirm the macro view settles cleanly, each system expands, and the security view has no node
coloured green that should not be.

Then **spot-check ten claims against the source**. Pick the ones that would embarrass you if
wrong: anything asserting encryption, anything asserting what a component cannot see, anything
claiming a credential does not leave the server. Follow each to the actual code.

## 6. Show the diff and stop

```sh
git diff --stat data/kypost.json
git diff data/kypost.json
```

Summarise what changed structurally — nodes added or removed, relationships that moved — and
call out anything you inferred rather than read. Then **stop and ask** before publishing.

Publishing is outward-facing and hard to walk back. Do not push because the build passed.

## 7. Publish, once approved

```sh
git add data/kypost.json && git commit && npm run publish
```

`npm run publish` builds and pushes `dist/` to the `gh-pages` branch. Report the live URL.
