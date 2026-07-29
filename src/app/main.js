/**
 * KyData client.
 *
 * Renders the graph as SVG driven by a live d3-force simulation. All colour lives in CSS —
 * this file only assigns classes — so the four view modes and the two themes are a stylesheet
 * concern rather than a rendering one.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY
} from "d3-force";

import { polygonHull } from "d3-polygon";

import { buildIndex, computeVisible, hasChildren } from "../graph.js";
import { radiusFor, WIDTH, HEIGHT } from "../layout.js";

const GRAPH = JSON.parse(document.getElementById("kydata-graph").textContent);
const SEEDS = JSON.parse(document.getElementById("kydata-seeds").textContent);
const INDEX = buildIndex(GRAPH);

const VIEWS = ["architecture", "flow", "security", "performance"];
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  expanded: new Set(),
  view: "architecture",
  selected: null,
  hovered: null,
  query: ""
};

/** Live node objects, kept across re-renders so positions and velocities survive expansion. */
const live = new Map();

/** The currently displayed set, so a resize can refit without waiting for the next tick. */
let currentNodes = [];

let sim = null;
let render = () => {};

// ---------------------------------------------------------------- element setup

const svg = document.getElementById("graph");
const gHulls = svgEl("g", { class: "hulls" });
const gLinks = svgEl("g", { class: "links" });
const gArrows = svgEl("g", { class: "arrows" });
const gLabels = svgEl("g", { class: "edge-labels" });
const gNodes = svgEl("g", { class: "nodes" });
const viewport = svgEl("g", { class: "viewport" });
viewport.append(gHulls, gLinks, gArrows, gLabels, gNodes);
svg.append(viewport);

/**
 * The simulation runs in a fixed virtual space (WIDTH x HEIGHT) while the viewBox tracks the
 * element's real pixel size. Without this the graph is letterboxed into a strip on any viewport
 * whose aspect ratio differs from the virtual one — which on a phone is most of the screen.
 */
const view = { w: WIDTH, h: HEIGHT };

function measure() {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  view.w = rect.width;
  view.h = rect.height;
  svg.setAttribute("viewBox", `0 0 ${view.w} ${view.h}`);
}

/**
 * The simulation space keeps the area of the virtual canvas (so the tuned force constants stay
 * meaningful) but takes the aspect ratio of the actual viewport. Scaling a wide layout down to
 * fit a tall phone screen leaves it stranded in a thin band; giving the simulation the right
 * shape to begin with lets it settle into the space that is actually there.
 */
const sim2d = { w: WIDTH, h: HEIGHT };

function measureSimSpace() {
  const area = WIDTH * HEIGHT;
  const aspect = Math.max(view.w / view.h, 0.2);
  sim2d.h = Math.sqrt(area / aspect);
  sim2d.w = aspect * sim2d.h;
}

measure();
measureSimSpace();

let lastAspect = view.w / view.h;
new ResizeObserver(() => {
  measure();
  const aspect = view.w / view.h;
  // Re-settling is disruptive, so only redo the layout when the shape really changed.
  if (Math.abs(aspect - lastAspect) / lastAspect > 0.15) {
    lastAspect = aspect;
    measureSimSpace();
    rebuild();
  } else {
    fitViewport(currentNodes);
  }
}).observe(svg);

const panel = document.getElementById("panel");
const searchInput = document.getElementById("search");
const hint = document.getElementById("hint");

// ---------------------------------------------------------------- simulation

