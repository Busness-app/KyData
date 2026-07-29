/**
 * Build-time layout seed.
 *
 * The live simulation in the browser is what makes expansion feel organic, but an unseeded
 * force layout spends its first second flying apart and re-converging — which is exactly when
 * someone is trying to read it, and which looks different on every load. So we run the same
 * simulation headless here, to convergence, and ship the resulting coordinates. First paint is
 * then stable, identical every time, and already settled.
 *
 * Children are seeded on a ring around their parent so that expanding a node blooms outward
 * from it rather than throwing new nodes in from the corners.
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

import { buildIndex, computeVisible } from "./graph.js";

export const WIDTH = 1200;
export const HEIGHT = 760;

/**
 * Node radius by level. Level 0 reads as the primary structure; deeper nodes recede.
 *
 * The gap between levels has to survive a level-0 node being shrunk to context, otherwise a
 * backgrounded system and a foreground module end up the same size and the hierarchy is lost.
 */
export function radiusFor(level) {
  return level === 0 ? 34 : level === 1 ? 16 : 12;
}

export function seedPositions(graph) {
  const index = buildIndex(graph);

  // Macro pass: the level-0 view, which is what people see first and what must be stable.
  const { nodes, links } = computeVisible(graph, index, new Set());

  const sim = forceSimulation(nodes.map((n) => ({ ...n })))
    .force(
      "link",
      forceLink(links.map((l) => ({ ...l })))
        .id((d) => d.id)
        .distance(190)
        .strength(0.35)
    )
    .force("charge", forceManyBody().strength(-1400))
    .force("collide", forceCollide().radius((d) => radiusFor(d.level) + 28))
    .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
    .force("x", forceX(WIDTH / 2).strength(0.04))
    .force("y", forceY(HEIGHT / 2).strength(0.06))
    .stop();

  sim.tick(400);

  const positions = {};
  for (const node of sim.nodes()) {
    positions[node.id] = { x: round(node.x), y: round(node.y) };
  }

  // Children ring around their parent, at a deterministic angle so rebuilds don't reshuffle.
  for (const node of graph.nodes) {
    if (node.parent == null) continue;
    const kids = index.children.get(node.parent) ?? [];
    const i = kids.indexOf(node.id);
    const anchor = positions[node.parent] ?? { x: WIDTH / 2, y: HEIGHT / 2 };
    const spread = 90 + kids.length * 8;
    const angle = (i / Math.max(kids.length, 1)) * Math.PI * 2 - Math.PI / 2;

    positions[node.id] = {
      x: round(anchor.x + Math.cos(angle) * spread),
      y: round(anchor.y + Math.sin(angle) * spread)
    };
  }

  return positions;
}

function round(n) {
  return Math.round(n * 10) / 10;
}
