/**
 * Layout forces shared by the build-time seeding pass and the live simulation.
 *
 * Both need to agree: if the seed pass does not know a rule, it produces a starting layout that
 * violates it, and the browser has to fix it on load — visibly, and only if the simulation gets
 * far enough. Keeping the rules in one place means the seed is already correct.
 */

/** Matches the curvature used when the edge is drawn. See the bow in the client's tick(). */
export const BOW = 0.14;

/**
 * The control point of the quadratic curve an edge is drawn as, given its trimmed endpoints.
 * Rendering and layout must derive this the same way or they are describing different lines.
 */
export function curveControl(x1, y1, x2, y2, ux, uy, length) {
  const bow = length * BOW;
  return {
    cx: (x1 + x2) / 2 - uy * bow,
    cy: (y1 + y2) / 2 + ux * bow
  };
}

/**
 * Custom force: a node never sits on an edge it is not an endpoint of.
 *
 * This is the difference between a diagram and a mess. When an unrelated node parks in the
 * middle of a connection, the line appears to terminate there, and the reader has to trace
 * around it to find out it doesn't.
 *
 * It measures against the curve the edge is actually drawn as, not the straight line between
 * the two nodes. Those are far apart in the middle — exactly where this matters — so checking
 * the chord passes nodes that are sitting squarely on the visible line.
 *
 * @param {object} options
 * @param {Array}  options.links     objects with resolved `source` and `target` nodes
 * @param {Function} options.radius  node -> drawn radius
 * @param {number} options.strength
 * @param {number} options.clearance gap to keep between the curve and the node's edge
 */
export function forceEdgeClearance({ links, radius, strength = 0.55, clearance = 18 }) {
  let nodes = [];

  // Sampled across the middle of the curve. The ends are where an edge meets its own nodes,
  // which is the collision force's business, not this one.
  const SAMPLES = [0.15, 0.27, 0.39, 0.5, 0.61, 0.73, 0.85];

  function force(alpha) {
    for (const link of links) {
      const a = link.source;
      const b = link.target;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) continue;

      const ux = dx / length;
      const uy = dy / length;

      const ar = radius(a) + 3;
      const br = radius(b) + 3;
      const x1 = a.x + ux * ar;
      const y1 = a.y + uy * ar;
      const x2 = b.x - ux * br;
      const y2 = b.y - uy * br;

      const { cx, cy } = curveControl(x1, y1, x2, y2, ux, uy, length);

      for (const node of nodes) {
        if (node === a || node === b) continue;

        // Closest point on the curve, by sampling. Exact would need a quartic solve for a
        // result no more useful than this at the scale anything is drawn.
        let bestDist = Infinity;
        let bestX = 0;
        let bestY = 0;

        for (const t of SAMPLES) {
          const m = 1 - t;
          const px = m * m * x1 + 2 * m * t * cx + t * t * x2;
          const py = m * m * y1 + 2 * m * t * cy + t * t * y2;
          const d = Math.hypot(node.x - px, node.y - py);
          if (d < bestDist) {
            bestDist = d;
            bestX = px;
            bestY = py;
          }
        }

        const want = clearance + radius(node);
        if (bestDist >= want) continue;

        let ox = node.x - bestX;
        let oy = node.y - bestY;
        let dist = bestDist;

        // Sitting exactly on the line: pick the perpendicular so it still gets pushed off.
        if (dist < 0.01) {
          ox = -uy;
          oy = ux;
          dist = 1;
        }

        const push = (want - dist) * strength * alpha;
        node.vx += (ox / dist) * push;
        node.vy += (oy / dist) * push;

        // Let the edge give a little too, so a node wedged between two others can escape.
        a.vx -= (ox / dist) * push * 0.2;
        a.vy -= (oy / dist) * push * 0.2;
        b.vx -= (ox / dist) * push * 0.2;
        b.vy -= (oy / dist) * push * 0.2;
      }
    }
  }

  force.initialize = (n) => {
    nodes = n;
  };
  return force;
}
