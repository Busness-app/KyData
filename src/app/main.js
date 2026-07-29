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

/**
 * Focus and context.
 *
 * A force graph showing every node and every edge at once is a hairball, and no amount of
 * styling fixes that — there is simply too much on screen. So opening something makes it the
 * subject: its contents are drawn in full, the things it talks to stay legible around it, and
 * everything else recedes to small unlabelled context.
 */

/** Ids of the open node and everything inside it. Empty when nothing is open. */
function focusIds() {
  const inFocus = new Set();
  if (!state.expanded.size) return inFocus;

  for (const node of GRAPH.nodes) {
    let cur = node.id;
    while (cur != null) {
      if (state.expanded.has(cur)) {
        inFocus.add(node.id);
        break;
      }
      cur = INDEX.byId.get(cur)?.parent ?? null;
    }
  }
  return inFocus;
}

/** Every ancestor of a node, including itself. */
function ancestry(id) {
  const chain = new Set();
  let cur = id;
  while (cur != null) {
    chain.add(cur);
    cur = INDEX.byId.get(cur)?.parent ?? null;
  }
  return chain;
}

/**
 * Periphery nodes shrink so the open system is unmistakably the subject — but only to 0.72,
 * which keeps a backgrounded system (24px) comfortably larger than a module (16px). Shrinking
 * them further collapses the level distinction that the whole diagram rests on.
 */
function displayRadius(node) {
  return node.emphasis === "periphery" ? radiusFor(node.level) * 0.72 : radiusFor(node.level);
}

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

  const focus = focusIds();

  // With something open, edges between two unrelated bystanders are pure noise — they are the
  // difference between a diagram and a hairball. Drop them. Nothing is lost: the detail panel
  // still lists every connection a node has, whatever is open.
  const kept = focus.size ? links.filter((l) => focus.has(l.source) || focus.has(l.target)) : links;

  // Anything still wired to the open system stays full size; the rest becomes context.
  const adjacent = new Set();
  for (const link of kept) {
    if (focus.has(link.source)) adjacent.add(link.target);
    if (focus.has(link.target)) adjacent.add(link.source);
  }

  for (const node of nodes) {
    node.emphasis = !focus.size
      ? "normal"
      : focus.has(node.id)
        ? "focus"
        : adjacent.has(node.id)
          ? "adjacent"
          : "periphery";
  }

  // Pin the open system at the centre. Its ring is placed relative to it, so letting it drift
  // means the whole structure drifts and the layout never reads as settled.
  for (const node of nodes) {
    const isOpenRoot = state.expanded.has(node.id) && node.level === 0;
    if (isOpenRoot) {
      node.x = sim2d.w / 2;
      node.y = sim2d.h / 2;
    }
    node.fx = isOpenRoot ? node.x : null;
    node.fy = isOpenRoot ? node.y : null;
  }

  pinRings(nodes, byId, kept);

  // d3-force mutates link endpoints into object references; keep our own copies clean.
  const simLinks = kept.map((l) => ({ ...l, source: byId.get(l.source), target: byId.get(l.target) }));

  sim?.stop();
  sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink(simLinks)
        .id((d) => d.id)
        .distance((d) => {
          // An edge leaving the open system has to reach past its boundary. Given the short
          // distance it fights the enclosure, and the outside node ends up parked on the
          // boundary or inside it, which is what made the server look like a pile.
          const crosses = (d.source.emphasis === "focus") !== (d.target.emphasis === "focus");
          if (crosses) return 230;
          return d.source.level === 0 && d.target.level === 0 ? 190 : 110;
        })
        .strength((d) =>
          (d.source.emphasis === "focus") !== (d.target.emphasis === "focus") ? 0.12 : 0.35
        )
    )
    .force(
      "charge",
      forceManyBody().strength((d) =>
        d.emphasis === "periphery" ? -700 : d.level === 0 ? -1500 : -900
      )
    )
    // Labels sit under the circles and are far wider than them, so reserve room for text.
    .force("collide", forceCollide().radius((d) => displayRadius(d) + (d.emphasis === "periphery" ? 22 : 30)))
    .force("center", forceCenter(sim2d.w / 2, sim2d.h / 2))
    .force("x", forceX(sim2d.w / 2).strength(0.04))
    .force("y", forceY(sim2d.h / 2).strength(0.06))
    // Without this, a node's children drift off among unrelated nodes and the expansion
    // reads as noise rather than as "here is what is inside this thing". Kept weak so it
    // groups without collapsing the children into a pile on top of the parent. Collision
    // handles the spacing, so this can be firm enough to keep hulls tight and separate.
    .force("enclosure", forceEnclosure(byId, 1.3))
    .force("clearance", forceEdgeClearance(simLinks, 0.55, 16));

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