function nodeFor(spec) {
  let node = live.get(spec.id);
  if (!node) {
    // Seeds are authored in the virtual canvas; map them into the current simulation space.
    const seed = SEEDS[spec.id] ?? { x: WIDTH / 2, y: HEIGHT / 2 };
    node = { ...spec, x: (seed.x / WIDTH) * sim2d.w, y: (seed.y / HEIGHT) * sim2d.h };
    live.set(spec.id, node);
  } else {
    Object.assign(node, spec, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
  }
  return node;
}

function rebuild() {
  const { nodes: specs, links } = computeVisible(GRAPH, INDEX, state.expanded);
  const nodes = specs.map(nodeFor);
  currentNodes = nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // d3-force mutates link endpoints into object references; keep our own copies clean.
  const simLinks = links.map((l) => ({ ...l, source: byId.get(l.source), target: byId.get(l.target) }));

  sim?.stop();
  sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink(simLinks)
        .id((d) => d.id)
        .distance((d) => (d.source.level === 0 && d.target.level === 0 ? 190 : 110))
        .strength(0.35)
    )
    .force("charge", forceManyBody().strength((d) => (d.level === 0 ? -1500 : -900)))
    // Labels sit under the circles and are far wider than them, so reserve room for text.
    .force("collide", forceCollide().radius((d) => radiusFor(d.level) + 30))
    .force("center", forceCenter(sim2d.w / 2, sim2d.h / 2))
    .force("x", forceX(sim2d.w / 2).strength(0.04))
    .force("y", forceY(sim2d.h / 2).strength(0.06))
    // Without this, a node's children drift off among unrelated nodes and the expansion
    // reads as noise rather than as "here is what is inside this thing". Kept weak so it
    // groups without collapsing the children into a pile on top of the parent. Collision
    // handles the spacing, so this can be firm enough to keep hulls tight and separate.
    .force("parent", forceParent(byId, 0.3));

  draw(nodes, simLinks);

  if (REDUCED) {
    // No animation: jump straight to the settled layout.
    sim.stop();
    sim.tick(300);
    tick(nodes, simLinks);
  } else {
    sim.alpha(0.7).restart();
    sim.on("tick", () => tick(nodes, simLinks));
  }

  render = () => applyEmphasis(nodes, simLinks);
  render();
}

/** Custom force: hold expanded children in orbit around the node they belong to. */
function forceParent(byId, strength) {
  let nodes = [];

  function force(alpha) {
    for (const node of nodes) {
      if (node.parent == null) continue;
      const parent = byId.get(node.parent);
      if (!parent) continue;
      node.vx += (parent.x - node.x) * strength * alpha;
      node.vy += (parent.y - node.y) * strength * alpha;
    }
  }

  force.initialize = (n) => {
    nodes = n;
  };
  return force;
}

// ---------------------------------------------------------------- drawing

const nodeEls = new Map();
const linkEls = new Map();

