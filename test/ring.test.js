import { test } from "node:test";
import assert from "node:assert/strict";

import { circularMean, crossings, ringOrder, spreadAngles } from "../src/ring.js";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- ring ordering

test("connected children end up next to each other on the ring", () => {
  // Two clusters that share no edges. A good order keeps each cluster contiguous.
  const children = ["a1", "a2", "a3", "b1", "b2", "b3"];
  const edges = [
    { from: "a1", to: "a2" },
    { from: "a2", to: "a3" },
    { from: "a3", to: "a1" },
    { from: "b1", to: "b2" },
    { from: "b2", to: "b3" },
    { from: "b3", to: "b1" }
  ];

  const order = ringOrder(children, edges);
  const positions = order.map((id) => id[0]);

  // Walking the ring should change cluster exactly twice, never interleave.
  let switches = 0;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] !== positions[(i + 1) % positions.length]) switches++;
  }
  assert.equal(switches, 2, `clusters were interleaved: ${order.join(", ")}`);
});

test("ordering beats the order the children happened to arrive in", () => {
  // A ring where the naive order crosses badly: every node joined to the one opposite it.
  const children = ["n0", "n1", "n2", "n3", "n4", "n5"];
  const edges = [
    { from: "n0", to: "n3" },
    { from: "n1", to: "n4" },
    { from: "n2", to: "n5" }
  ];

  const pairs = edges.map((e) => [e.from, e.to]);
  const naive = crossings(children, pairs);
  const tuned = crossings(ringOrder(children, edges), pairs);

  assert.ok(tuned < naive, `expected fewer crossings than ${naive}, got ${tuned}`);
  assert.equal(tuned, 0, "this graph can be drawn on a circle with no crossings");
});

test("ordering is stable across runs", () => {
  const children = ["a", "b", "c", "d", "e"];
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "d", to: "e" }
  ];
  assert.deepEqual(ringOrder(children, edges), ringOrder(children, edges));
});

test("ordering keeps every child exactly once", () => {
  const children = ["a", "b", "c", "d"];
  const order = ringOrder(children, [{ from: "a", to: "c" }]);
  assert.deepEqual([...order].sort(), [...children].sort());
});

test("crossings counts chords that actually cross", () => {
  // On the ring a,b,c,d: the chords a-c and b-d cross; a-b and c-d do not.
  const order = ["a", "b", "c", "d"];
  assert.equal(crossings(order, [["a", "c"], ["b", "d"]]), 1);
  assert.equal(crossings(order, [["a", "b"], ["c", "d"]]), 0);
});

// ---------------------------------------------------------------- angle spreading

/** The rule: nothing may be placed close enough to touch its neighbour. */
function assertNoOverlap(angles, widths) {
  const order = angles.map((a, i) => ({ a, i })).sort((p, q) => p.a - q.a);

  for (let k = 0; k < order.length; k++) {
    const cur = order[k];
    const next = order[(k + 1) % order.length];
    const raw = next.a - cur.a;
    const gap = k === order.length - 1 ? raw + TAU : raw;
    const need = (widths[cur.i] + widths[next.i]) / 2;

    assert.ok(
      gap >= need - 1e-6,
      `items ${cur.i} and ${next.i} overlap: gap ${gap.toFixed(3)} < needed ${need.toFixed(3)}`
    );
  }
}

test("items wanting the same angle are placed side by side, not spread around the circle", () => {
  // Three push services all pointing at one module — the case that was failing.
  const targets = [0, 0.02, 0.04];
  const widths = [0.3, 0.3, 0.3];

  const angles = spreadAngles(targets, widths);
  assertNoOverlap(angles, widths);

  // They must stay clustered: the whole set spans a little over two gaps, not a third of the
  // circle each, and remains near where it asked to be.
  const span = Math.max(...angles) - Math.min(...angles);
  assert.ok(span < 0.75, `expected a tight cluster, got a span of ${span.toFixed(3)}`);
  assert.ok(Math.abs(circularMean(angles) - 0.02) < 0.2, "the cluster drifted off its target");
});

test("spreading never leaves two items overlapping", () => {
  const targets = [0.1, 0.15, 0.2, 2.0, 2.05, 4.0];
  const widths = [0.4, 0.35, 0.5, 0.3, 0.45, 0.4];
  assertNoOverlap(spreadAngles(targets, widths), widths);
});

test("items far apart are left where they asked to be", () => {
  const targets = [0, TAU / 3, (TAU * 2) / 3];
  const widths = [0.2, 0.2, 0.2];

  const angles = spreadAngles(targets, widths);
  angles.forEach((a, i) => {
    assert.ok(Math.abs(a - targets[i]) < 1e-6, `item ${i} moved when it did not need to`);
  });
});

test("when they cannot all fit, they are spaced evenly rather than piled up", () => {
  // Widths summing past a full circle: no arrangement satisfies everyone.
  const targets = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const widths = [1.4, 1.4, 1.4, 1.4, 1.4, 1.4];

  const angles = spreadAngles(targets, widths);
  const sorted = [...angles].sort((a, b) => a - b);

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    assert.ok(Math.abs(gap - TAU / 6) < 1e-6, `expected even spacing, got a gap of ${gap}`);
  }
});

test("a single item stays exactly on its target", () => {
  assert.deepEqual(spreadAngles([1.23], [0.5]), [1.23]);
});

// ---------------------------------------------------------------- circular mean

test("circular mean averages across the wrap point", () => {
  // Just either side of ±π: the plain average would land at 0, the opposite side of the circle.
  const mean = circularMean([Math.PI - 0.1, -Math.PI + 0.1]);
  assert.ok(Math.abs(Math.abs(mean) - Math.PI) < 1e-6, `expected ±π, got ${mean}`);
});

test("circular mean of a tight cluster sits in the middle of it", () => {
  assert.ok(Math.abs(circularMean([0.4, 0.5, 0.6]) - 0.5) < 1e-6);
});
