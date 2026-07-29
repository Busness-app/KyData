/**
 * Schema and semantic validation for a KyData graph.
 *
 * The JSON Schema catches shape errors. The semantic pass catches the things a schema cannot
 * express — dangling edge endpoints, missing parents, parent cycles — which are exactly the
 * failures an AI refresh is most likely to introduce.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
// The schema is draft 2020-12, which needs Ajv's 2020 build rather than the draft-07 default.
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SCHEMA_PATH = new URL("../schema/kydata.schema.json", import.meta.url);

export async function loadGraph(path) {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`);
  }
}

/** Returns an array of human-readable problems. Empty means the graph is good. */
export async function validateGraph(graph) {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const problems = [];

  if (!ajv.validate(schema, graph)) {
    for (const err of ajv.errors) {
      problems.push(`schema: ${err.instancePath || "/"} ${err.message}`);
    }
    // Shape is wrong, so the semantic checks below would report noise on top of it.
    return problems;
  }

  const byId = new Map();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) problems.push(`duplicate node id: ${node.id}`);
    byId.set(node.id, node);
  }

  for (const node of graph.nodes) {
    if (node.level === 0) {
      if (node.parent != null) {
        problems.push(`${node.id} is level 0 but has parent ${node.parent}`);
      }
    } else {
      if (node.parent == null) {
        problems.push(`${node.id} is level ${node.level} but has no parent`);
      } else if (!byId.has(node.parent)) {
        problems.push(`${node.id} has parent ${node.parent}, which does not exist`);
      } else {
        const parent = byId.get(node.parent);
        if (parent.level !== node.level - 1) {
          problems.push(
            `${node.id} (level ${node.level}) has parent ${parent.id} at level ${parent.level}; ` +
              `parents must be exactly one level up`
          );
        }
      }
    }
  }

  // A parent cycle would hang the client's ancestor walk, so catch it at build time.
  for (const node of graph.nodes) {
    const seen = new Set([node.id]);
    let cur = node;
    while (cur?.parent != null) {
      if (seen.has(cur.parent)) {
        problems.push(`parent cycle involving ${node.id}`);
        break;
      }
      seen.add(cur.parent);
      cur = byId.get(cur.parent);
    }
  }

  graph.edges.forEach((edge, i) => {
    if (!byId.has(edge.from)) problems.push(`edge[${i}] from unknown node: ${edge.from}`);
    if (!byId.has(edge.to)) problems.push(`edge[${i}] to unknown node: ${edge.to}`);
    if (edge.from === edge.to) problems.push(`edge[${i}] is a self-loop on ${edge.from}`);
  });

  if (!graph.nodes.some((n) => n.level === 0)) {
    problems.push("graph has no level 0 nodes, so there is nothing to show on open");
  }

  return problems;
}

// CLI: node src/validate.js <file...>
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node src/validate.js <graph.json...>");
    process.exit(2);
  }

  let failed = false;
  for (const file of files) {
    try {
      const problems = await validateGraph(await loadGraph(file));
      if (problems.length === 0) {
        console.log(`ok   ${file}`);
      } else {
        failed = true;
        console.error(`FAIL ${file}`);
        for (const p of problems) console.error(`     ${p}`);
      }
    } catch (err) {
      failed = true;
      console.error(`FAIL ${file}\n     ${err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