function draw(nodes, links) {
  syncPool(linkEls, links, gLinks, (link) => {
    const g = svgEl("g");
    g.append(svgEl("path", { class: "link-line" }));
    return g;
  });

  syncPool(nodeEls, nodes, gNodes, (node) => {
    const g = svgEl("g", { class: "node", tabindex: "0", role: "button" });
    g.append(
      svgEl("circle", { class: "node-halo" }),
      svgEl("circle", { class: "node-dot" }),
      svgEl("text", { class: "node-label" }),
      svgEl("text", { class: "node-toggle" })
    );
    bindNode(g, node);
    return g;
  });

  for (const link of links) {
    const g = linkEls.get(link.id);
    g.setAttribute(
      "class",
      [
        "link",
        `kind-${link.kind}`,
        link.sensitivity ? `sens-${link.sensitivity}` : "sens-unknown",
        link.hotPath ? "hot" : "",
        link.both ? "both" : ""
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  for (const node of nodes) {
    const g = nodeEls.get(node.id);
    const expandable = hasChildren(INDEX, node.id);

    g.setAttribute(
      "class",
      [
        "node",
        `level-${node.level}`,
        `kind-${node.kind}`,
        `surface-${node.security?.attackSurface ?? "unknown"}`,
        `lat-${node.performance?.latencyClass ?? "unknown"}`,
        node.performance?.hotPath ? "hot" : "",
        expandable ? "expandable" : "",
        state.expanded.has(node.id) ? "open" : ""
      ]
        .filter(Boolean)
        .join(" ")
    );

    const r = radiusFor(node.level);
    g.querySelector(".node-dot").setAttribute("r", r);
    g.querySelector(".node-halo").setAttribute("r", r + 7);

    const label = g.querySelector(".node-label");
    label.textContent = node.label;
    label.setAttribute("y", r + 16);

    const toggle = g.querySelector(".node-toggle");
    toggle.textContent = expandable ? (state.expanded.has(node.id) ? "−" : "+") : "";
    toggle.setAttribute("y", 1);

    g.setAttribute("aria-label", ariaFor(node, expandable));
    g.setAttribute("aria-expanded", expandable ? String(state.expanded.has(node.id)) : "");
  }

  hint.textContent = state.expanded.size
    ? "Click an open node to collapse it."
    : "Click any node to open it up.";
}

/** Create, reuse, and retire elements so expansion doesn't rebuild the whole DOM. */
function syncPool(pool, items, parent, make) {
  const wanted = new Set(items.map((i) => i.id));
  for (const [id, el] of pool) {
    if (!wanted.has(id)) {
      el.remove();
      pool.delete(id);
    }
  }
  for (const item of items) {
    if (!pool.has(item.id)) {
      const el = make(item);
      el.dataset.id = item.id;
      pool.set(item.id, el);
      parent.append(el);
    }
  }
}

function tick(nodes, links) {
  for (const node of nodes) {
    node.x = clamp(node.x, 60, sim2d.w - 60);
    node.y = clamp(node.y, 50, sim2d.h - 50);
    nodeEls.get(node.id)?.setAttribute("transform", `translate(${node.x} ${node.y})`);
  }

  const arrows = [];
  const labels = [];

  for (const link of links) {
    const { source: a, target: b } = link;
    const g = linkEls.get(link.id);
    if (!g) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    // Stop the line at the circle edge so arrowheads sit against the node, not under it.
    const ar = radiusFor(a.level) + 2;
    const br = radiusFor(b.level) + 2;
    const x1 = a.x + ux * ar;
    const y1 = a.y + uy * ar;
    const x2 = b.x - ux * br;
    const y2 = b.y - uy * br;

    g.querySelector(".link-line").setAttribute("d", `M${x1} ${y1}L${x2} ${y2}`);

    arrows.push({ id: `${link.id}>`, cls: g.getAttribute("class"), x: x2, y: y2, ux, uy });
    if (link.both) {
      arrows.push({ id: `${link.id}<`, cls: g.getAttribute("class"), x: x1, y: y1, ux: -ux, uy: -uy });
    }
    labels.push({ id: link.id, text: link.label, x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
  }

  paintArrows(arrows);
  paintEdgeLabels(labels);
  paintHulls(nodes);
  fitViewport(nodes);
}

/**
 * A soft outline around each opened node and its children. The force layout alone doesn't make
 * containment obvious — once several branches are open, "which of these belong together?" is
 * the first question, and a shape answers it faster than proximity does.
 */
const hullEls = new Map();
function paintHulls(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hulls = [];

  for (const id of state.expanded) {
    const parent = byId.get(id);
    if (!parent) continue;

    const members = [parent, ...(INDEX.children.get(id) ?? []).map((c) => byId.get(c))].filter(Boolean);
    if (members.length < 2) continue;

    hulls.push({ id, d: hullPath(members) });
  }

  syncPool(hullEls, hulls, gHulls, () => svgEl("path", { class: "hull" }));
  for (const h of hulls) hullEls.get(h.id).setAttribute("d", h.d);
}

function hullPath(members) {
  const pad = 26;
  // Sample around each node so the hull wraps circles rather than cutting through them.
  const points = [];
  for (const m of members) {
    const r = radiusFor(m.level) + pad;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      points.push([m.x + Math.cos(a) * r, m.y + Math.sin(a) * r]);
    }
  }

  const hull = polygonHull(points);
  if (!hull) return "";

  // Round the corners so the shape reads as a soft region, not a polygon: start at the
  // midpoint of the closing edge, then curve through each vertex to the next midpoint.
  const n = hull.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  const start = mid(hull[n - 1], hull[0]);
  let d = `M${start[0]} ${start[1]}`;
  for (let i = 0; i < n; i++) {
    const vertex = hull[i];
    const to = mid(hull[i], hull[(i + 1) % n]);
    d += `Q${vertex[0]} ${vertex[1]} ${to[0]} ${to[1]}`;
  }

  return `${d}Z`;
}

/**
 * Keep the whole graph framed as it settles and as branches open. Without this, expanding a
 * node pushes its children off the edge of the canvas, and the macro view floats in a corner
 * of whatever aspect ratio the window happens to be.
 */
function fitViewport(nodes) {
  if (!nodes.length) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    const r = radiusFor(n.level);
    minX = Math.min(minX, n.x - r);
    maxX = Math.max(maxX, n.x + r);
    minY = Math.min(minY, n.y - r);
    // Labels hang below the circle, so reserve room for them.
    maxY = Math.max(maxY, n.y + r + 20);
  }

  // Tight viewports can't afford a wide margin.
  const pad = Math.min(90, Math.max(16, Math.min(view.w, view.h) * 0.08));
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const availW = view.w - pad * 2;
  const availH = view.h - pad * 2;

  // Never magnify past 1.2, or a two-node view turns into absurdly large circles.
  const scale = Math.min(availW / bw, availH / bh, 1.2);

  const tx = pad + (availW - bw * scale) / 2 - minX * scale;
  const ty = pad + (availH - bh * scale) / 2 - minY * scale;

  viewport.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
}

const arrowEls = new Map();
function paintArrows(arrows) {
  syncPool(arrowEls, arrows, gArrows, () => svgEl("path", { class: "arrow" }));
  for (const a of arrows) {
    const el = arrowEls.get(a.id);
    const size = 7;
    // Triangle pointing along (ux, uy), with the tip at the node edge.
    const nx = -a.uy;
    const ny = a.ux;
    const bx = a.x - a.ux * size;
    const by = a.y - a.uy * size;
    el.setAttribute(
      "d",
      `M${a.x} ${a.y}L${bx + nx * size * 0.5} ${by + ny * size * 0.5}` +
        `L${bx - nx * size * 0.5} ${by - ny * size * 0.5}Z`
    );
    el.setAttribute("class", a.cls.replace("link", "arrow"));
  }
}

const edgeLabelEls = new Map();
function paintEdgeLabels(labels) {
  syncPool(edgeLabelEls, labels, gLabels, () => svgEl("text", { class: "edge-label" }));
  for (const l of labels) {
    const el = edgeLabelEls.get(l.id);
    el.textContent = l.text ?? "";
    el.setAttribute("x", l.x);
    el.setAttribute("y", l.y - 5);
  }
}

// ---------------------------------------------------------------- emphasis

/**
 * Dim everything not related to the node under the cursor, and mark search hits. This is the
 * whole reason the graph stays readable once a few branches are open.
 */
function applyEmphasis(nodes, links) {
  // A focus left pointing at a node that has since been collapsed would dim the entire graph
  // with nothing lit up, so fall back to no focus.
  const candidate = state.hovered ?? state.selected;
  const focus = nodes.some((n) => n.id === candidate) ? candidate : null;
  const related = new Set();

  if (focus) {
    related.add(focus);
    for (const link of links) {
      if (link.source.id === focus) related.add(link.target.id);
      if (link.target.id === focus) related.add(link.source.id);
    }
  }

  const q = state.query.trim().toLowerCase();

  svg.classList.toggle("focused", Boolean(focus));
  svg.classList.toggle("searching", q.length > 0);

  for (const node of nodes) {
    const el = nodeEls.get(node.id);
    el.classList.toggle("related", related.has(node.id));
    el.classList.toggle("focus", node.id === focus);
    el.classList.toggle("match", q.length > 0 && matches(node, q));
  }

  for (const link of links) {
    const el = linkEls.get(link.id);
    const on = focus ? link.source.id === focus || link.target.id === focus : false;
    el.classList.toggle("related", on);
    arrowEls.get(`${link.id}>`)?.classList.toggle("related", on);
    arrowEls.get(`${link.id}<`)?.classList.toggle("related", on);
    edgeLabelEls.get(link.id)?.classList.toggle("related", on);
  }
}

function matches(node, q) {
  return (
    node.label.toLowerCase().includes(q) ||
    node.id.toLowerCase().includes(q) ||
    (node.language ?? "").toLowerCase().includes(q) ||
    (node.summary ?? "").toLowerCase().includes(q) ||
    (node.paths ?? []).some((p) => p.toLowerCase().includes(q))
  );
}

// ---------------------------------------------------------------- interaction

function bindNode(g, node) {
  g.addEventListener("pointerenter", () => {
    state.hovered = node.id;
    showPanel(node.id);
    render();
  });
  g.addEventListener("pointerleave", () => {
    state.hovered = null;
    render();
  });
  g.addEventListener("focus", () => {
    state.hovered = node.id;
    showPanel(node.id);
    render();
  });
  g.addEventListener("blur", () => {
    state.hovered = null;
    render();
  });
  g.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle(node.id);
  });
  g.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(node.id);
    }
  });

  makeDraggable(g, node);
}