/**
 * Custom force: a node never sits on an edge it is not an endpoint of.
 *
 * This is the difference between a diagram and a mess. When an unrelated node parks in the
 * middle of a connection, the line appears to terminate there, and the reader has to trace
 * around it to find out it doesn't. Repelling nodes off the edges they have nothing to do with
 * keeps every connection readable end to end.
 */
function forceEdgeClearance(links, strength, clearance) {
  let nodes = [];

  function force(alpha) {
    for (const link of links) {
      const a = link.source;
      const b = link.target;

      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const lenSq = abx * abx + aby * aby;
      if (lenSq < 1) continue;

      for (const node of nodes) {
        if (node === a || node === b) continue;

        // Where the node falls along the edge. Ignore the ends — crowding near a node's own
        // circle is the collision force's problem, not this one.
        const t = ((node.x - a.x) * abx + (node.y - a.y) * aby) / lenSq;
        if (t <= 0.12 || t >= 0.88) continue;

        const px = a.x + t * abx;
        const py = a.y + t * aby;

        let dx = node.x - px;
        let dy = node.y - py;
        let dist = Math.hypot(dx, dy);
        const want = clearance + displayRadius(node);
        if (dist >= want) continue;

        // Sitting exactly on the line: pick the perpendicular so it still gets pushed off.
        if (dist < 0.01) {
          dx = -aby;
          dy = abx;
          dist = Math.hypot(dx, dy) || 1;
        }

        const push = (want - dist) * strength * alpha;
        node.vx += (dx / dist) * push;
        node.vy += (dy / dist) * push;

        // Let the edge give a little too, so a node wedged between two others can escape.
        a.vx -= (dx / dist) * push * 0.2;
        a.vy -= (dy / dist) * push * 0.2;
        b.vx -= (dx / dist) * push * 0.2;
        b.vy -= (dy / dist) * push * 0.2;
      }
    }
  }

  force.initialize = (n) => {
    nodes = n;
  };
  return force;
}

/**
 * Custom force: keep everything that is not part of the open system outside its enclosure.
 *
 * A boundary with a stranger sitting inside it says the opposite of what a boundary is for, and
 * the force layout has no concept of the hull we draw around the group — so state it explicitly.
 */
function forceEnclosure(byId, strength) {
  let nodes = [];

  function force(alpha) {
    for (const id of state.expanded) {
      const parent = byId.get(id);
      if (!parent) continue;

      const bound = enclosureRadius(id);

      for (const node of nodes) {
        if (belongsTo(node.id, id)) continue;

        const dx = node.x - parent.x;
        const dy = node.y - parent.y;
        const dist = Math.hypot(dx, dy) || 1;
        const keepOut = bound + displayRadius(node);

        if (dist < keepOut) {
          const push = (keepOut - dist) * strength * alpha;
          node.vx += (dx / dist) * push;
          node.vy += (dy / dist) * push;
        }
      }
    }
  }

  force.initialize = (n) => {
    nodes = n;
  };
  return force;
}

/**
 * The drawn boundary and the physics use the same number, so a node can never come to rest
 * inside a circle it is being pushed out of.
 */
function enclosureRadius(parentId) {
  return ringRadius(parentId) + 46;
}

function belongsTo(nodeId, ancestorId) {
  let cur = nodeId;
  while (cur != null) {
    if (cur === ancestorId) return true;
    cur = INDEX.byId.get(cur)?.parent ?? null;
  }
  return false;
}

/** Big enough that the children sit shoulder to shoulder rather than on top of each other. */
function ringRadius(parentId) {
  const count = (INDEX.children.get(parentId) ?? []).length;
  return Math.max(130, 26 + count * 21);
}

