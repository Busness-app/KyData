import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIndex, computeVisible, hasChildren, liftToVisible } from "../src/graph.js";
import { seedPositions } from "../src/layout.js";
import { validateGraph, loadGraph } from "../src/validate.js";

/** Two systems, each with children, plus one edge authored between deep children. */
const graph = {
  meta: { project: "Test", generated: "2026-07-29" },
  nodes: [
    { id: "a", label: "A", level: 0, parent: null, kind: "service" },
    { id: "a.one", label: "A One", level: 1, parent: "a", kind: "module" },
    { id: "a.two", label: "A Two", level: 1, parent: "a", kind: "module" },
    { id: "b", label: "B", level: 0, parent: null, kind: "client" },
    { id: "b.one", label: "B One", level: 1, parent: "b", kind: "module" }
  ],
  edges: [
    { from: "a.one", to: "b.one", kind: "api-call", sensitivity: "secret" },
    { from: "a.one", to: "a.two", kind: "depends" }
  ]
};

test("level 0 view lifts deep edges onto their visible ancestors", () => {
  const index = buildIndex(graph);
  const { nodes, links } = computeVisible(graph, index, new Set());

  assert.deepEqual(
    nodes.map((n) => n.id),
    ["a", "b"]
  );

  // a.one -> b.one becomes a -> b; a.one -> a.two is internal to a and disappears.
  assert.equal(links.length, 1);
  assert.equal(links[0].source, "a");
  assert.equal(links[0].target, "b");
});

test("an edge whose endpoints collapse into one node is dropped, not self-looped", () => {
  const index = buildIndex(graph);
  const { links } = computeVisible(graph, index, new Set());
  assert.ok(links.every((l) => l.source !== l.target));
});

test("expanding reveals children and un-lifts their edges", () => {
  const index = buildIndex(graph);
  const { nodes, links } = computeVisible(graph, index, new Set(["a"]));

  assert.deepEqual(
    nodes.map((n) => n.id).sort(),
    ["a", "a.one", "a.two", "b"]
  );

  // Now that a.one is visible the api-call attaches to it directly.
  const apiCall = links.find((l) => l.kind === "api-call");
  assert.equal(apiCall.source, "a.one");
  assert.equal(apiCall.target, "b");

  // And the previously-internal depends edge is now a real line.
  assert.ok(links.some((l) => l.kind === "depends"));
});

test("merged edges keep every authored source and the most sensitive classification", () => {
  const multi = {
    ...graph,
    edges: [
      { from: "a.one", to: "b.one", kind: "api-call", sensitivity: "public" },
      { from: "a.two", to: "b.one", kind: "push", sensitivity: "secret" }
    ]
  };
  const index = buildIndex(multi);
  const { links } = computeVisible(multi, index, new Set());

  assert.equal(links.length, 1);
  assert.equal(links[0].sources.length, 2);
  assert.equal(links[0].sensitivity, "secret", "a merged line reports its worst case");
});

test("edges authored in both directions render as bidirectional", () => {
  const both = {
    ...graph,
    edges: [
      { from: "a.one", to: "b.one", kind: "api-call" },
      { from: "b.one", to: "a.two", kind: "data-flow" }
    ]
  };
  const index = buildIndex(both);
  const { links } = computeVisible(both, index, new Set());

  assert.equal(links.length, 1);
  assert.equal(links[0].both, true);
});

test("liftToVisible walks up to the nearest on-screen ancestor", () => {
  const index = buildIndex(graph);
  const visible = new Set(["a", "b"]);
  assert.equal(liftToVisible(index, visible, "a.one"), "a");
  assert.equal(liftToVisible(index, visible, "b"), "b");
});

test("hasChildren distinguishes expandable nodes from leaves", () => {
  const index = buildIndex(graph);
  assert.equal(hasChildren(index, "a"), true);
  assert.equal(hasChildren(index, "a.one"), false);
});

test("layout seeding is deterministic, so rebuilds do not reshuffle the graph", () => {
  const first = seedPositions(graph);
  const second = seedPositions(graph);
  assert.deepEqual(first, second);
});

test("every node gets a seed position", () => {
  const seeds = seedPositions(graph);
  for (const node of graph.nodes) {
    assert.ok(Number.isFinite(seeds[node.id]?.x), `${node.id} has no seed`);
  }
});

// ---------------------------------------------------------------- validation

test("a valid graph reports no problems", async () => {
  assert.deepEqual(await validateGraph(graph), []);
});

test("dangling edge endpoints are caught", async () => {
  const broken = { ...graph, edges: [{ from: "a", to: "nope", kind: "depends" }] };
  const problems = await validateGraph(broken);
  assert.ok(problems.some((p) => p.includes("nope")));
});

test("a child whose parent is missing is caught", async () => {
  const broken = {
    ...graph,
    nodes: [...graph.nodes, { id: "orphan", label: "O", level: 1, parent: "ghost", kind: "module" }]
  };
  const problems = await validateGraph(broken);
  assert.ok(problems.some((p) => p.includes("ghost")));
});

test("a child more than one level below its parent is caught", async () => {
  const broken = {
    ...graph,
    nodes: [...graph.nodes, { id: "deep", label: "D", level: 2, parent: "a", kind: "module" }]
  };
  const problems = await validateGraph(broken);
  assert.ok(problems.some((p) => p.includes("exactly one level up")));
});

test("duplicate ids are caught", async () => {
  const broken = { ...graph, nodes: [...graph.nodes, { ...graph.nodes[0] }] };
  const problems = await validateGraph(broken);
  assert.ok(problems.some((p) => p.includes("duplicate")));
});

test("the shipped KyPost graph is valid", async () => {
  const kypost = await loadGraph(new URL("../data/kypost.json", import.meta.url).pathname);
  assert.deepEqual(await validateGraph(kypost), []);
});