function toggle(id) {
  if (!hasChildren(INDEX, id)) {
    state.selected = id;
    showPanel(id);
    return;
  }
  if (state.expanded.has(id)) {
    collapseTree(id);
  } else {
    state.expanded.add(id);
  }
  writeHash();
  rebuild();
  showPanel(id);
}

/** Collapsing a branch closes everything beneath it, or reopening feels haunted. */
function collapseTree(id) {
  state.expanded.delete(id);
  for (const child of INDEX.children.get(id) ?? []) collapseTree(child);
}

function makeDraggable(g, node) {
  let dragging = false;
  let moved = false;

  g.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = false;
    g.setPointerCapture(e.pointerId);
    if (!REDUCED) sim?.alphaTarget(0.15).restart();
  });

  g.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    moved = true;
    const pt = toSvg(e);
    node.fx = pt.x;
    node.fy = pt.y;
    if (REDUCED) {
      sim?.tick(1);
      tick(sim.nodes(), sim.force("link").links());
    }
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    node.fx = null;
    node.fy = null;
    sim?.alphaTarget(0);
    // A drag shouldn't also count as a click that expands the node.
    if (moved) g.addEventListener("click", stopOnce, { capture: true, once: true });
  };

  g.addEventListener("pointerup", end);
  g.addEventListener("pointercancel", end);
}