/**
 * Order children around the ring so the ones wired together end up next to each other.
 *
 * On a ring, an edge between neighbours is a short arc and an edge between opposite sides is a
 * chord straight through the middle. Eleven children in arbitrary order means a dozen chords
 * crossing in the centre — the same hairball, in a circle. Sequencing them by adjacency turns
 * most of those chords back into short hops around the rim.
 */
function ringOrder(childIds) {
  const set = new Set(childIds);
  const adj = new Map(childIds.map((id) => [id, new Set()]));

  for (const edge of GRAPH.edges) {
    if (!set.has(edge.from) || !set.has(edge.to)) continue;
    adj.get(edge.from).add(edge.to);
    adj.get(edge.to).add(edge.from);
  }

  const remaining = new Set(childIds);
  const order = [];

  // Start from the most connected child; ties break by id so rebuilds are identical.
  let cur = [...remaining].sort(
    (a, b) => adj.get(b).size - adj.get(a).size || a.localeCompare(b)
  )[0];

  while (cur) {
    order.push(cur);
    remaining.delete(cur);

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of remaining) {
      // Prefer a direct neighbour of the child just placed, then one sharing connections with
      // what is already on the ring, so clusters stay contiguous.
      const direct = adj.get(cur).has(candidate) ? 10 : 0;
      const shared = [...adj.get(candidate)].filter((n) => order.includes(n)).length;
      const score = direct + shared;

      if (score > bestScore || (score === bestScore && best && candidate < best)) {
        bestScore = score;
        best = candidate;
      }
    }

    cur = best;
  }

  // The chain above keeps neighbours together but is blind to what it costs elsewhere, so
  // finish by counting actual crossings and swapping pairs while that number keeps falling.
  // A dozen children is small enough that this is free.
  const pairs = [];
  for (const [from, neighbours] of adj) {
    for (const to of neighbours) if (from < to) pairs.push([from, to]);
  }

  let best = crossings(order, pairs);
  let improved = true;

  while (improved && best > 0) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        [order[i], order[j]] = [order[j], order[i]];
        const score = crossings(order, pairs);
        if (score < best) {
          best = score;
          improved = true;
        } else {
          [order[i], order[j]] = [order[j], order[i]];
        }
      }
    }
  }

  return order;
}

/** How many chords cross, for a given order around the circle. */
function crossings(order, pairs) {
  const pos = new Map(order.map((id, i) => [id, i]));
  const chords = pairs.map(([a, b]) => [pos.get(a), pos.get(b)]);

  // Strictly inside the clockwise arc from s to e.
  const inArc = (x, s, e) => (s < e ? x > s && x < e : x > s || x < e);

  let count = 0;
  for (let i = 0; i < chords.length; i++) {
    const [a, b] = chords[i];
    for (let j = i + 1; j < chords.length; j++) {
      const [c, d] = chords[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (inArc(c, a, b) !== inArc(d, a, b)) count++;
    }
  }
  return count;
}

/**
 * Pin every open node's children to fixed points on its ring.
 *
 * The force layout is good at arranging things that have no correct arrangement. A system's
 * contents do have one, and negotiating it against link and charge forces every frame produced
 * a different lopsided cluster each time. Placing them outright makes the structure legible and
 * identical on every visit; the simulation is left to do what it is actually good at, which is
 * finding room for everything outside.
 */
function pinRings(nodes, byId, links) {
  for (const node of nodes) node.ringPin = null;

  // Shallowest first, so a parent is already placed before its own children are positioned.
  const open = [...state.expanded]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => a.level - b.level);

  for (const parent of open) {
    const children = (INDEX.children.get(parent.id) ?? []).filter((id) => byId.has(id));
    if (!children.length) continue;

    const order = ringOrder(children);
    const radius = ringRadius(parent.id);

    order.forEach((id, i) => {
      // Start at the top and go clockwise: a diagram has a reading order even when a graph
      // doesn't, and always beginning in the same place makes returning to one easier.
      const angle = -Math.PI / 2 + (i / order.length) * Math.PI * 2;
      const child = byId.get(id);
      child.ringPin = {
        x: parent.x + Math.cos(angle) * radius,
        y: parent.y + Math.sin(angle) * radius
      };
    });
  }

  placeOutside(nodes, byId, links);

  for (const node of nodes) {
    if (!node.ringPin) continue;
    node.x = node.ringPin.x;
    node.y = node.ringPin.y;
    node.fx = node.ringPin.x;
    node.fy = node.ringPin.y;
  }
}

