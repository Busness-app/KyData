import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIndex, computeVisible } from "../src/graph.js";
import { curveControl } from "../src/forces.js";
import { radiusFor, seedPositions } from "../src/layout.js";
import { loadGraph } from "../src/validate.js";

const KYPOST = new URL("../data/kypost.json", import.meta.url).pathname;

/**
 * Distance from a point to the curve an edge is drawn as.
 *
 * Measuring to the straight line between the two nodes is what let this bug through: the drawn
 * edge bows away from that chord by 14% of its length, so a node can be well clear of the chord
 * and sitting squarely on the visible line.
 */
function distanceToEdge(node, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return Infinity;

  const ux = dx / length;
  const uy = dy / length;

  const x1 = a.x + ux * (radiusFor(a.level) + 3);
  const y1 = a.y + uy * (radiusFor(a.level) + 3);
  const x2 = b.x - ux * (radiusFor(b.level) + 3);
  const y2 = b.y - uy * (radiusFor(b.level) + 3);

  const { cx, cy } = curveControl(x1, y1, x2, y2, ux, uy, length);

  let best = Infinity;
  // Finer than the force samples on purpose: the test should be able to catch a near miss the
  // force's coarser sampling stepped over.
  for (let i = 0; i <= 40; i++) {
    const t = 0.1 + (i / 40) * 0.8;
    const m = 1 - t;
    const px = m * m * x1 + 2 * m * t * cx + t * t * x2;
    const py = m * m * y1 + 2 * m * t * cy + t * t * y2;
    best = Math.min(best, Math.hypot(node.x - px, node.y - py));
  }
  return best;
}

test("no node in the seeded overview sits on an edge it is not part of", async () => {
  const graph = await loadGraph(KYPOST);
  const index = buildIndex(graph);
  const seeds = seedPositions(graph);

  // The overview: nothing expanded, which is what ships as the opening view.
  const { nodes, links } = computeVisible(graph, index, new Set());
  const placed = nodes.map((n) => ({ ...n, ...seeds[n.id] }));
  const byId = new Map(placed.map((n) => [n.id, n]));

  const offenders = [];

  for (const link of links) {
    const a = byId.get(link.source);
    const b = byId.get(link.target);
    if (!a || !b) continue;

    for (const node of placed) {
      if (node.id === a.id || node.id === b.id) continue;
      const gap = distanceToEdge(node, a, b);
      if (gap < radiusFor(node.level)) {
        offenders.push(`${node.id} sits on ${a.id} -> ${b.id} (${gap.toFixed(0)}px from the curve)`);
      }
    }
  }

  assert.deepEqual(offenders, [], `nodes obstructing edges:\n  ${offenders.join("\n  ")}`);
});

test("the seeded overview keeps nodes from overlapping each other", async () => {
  const graph = await loadGraph(KYPOST);
  const index = buildIndex(graph);
  const seeds = seedPositions(graph);

  const { nodes } = computeVisible(graph, index, new Set());
  const placed = nodes.map((n) => ({ ...n, ...seeds[n.id] }));

  const collisions = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - radiusFor(a.level) - radiusFor(b.level);
      if (gap < 0) collisions.push(`${a.id} overlaps ${b.id}`);
    }
  }

  assert.deepEqual(collisions, []);
});