function stopOnce(e) {
  e.stopPropagation();
}

/** Screen coordinates into viewport coordinates, through both the viewBox and the fit transform. */
function toSvg(e) {
  const ctm = viewport.getScreenCTM();
  if (!ctm) return { x: WIDTH / 2, y: HEIGHT / 2 };
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

svg.addEventListener("click", () => {
  state.selected = null;
  hidePanel();
  render();
});

// ---------------------------------------------------------------- detail panel

function showPanel(id) {
  const node = INDEX.byId.get(id);
  if (!node) return;

  const trail = [];
  let cur = node;
  while (cur) {
    trail.unshift(cur.label);
    cur = cur.parent ? INDEX.byId.get(cur.parent) : null;
  }

  const connections = GRAPH.edges
    .filter((e) => e.from === id || e.to === id)
    .map((e) => {
      const otherId = e.from === id ? e.to : e.from;
      const other = INDEX.byId.get(otherId);
      const arrow = e.from === id ? "→" : "←";
      return `<li><span class="conn-arrow">${arrow}</span> <b>${esc(other?.label ?? otherId)}</b>
        <span class="conn-kind">${esc(e.kind)}</span>
        ${e.data ? `<span class="conn-data">${esc(e.data)}</span>` : ""}</li>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="panel-head">
      <p class="crumb">${trail.slice(0, -1).map(esc).join(" › ")}</p>
      <h2>${esc(node.label)}</h2>
      ${node.language ? `<p class="lang">${esc(node.language)}</p>` : ""}
    </div>
    ${node.summary ? `<p class="summary">${esc(node.summary)}</p>` : ""}
    ${renderPaths(node)}
    ${renderSecurity(node)}
    ${renderPerformance(node)}
    ${connections ? `<section><h3>Connections</h3><ul class="conns">${connections}</ul></section>` : ""}
  `;
  document.body.classList.add("panel-open");
}

function renderPaths(node) {
  if (!node.paths?.length) return "";
  const base = GRAPH.meta.repoBase;
  const items = node.paths
    .map((p) => {
      const text = esc(p);
      if (!base || !node.repo) return `<li><code>${text}</code></li>`;
      // HEAD resolves to whatever each repo's default branch is, which varies across KyPost.
      const href = `${base}/${node.repo}/tree/HEAD/${p}`;
      return `<li><a href="${esc(href)}" target="_blank" rel="noopener"><code>${text}</code></a></li>`;
    })
    .join("");
  return `<section><h3>Source</h3><ul class="paths">${items}</ul></section>`;
}

function renderSecurity(node) {
  const s = node.security;
  if (!s) {
    return `<section class="unassessed"><h3>Security</h3><p>Not yet assessed.</p></section>`;
  }
  const rows = [
    s.attackSurface ? row("Reachable from", s.attackSurface, `surface-${s.attackSurface}`) : "",
    s.encryption ? row("Encryption", s.encryption) : "",
    s.handlesPii !== undefined ? row("Personal data", s.handlesPii ? "yes" : "no") : "",
    s.authRequired !== undefined ? row("Auth required", s.authRequired ? "yes" : "no") : ""
  ].join("");
  return `<section><h3>Security</h3><dl>${rows}</dl>
    ${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ""}</section>`;
}

function renderPerformance(node) {
  const p = node.performance;
  if (!p) {
    return `<section class="unassessed"><h3>Performance</h3><p>Not yet assessed.</p></section>`;
  }
  const rows = [
    p.latencyClass ? row("Latency", p.latencyClass, `lat-${p.latencyClass}`) : "",
    p.hotPath !== undefined ? row("Hot path", p.hotPath ? "yes" : "no") : ""
  ].join("");
  return `<section><h3>Performance</h3><dl>${rows}</dl>
    ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ""}</section>`;
}

function row(label, value, cls = "") {
  return `<dt>${esc(label)}</dt><dd class="${cls}">${esc(String(value))}</dd>`;
}

/**
 * With nothing selected the panel explains what it is looking at rather than going blank —
 * this is the first thing a visitor reads, so it carries the summary and the provenance.
 */
function hidePanel() {
  const repos = Object.entries(GRAPH.meta.commits ?? {});
  panel.innerHTML = `
    <div class="panel-head">
      <p class="crumb">${esc(GRAPH.meta.project)}</p>
      <h2>Architecture map</h2>
    </div>
    ${GRAPH.meta.tagline ? `<p class="summary">${esc(GRAPH.meta.tagline)}</p>` : ""}
    <section>
      <h3>How to read this</h3>
      <ul class="howto">
        <li>Dashed outlines open up. Click one to see inside.</li>
        <li>Hover anything to dim the rest and read the detail.</li>
        <li>The view tabs recolour the same graph by data flow, security, or load.</li>
      </ul>
    </section>
    ${
      repos.length
        ? `<section><h3>Generated</h3><p class="notes">${esc(GRAPH.meta.generated)} from
           ${repos.map(([r, sha]) => `${esc(r)} <code>${esc(sha)}</code>`).join(", ")}</p></section>`
        : ""
    }
  `;
  document.body.classList.remove("panel-open");
}

// ---------------------------------------------------------------- chrome

for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => setView(button.dataset.view));
}

function setView(view) {
  if (!VIEWS.includes(view)) return;
  state.view = view;
  svg.setAttribute("data-view", view);
  document.body.setAttribute("data-view", view);
  for (const b of document.querySelectorAll("[data-view]")) {
    b.setAttribute("aria-selected", String(b.dataset.view === view));
  }
  writeHash();
}

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  // Open the branches containing hits, so a match is never hidden inside a closed node.
  const q = state.query.trim().toLowerCase();
  if (q.length > 1) {
    let changed = false;
    for (const node of GRAPH.nodes) {
      if (!matches(node, q)) continue;
      let p = node.parent;
      while (p != null) {
        if (!state.expanded.has(p)) {
          state.expanded.add(p);
          changed = true;
        }
        p = INDEX.byId.get(p)?.parent ?? null;
      }
    }
    if (changed) {
      rebuild();
      return;
    }
  }
  render();
});