/**
 * Put each outside node on a second ring, at the angle of whatever it connects to.
 *
 * This is the rest of "a node that connects to nothing should never sit between two that do".
 * Left to the simulation, an external ends up wherever the forces balance, and its edge then
 * cuts straight across the open system to reach the one module it actually talks to — through
 * everything in between. Placed on the right side of the circle, that edge becomes a short
 * radial hop and the middle stays clear.
 */
function placeOutside(nodes, byId, links) {
  const roots = [...state.expanded].map((id) => byId.get(id)).filter((n) => n && n.level === 0);
  if (roots.length !== 1) return;

  const root = roots[0];
  const radius = enclosureRadius(root.id) + 95;

  const targets = [];

  for (const node of nodes) {
    if (belongsTo(node.id, root.id)) continue;

    // The angles of everything inside the circle this node is wired to.
    const angles = [];
    for (const link of links) {
      const other =
        link.source === node.id ? link.target : link.target === node.id ? link.source : null;
      if (other == null) continue;

      const partner = byId.get(other);
      if (!partner?.ringPin) continue;
      angles.push(Math.atan2(partner.ringPin.y - root.y, partner.ringPin.x - root.x));
    }

    // Nothing inside to point at: leave it to the simulation and the enclosure force.
    if (!angles.length) continue;
    targets.push({ node, angle: circularMean(angles) });
  }

  if (!targets.length) return;

  // Spread them evenly so they cannot collide, keeping the order their angles asked for, and
  // rotate the whole set to sit as close to those angles as it can.
  targets.sort((a, b) => a.angle - b.angle);
  const step = (Math.PI * 2) / targets.length;
  const offset = circularMean(targets.map((t, i) => t.angle - i * step));

  targets.forEach((t, i) => {
    const angle = offset + i * step;
    t.node.ringPin = {
      x: root.x + Math.cos(angle) * radius,
      y: root.y + Math.sin(angle) * radius
    };
  });
}

/** Mean of angles, via unit vectors — averaging the numbers breaks across the ±π seam. */
function circularMean(angles) {
  let sx = 0;
  let sy = 0;
  for (const a of angles) {
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  return Math.atan2(sy, sx);
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
      svgEl("circle", { class: "node-ring" }),
      svgEl("circle", { class: "node-dot" }),
      svgEl("text", { class: "node-label" }),
      svgEl("text", { class: "node-meta" }),
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
        link.both ? "both" : "",
        // A connection between two members of the open ring. Some of these must cross the
        // middle — the graph is not planar — so at rest they step back and let the structure
        // read, and come forward when a node is hovered.
        link.source.emphasis === "focus" && link.target.emphasis === "focus" ? "inside" : ""
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
        state.expanded.has(node.id) ? "open" : "",
        `em-${node.emphasis ?? "normal"}`
      ]
        .filter(Boolean)
        .join(" ")
    );

    const r = displayRadius(node);
    g.querySelector(".node-dot").setAttribute("r", r);
    g.querySelector(".node-ring").setAttribute("r", r + 5);
    g.querySelector(".node-halo").setAttribute("r", r + 11);

    const label = g.querySelector(".node-label");
    label.textContent = node.label;
    label.setAttribute("y", r + 17);

    // A second line of hard facts under level 0. Reads as a spec sheet rather than decoration,
    // and it is the fastest way to tell a Go service from a Kotlin client at a glance.
    const meta = g.querySelector(".node-meta");
    meta.textContent = node.level === 0 && node.emphasis !== "periphery" ? metaLine(node) : "";
    meta.setAttribute("y", r + 31);

    const toggle = g.querySelector(".node-toggle");
    toggle.textContent = expandable ? (state.expanded.has(node.id) ? "−" : "+") : "";
    toggle.setAttribute("y", 1);

    g.setAttribute("aria-label", ariaFor(node, expandable));
    g.setAttribute("aria-expanded", expandable ? String(state.expanded.has(node.id)) : "");
  }

  hint.textContent = state.expanded.size
    ? "Click an open node to close it. Opening another switches to it."
    : "Click any node to open it up.";
}

