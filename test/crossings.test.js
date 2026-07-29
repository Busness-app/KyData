import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIndex, computeVisible } from "../src/graph.js";
import { arcSpan, radialLayout, ringOrder } from "../src/ring.js";
import { loadGraph } from "../src/validate.js";

const KYPOST = new URL("../data/kypost.json", import.meta.url).pathname;

/**
 * Do two straight segments properly cross? Shared endpoints don't count — edges are allowed to
 * meet at the node they have in common.
 */
function segmentsCross(p, q, r, s) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(p, q, r);
  const d2 = side(p, q, s);
  const d3 = side(r, s, p);
  const d4 = side(r, s, q);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Crossings in the overview, drawn as straight lines.
 *
 * The rendered edges curve, but the curvature is chosen to move edges away from things, never
 * toward them: spokes are straight and rim chords bow outward from the hub. So a layout with no
 * straight-line crossings is the property that matters, and it is the one this can check
 * without a browser.
 */
function overviewCrossings(placed, links) {
  const byId = new Map(placed.map((n) => [n.id, n]));
  let count = 0;

  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const a = links[i];
      const b = links[j];
      if (
        a.source === b.source ||
        a.source === b.target ||
        a.target === b.source ||
        a.target === b.target
      ) {
        continue;
      }
      if (
        segmentsCross(byId.get(a.source), byId.get(a.target), byId.get(b.source), byId.get(b.target))
      ) {
        count++;
      }
    }
  }
  return count;
}

async function overview() {
  const graph = await loadGraph(KYPOST);
  const index = buildIndex(graph);
  return computeVisible(graph, index, new Set());
}

test("the KyPost overview is a hub with a ring around it", async () => {
  const { nodes, links } = await overview();
  const plan = radialLayout(nodes, links);

  assert.ok(plan, "the overview should qualify for a radial layout");
  assert.equal(plan.hubId, "server", "the server is what everything else connects to");
  assert.equal(plan.ringIds.length, nodes.length - 1, "everything else belongs on the ring");
});

test("no two edges cross in the KyPost overview", async () => {
  const { nodes, links } = await overview();
  const plan = radialLayout(nodes, links);

  const placed = nodes.map((n) => {
    if (n.id === plan.hubId) return { ...n, x: 0, y: 0 };
    const angle = plan.angles.get(n.id);
    return { ...n, x: Math.cos(angle) * plan.radius, y: Math.sin(angle) * plan.radius };
  });

  assert.equal(overviewCrossings(placed, links), 0);
});

test("a graph with no dominant hub is left to settle instead", async () => {
  // A ring of four with no centre: no node reaches all the others, so a hub layout is a lie.
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id, label: id }));
  const links = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "d" }
  ];
  assert.equal(radialLayout(nodes, links), null);
});

test("the ring pulls connected pairs adjacent, not merely uncrossed", async () => {
  const { nodes, links } = await overview();
  const hub = "server";

  const ring = nodes.filter((n) => n.id !== hub).map((n) => n.id);
  const rim = links
    .filter((l) => l.source !== hub && l.target !== hub)
    .map((l) => ({ from: l.source, to: l.target }));

  const order = ringOrder(ring, rim);
  const pairs = rim.map((e) => [e.from, e.to]);

  // Four rim edges, every one of them between neighbours. An arc that reached over an
  // intervening node would still cross that node's own spoke to the hub.
  assert.equal(arcSpan(order, pairs), pairs.length);
});

test("arcSpan measures the short way around the ring", () => {
  const order = ["a", "b", "c", "d", "e"];
  assert.equal(arcSpan(order, [["a", "b"]]), 1);
  assert.equal(arcSpan(order, [["a", "e"]]), 1, "wrapping past the end is still one step");
  assert.equal(arcSpan(order, [["a", "c"]]), 2);
});