const themeButton = document.getElementById("theme-toggle");

function currentTheme() {
  return (
    document.documentElement.getAttribute("data-theme") ??
    (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
  );
}

/** The button advertises the theme you'd get by pressing it, not the one you're in. */
function labelThemeButton() {
  themeButton.textContent = currentTheme() === "light" ? "Patina Ky" : "Polished Ky";
}

themeButton.addEventListener("click", () => {
  const next = currentTheme() === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  labelThemeButton();
  try {
    localStorage.setItem("kydata-theme", next);
  } catch {
    // Private browsing. The toggle still works for this session.
  }
});

document.getElementById("reset").addEventListener("click", () => {
  state.expanded.clear();
  state.query = "";
  searchInput.value = "";
  hidePanel();
  writeHash();
  rebuild();
});

// ---------------------------------------------------------------- url state

function writeHash() {
  const parts = [];
  if (state.expanded.size) parts.push(`open=${[...state.expanded].join(",")}`);
  if (state.view !== "architecture") parts.push(`view=${state.view}`);
  const hash = parts.join("&");
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));

  state.expanded.clear();
  const open = params.get("open");
  if (open) {
    for (const id of open.split(",")) {
      if (INDEX.byId.has(id)) state.expanded.add(id);
    }
  }

  state.view = VIEWS.includes(params.get("view")) ? params.get("view") : "architecture";
}

// Someone editing the URL, or pressing Back, should actually move the graph.
window.addEventListener("hashchange", () => {
  readHash();
  setView(state.view);
  rebuild();
});

// ---------------------------------------------------------------- helpers

function svgEl(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function ariaFor(node, expandable) {
  const bits = [node.label];
  if (node.language) bits.push(node.language);
  if (expandable) bits.push(state.expanded.has(node.id) ? "expanded" : "collapsed, activate to expand");
  return bits.join(", ");
}

// ---------------------------------------------------------------- boot

try {
  const saved = localStorage.getItem("kydata-theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
} catch {
  // No storage available; fall back to prefers-color-scheme.
}
labelThemeButton();

readHash();
setView(state.view);
hidePanel();
rebuild();
