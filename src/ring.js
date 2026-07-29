/**
 * Pure geometry for the ring layout used when a system is opened.
 *
 * Kept free of the DOM and of module state so the rules it encodes — connected children end
 * up adjacent, and nothing is placed on top of anything else — can be tested directly.
 */

/**
 * Order children around the ring so the ones wired together end up next to each other.
 *
 * On a ring, an edge between neighbours is a short arc and an edge between opposite sides is a
 * chord straight through the middle. Eleven children in arbitrary order means a dozen chords
 * crossing in the centre — the same hairball, in a circle. Sequencing them by adjacency turns
 * most of those chords back into short hops around the rim.
 */
export function ringOrder(childIds, edges) {
  const set = new Set(childIds);
  const adj = new Map(childIds.map((id) => [id, new Set()]));

  for (const edge of edges) {
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
  // finish by scoring the whole arrangement and swapping pairs while the score keeps falling.
  // A dozen children is small enough that this is free.
  const pairs = [];
  for (const [from, neighbours] of adj) {
    for (const to of neighbours) if (from < to) pairs.push([from, to]);
  }

  let best = cost(order, pairs);
  let improved = true;

  while (improved && best > 0) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        [order[i], order[j]] = [order[j], order[i]];
        const score = cost(order, pairs);
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

/**
 * What a given order costs.
 *
 * Span dominates. Counting only crossings treats "adjacent" and "three places apart" as equally
 * good so long as no two chords intersect — but an arc reaching over an intervening node still
 * has to cross that node's own connection to the hub. Pulling connected pairs together fixes
 * both problems at once; crossings only break ties between arrangements of equal span.
 */
function cost(order, pairs) {
  return arcSpan(order, pairs) * 100 + crossings(order, pairs);
}

/** Total distance around the ring between connected pairs, the short way round. */
export function arcSpan(order, pairs) {
  const pos = new Map(order.map((id, i) => [id, i]));
  const n = order.length;

  let total = 0;
  for (const [a, b] of pairs) {
    const gap = Math.abs(pos.get(a) - pos.get(b));
    total += Math.min(gap, n - gap);
  }
  return total;
}

/** How many chords cross, for a given order around the circle. */
export function crossings(order, pairs) {
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
 * Place items at their requested angles, moving them only as far as it takes to stop touching.
 *
 * Spreading them evenly around the whole circle instead is what pulled connected things apart:
 * three push services all pointing at the same module were dealt a third of the circle each and
 * ended up nowhere near it, or each other, with their edges crossing everything between. Nodes
 * that want to be in the same place should end up side by side.
 */
export function spreadAngles(targets, widths) {
  const n = targets.length;
  if (n === 1) return [...targets];

  const gap = (i, j) => (widths[i] + widths[j]) / 2;

  // If they cannot all fit, nothing is close to its target anyway — space them out evenly.
  let needed = 0;
  for (let i = 0; i < n; i++) needed += gap(i, (i + 1) % n);
  if (needed >= Math.PI * 2) {
    const step = (Math.PI * 2) / n;
    const offset = circularMean(targets.map((t, i) => t - i * step));
    return targets.map((_, i) => offset + i * step);
  }

  const angles = [...targets];

  const separate = () => {
    // Push apart any neighbouring pair that is too close, sharing the correction between them.
    for (let i = 0; i < n - 1; i++) {
      const overlap = gap(i, i + 1) - (angles[i + 1] - angles[i]);
      if (overlap > 0) {
        angles[i] -= overlap / 2;
        angles[i + 1] += overlap / 2;
      }
    }

    // The pair that straddles the seam, measured the long way round.
    const seam = gap(n - 1, 0) - (angles[0] + Math.PI * 2 - angles[n - 1]);
    if (seam > 0) {
      angles[n - 1] -= seam / 2;
      angles[0] += seam / 2;
    }
  };

  for (let pass = 0; pass < 80; pass++) {
    separate();
    // Then ease everything back toward where it actually wanted to be.
    for (let i = 0; i < n; i++) angles[i] += (targets[i] - angles[i]) * 0.08;
  }

  // Finish on separation alone. Easing back is what closes a gap that was just opened, and
  // ending on it leaves pairs fractionally overlapping — which is all it takes for two labels
  // to sit on top of each other.
  for (let pass = 0; pass < 24; pass++) separate();

  return angles;
}

/** Mean of angles, via unit vectors — averaging the numbers breaks across the ±π seam. */
export function circularMean(angles) {
  let sx = 0;
  let sy = 0;
  for (const a of angles) {
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  return Math.atan2(sy, sx);
}

/**
 * A hub-and-ring arrangement for a graph that genuinely has a hub.
 *
 * A star drawn as a star has no crossings at all: the spokes are radial, and every remaining
 * edge runs between two ring members, which is a short arc along the rim provided the ring is
 * ordered so connected pairs sit together. Left to a force layout the same graph settles into
 * whatever balance the forces find, and those non-spoke edges end up cutting across it.
 *
 * Returns null when no node reaches every other one — then a ring is the wrong shape and the
 * caller should fall back to letting the layout settle.
 *
 * Arc is allocated by label width rather than evenly, because a long name needs more room on
 * the rim than a short one and even spacing is what makes them collide.
 */
export function radialLayout(nodes, links, options = {}) {
  const labelWidth = options.labelWidth ?? ((n) => n.label.length * 8 + 46);
  const minRadius = options.minRadius ?? 150;

  if (nodes.length < 4) return null;

  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }

  const hub = [...nodes].sort(
    (a, b) => degree.get(b.id) - degree.get(a.id) || (a.id < b.id ? -1 : 1)
  )[0];

  const reaches = new Set();
  for (const link of links) {
    if (link.source === hub.id) reaches.add(link.target);
    if (link.target === hub.id) reaches.add(link.source);
  }
  if (reaches.size < nodes.length - 1) return null;

  const ring = nodes.filter((n) => n.id !== hub.id);
  const rim = links
    .filter((l) => l.source !== hub.id && l.target !== hub.id)
    .map((l) => ({ from: l.source, to: l.target }));

  const order = ringOrder(
    ring.map((n) => n.id),
    rim
  );

  const byId = new Map(ring.map((n) => [n.id, n]));
  const widths = order.map((id) => labelWidth(byId.get(id)));
  const total = widths.reduce((a, b) => a + b, 0);
  const radius = Math.max(minRadius, total / (Math.PI * 2));

  const angles = new Map();
  let travelled = 0;
  order.forEach((id, i) => {
    // Start at the top and go clockwise, so the diagram has a reading order.
    angles.set(id, -Math.PI / 2 + ((travelled + widths[i] / 2) / total) * Math.PI * 2);
    travelled += widths[i];
  });

  return { hubId: hub.id, ringIds: order, radius, angles };
}