/** "Go · service" — language and role, in the utility face. */
function metaLine(node) {
  return [node.language, node.kind === "external" ? "external" : node.kind]
    .filter(Boolean)
    .join(" · ");
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
    const ar = displayRadius(a) + 3;
    const br = displayRadius(b) + 3;
    const x1 = a.x + ux * ar;
    const y1 = a.y + uy * ar;
    const x2 = b.x - ux * br;
    const y2 = b.y - uy * br;

    // Bow every edge the same way by a fixed fraction of its length. Straight lines crossing at
    // arbitrary angles read as a tangle; consistently curved ones read as routing, and a reader
    // can follow one strand through a crossing because its curvature stays continuous.
    const bow = len * 0.14;
    const cx = (x1 + x2) / 2 - uy * bow;
    const cy = (y1 + y2) / 2 + ux * bow;

    g.querySelector(".link-line").setAttribute("d", `M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`);

    // Arrowheads follow the curve's tangent at the endpoint, not the straight-line direction.
    const tx = x2 - cx;
    const ty = y2 - cy;
    const tl = Math.hypot(tx, ty) || 1;
    arrows.push({ id: `${link.id}>`, cls: g.getAttribute("class"), x: x2, y: y2, ux: tx / tl, uy: ty / tl });

    if (link.both) {
      const sx = x1 - cx;
      const sy = y1 - cy;
      const sl = Math.hypot(sx, sy) || 1;
      arrows.push({ id: `${link.id}<`, cls: g.getAttribute("class"), x: x1, y: y1, ux: sx / sl, uy: sy / sl });
    }

    // Sit the label on the curve, not on the chord it cuts across.
    labels.push({
      id: link.id,
      text: link.label,
      x: 0.25 * x1 + 0.5 * cx + 0.25 * x2,
      y: 0.25 * y1 + 0.5 * cy + 0.25 * y2
    });
  }

  paintArrows(arrows);
  paintEdgeLabels(labels);
  paintHulls(nodes);
  fitViewport(nodes);
  resolveLabels(nodes);
}

/**
 * Hide node labels that would collide with a more important one.
 *
 * Overlapping text is the single ugliest failure mode here — two labels on top of each other
 * are worth less than one, because neither can be read. So they compete: the open system wins,
 * then whatever is in focus, then everything else, and a label that cannot find clear space
 * simply doesn't render. Hovering a node always shows its own label regardless.
 */
const LABEL_PRIORITY = { focus: 0, normal: 1, adjacent: 2, periphery: 3 };

function resolveLabels(nodes) {
  const ranked = [...nodes].sort((a, b) => {
    const open = Number(state.expanded.has(b.id)) - Number(state.expanded.has(a.id));
    if (open) return open;
    const em = LABEL_PRIORITY[a.emphasis ?? "normal"] - LABEL_PRIORITY[b.emphasis ?? "normal"];
    if (em) return em;
    return a.level - b.level;
  });

  const placed = [];

  for (const node of ranked) {
    const el = nodeEls.get(node.id);
    if (!el) continue;

    // Approximating the text box beats measuring it: getBBox on every label every frame forces
    // a synchronous layout, and the estimate only has to be good enough to detect overlap.
    const size = node.level === 0 ? 13.5 : 11;
    const half = (node.label.length * size * 0.29) | 0;
    const top = node.y + displayRadius(node) + 7;
    // Level 0 carries a second line of meta text below the label; reserve room for it too.
    const height = size + 3 + (node.level === 0 && node.emphasis !== "periphery" ? 14 : 0);
    const box = { x1: node.x - half, x2: node.x + half, y1: top, y2: top + height };

    const clear = !placed.some(
      (p) => box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1
    );

    if (clear) placed.push(box);
    el.classList.toggle("label-hidden", !clear);
  }
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
    if (!(INDEX.children.get(id) ?? []).length) continue;

    hulls.push({ id, x: parent.x, y: parent.y, r: enclosureRadius(id) });
  }

  syncPool(hullEls, hulls, gHulls, () => svgEl("circle", { class: "hull" }));
  for (const h of hulls) {
    const el = hullEls.get(h.id);
    el.setAttribute("cx", h.x);
    el.setAttribute("cy", h.y);
    el.setAttribute("r", h.r);
  }

  paintSpokes(nodes, byId);
}

