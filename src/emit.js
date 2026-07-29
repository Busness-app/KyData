/**
 * Emits the finished page.
 *
 * Everything is inlined — script, stylesheet, graph, and seed positions — so dist/index.html
 * works when opened straight off disk as well as when served by GitHub Pages. That constraint
 * is the whole point of the project: no server, no fetch, no CDN.
 */

import { themeCss } from "./theme.js";

export function renderHtml({ graph, seeds, js, css, fontCss }) {
  const title = `${graph.meta.project} architecture`;
  const description = graph.meta.tagline ?? `An interactive map of the ${graph.meta.project} architecture.`;
  const repos = Object.entries(graph.meta.commits ?? {});

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="icon" href="assets/ky.png">
<style>
${fontCss}

${themeCss()}

${css}
</style>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <img src="assets/ky.png" alt="">
    <span>${esc(graph.meta.project)}<small>architecture</small></span>
  </div>

  <div class="views" role="tablist" aria-label="View mode">
    <button data-view="architecture" role="tab" aria-selected="true">Architecture</button>
    <button data-view="flow" role="tab" aria-selected="false">Data flow</button>
    <button data-view="security" role="tab" aria-selected="false">Security</button>
    <button data-view="performance" role="tab" aria-selected="false">Performance</button>
  </div>

  <div class="tools">
    <input id="search" type="search" placeholder="Search components…" aria-label="Search components">
    <button id="reset">Reset</button>
    <button id="theme-toggle">Polished Ky</button>
  </div>
</header>

<main class="stage">
  <div class="canvas">
    <svg id="graph" role="application" aria-label="${esc(title)} graph"></svg>

    <div class="legend">
      ${legendKeys()}
    </div>

    <p id="hint" class="hint"></p>
  </div>

  <aside id="panel" class="panel" aria-live="polite"></aside>
</main>

<footer hidden>
  <p>Generated ${esc(graph.meta.generated)} from ${repos.map(([r, sha]) => `${esc(r)}@${esc(sha)}`).join(", ")}</p>
</footer>

<script id="kydata-graph" type="application/json">${jsonScript(graph)}</script>
<script id="kydata-seeds" type="application/json">${jsonScript(seeds)}</script>
<script>
${js}
</script>
</body>
</html>
`;
}

function legendKeys() {
  const keys = [
    ["architecture", "kind-service", "Service"],
    ["architecture", "kind-client", "Client"],
    ["architecture", "kind-module", "Module"],
    ["architecture", "kind-datastore", "Datastore"],
    ["architecture", "kind-external", "External"],

    ["flow", "accent", "Request / data"],
    ["flow", "lat-realtime", "Push"],

    ["security", "surface-public", "Internet-facing"],
    ["security", "surface-paired", "Paired devices only"],
    ["security", "surface-internal", "Internal only"],
    ["security", "sens-e2ee", "End-to-end encrypted"],
    ["security", "surface-unknown", "Not assessed"],

    ["performance", "lat-realtime", "Realtime"],
    ["performance", "lat-interactive", "Interactive"],
    ["performance", "lat-batch", "Batch"],
    ["performance", "lat-unknown", "Not assessed"]
  ];

  return keys
    .map(([view, token, label]) => {
      // External systems are drawn hollow in the graph, so the legend has to be hollow too.
      const outline = token === "kind-external" ? " outline" : "";
      return `<span class="key for-${view}"><i class="swatch${outline}" style="--sw: var(--${token})"></i>${esc(
        label
      )}</span>`;
    })
    .join("\n    ");
}

/**
 * `</script>` anywhere in the data would close the tag early, so neutralise it. The rest is
 * already inert because it sits in a non-executable JSON script block.
 */
function jsonScript(value) {
  return JSON.stringify(value).replace(/<\/(script)/gi, "<\\/$1");
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