/**
 * Faint spokes from an open node to each of its children.
 *
 * Containment is not an edge in the data, so the node at the centre of the ring has nothing
 * attached to it and reads as stranded. These say "these are its parts" — and having something
 * radial in the middle also gives the eye a structure to follow instead of the chords.
 */
const spokeEls = new Map();
function paintSpokes(nodes, byId) {
  const spokes = [];

  for (const id of state.expanded) {
    const parent = byId.get(id);
    if (!parent) continue;

    for (const childId of INDEX.children.get(id) ?? []) {
      const child = byId.get(childId);
      if (!child) continue;
      spokes.push({ id: `${id}|${childId}`, x1: parent.x, y1: parent.y, x2: child.x, y2: child.y });
    }
  }

  syncPool(spokeEls, spokes, gHulls, () => svgEl("line", { class: "spoke" }));
  for (const s of spokes) {
    const el = spokeEls.get(s.id);
    el.setAttribute("x1", s.x1);
    el.setAttribute("y1", s.y1);
    el.setAttribute("x2", s.x2);
    el.setAttribute("y2", s.y2);
  }
}

/**
 * Keep the whole graph framed as it settles and as branches open. Without this, expanding a
 * node pushes its children off the edge of the canvas, and the macro view floats in a corner
 * of whatever aspect ratio the window happens to be.
 */
function fitViewport(nodes) {
  if (!nodes.length) return;

  // Frame the subject, not the bystanders. Once something is open, the unconnected nodes have
  // been pushed well clear of it, and letting them drive the framing shrinks the thing you
  // actually opened down into a corner. They get tucked back into the margins below.
  const framed = nodes.filter((n) => n.emphasis !== "periphery");
  const subject = framed.length ? framed : nodes;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of subject) {
    const r = displayRadius(n);
    minX = Math.min(minX, n.x - r);
    maxX = Math.max(maxX, n.x + r);
    minY = Math.min(minY, n.y - r);
    // The label and its meta line hang below the circle, so reserve room for them.
    maxY = Math.max(maxY, n.y + r + (n.level === 0 ? 36 : 20));
  }

  // Tight viewports can't afford a wide margin.
  const pad = Math.min(90, Math.max(16, Math.min(view.w, view.h) * 0.08));
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  // The legend and the hint float over the bottom of the canvas, so keep the graph above them.
  const padBottom = pad + (view.w > 900 ? 46 : 0);
  const availW = view.w - pad * 2;
  const availH = view.h - pad - padBottom;

  // Never magnify past 1.2, or a two-node view turns into absurdly large circles.
  const scale = Math.min(availW / bw, availH / bh, 1.2);

  const tx = pad + (availW - bw * scale) / 2 - minX * scale;
  const ty = pad + (availH - bh * scale) / 2 - minY * scale;

  viewport.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);

  if (framed.length === nodes.length) return;

  // Keep the context nodes on screen at the edges rather than letting them drift off it.
  const inset = 30;
  const left = (inset - tx) / scale;
  const top = (inset - ty) / scale;
  const right = (view.w - inset - tx) / scale;
  const bottom = (view.h - inset - ty) / scale;

  for (const n of nodes) {
    if (n.emphasis !== "periphery") continue;
    // Labels are much wider than the node, so inset horizontally by the text, not the circle.
    const r = displayRadius(n) + 14;
    const textHalf = Math.max(r, n.label.length * 3.1);
    n.x = clamp(n.x, left + textHalf, right - textHalf);
    n.y = clamp(n.y, top + r, bottom - r - 14);
    nodeEls.get(n.id)?.setAttribute("transform", `translate(${n.x} ${n.y})`);
  }
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
    // One thing open at a time. Two systems opened side by side is where this stops being
    // readable, and drilling deeper into the same system is the useful case — so keep the
    // chain above this node and close everything else.
    const chain = ancestry(id);
    for (const open of [...state.expanded]) {
      if (!chain.has(open)) state.expanded.delete(open);
    }
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
    // Ring members snap back to their place: the arrangement is the point, and a dragged-out
    // child left where it landed quietly undoes it.
    node.fx = node.ringPin ? node.ringPin.x : null;
    node.fy = node.ringPin ? node.ringPin.y : null;
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
        <li>Click a node ringed in dashes to open it up.</li>
        <li>Hollow nodes are systems you don't run.</li>
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
