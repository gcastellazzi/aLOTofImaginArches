/**
 * Blocks: geometrical features, ordering, and the merge with applied forces.
 *
 * Ported from compute_Blocks_geometrical_features, sorting_Blocks and
 * sorted_Blocks_like in the MATLAB app.
 */

import { area, centroid } from './geometry.js';

/**
 * Areas, centroids and weights of the voussoirs.
 *
 * MATLAB applies Unit_Length_scaling to the area (squared) and to the
 * thickness, then
 *     W = A * specificWeight * thickness * unitMassToWeight
 * The scaling is carried explicitly rather than folded in, because the
 * examples were saved in two different frames and the caller has to know
 * which one it is in. See docs/app/data/README.md.
 *
 * @param {Array<{x:number[],y:number[]}>} polys
 * @param {object} opt
 * @param {number[]} opt.thickness      per block, before scaling
 * @param {number}   opt.specificWeight
 * @param {number}   opt.lengthScaling  Unit_Length_scaling, default 1
 * @param {number}   opt.massToWeight   Unit_Mass_to_Weight, default 1
 */
export function blockFeatures(polys, opt = {}) {
  const {
    thickness = [],
    specificWeight = 1,
    lengthScaling = 1,
    massToWeight = 1,
  } = opt;

  const areas = [];
  const centroids = [];
  const weights = [];
  const thick = [];

  polys.forEach((p, k) => {
    const a = area(p) * lengthScaling * lengthScaling;
    const t = (thickness[k] ?? 1) * lengthScaling;
    areas.push(a);
    thick.push(t);
    centroids.push(centroid(p));
    weights.push(a * specificWeight * t * massToWeight);
  });

  return { areas, centroids, weights, thickness: thick };
}

/**
 * The order the whole construction depends on: blocks by centroid x,
 * DESCENDING, exactly as MATLAB's sort(..., 'descend').
 *
 * Getting this backwards does not throw: it silently produces a thrust line
 * that runs the wrong way and closes nowhere near the far springing.
 *
 * @returns {number[]} indices into the original arrays
 */
export function sortOrder(centroids) {
  return centroids
    .map((c, i) => [c[0], i])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
}

/** Reorder any array with the indices from sortOrder. */
export function applyOrder(arr, order) {
  return order.map((i) => arr[i]);
}

/**
 * Merge blocks and applied point forces into one sequence, "blocks_like".
 *
 * A force is carried as a block with no area and no outline, whose weight is
 * the force magnitude and whose centroid is its point of application. From
 * the funicular construction's point of view the two are the same thing: a
 * vertical load at a station, and it is much simpler to treat them alike than
 * to special-case forces later.
 *
 * @param {object} blocks   {centroids, weights, areas, thickness}
 * @param {object} forces   {points: [[x,y],...], magnitudes: [...]}
 * @returns {object} merged and already sorted, with `kind` 0 block / 1 force
 */
export function blocksLike(blocks, forces = { points: [], magnitudes: [] }) {
  const centroids = [...blocks.centroids, ...forces.points];
  const weights = [...blocks.weights, ...forces.magnitudes];
  const areas = [...blocks.areas, ...forces.points.map(() => 0)];
  const thickness = [...blocks.thickness, ...forces.points.map(() => 0)];
  const kind = [
    ...blocks.centroids.map(() => 0),
    ...forces.points.map(() => 1),
  ];

  const order = sortOrder(centroids);
  return {
    centroids: applyOrder(centroids, order),
    weights: applyOrder(weights, order),
    areas: applyOrder(areas, order),
    thickness: applyOrder(thickness, order),
    kind: applyOrder(kind, order),
    order,
  };
}

/**
 * Voussoirs of a circular arch, as CalculateArchButtonPushed builds them.
 *
 * Angles in degrees, measured as MATLAB's pol2cart does: counter-clockwise
 * from the positive x axis.
 */
export function circularArch({
  centre = [0, 0],
  innerRadius,
  outerRadius,
  startAngle,
  endAngle,
  count,
}) {
  const polys = [];
  const step = (endAngle - startAngle) / count;
  const at = (r, k) => {
    const th = ((startAngle + k * step) * Math.PI) / 180;
    return [centre[0] + r * Math.cos(th), centre[1] + r * Math.sin(th)];
  };
  for (let j = 0; j < count; j++) {
    const i0 = at(innerRadius, j);
    const o0 = at(outerRadius, j);
    const o1 = at(outerRadius, j + 1);
    const i1 = at(innerRadius, j + 1);
    polys.push({
      x: [i0[0], o0[0], o1[0], i1[0]],
      y: [i0[1], o0[1], o1[1], i1[1]],
    });
  }
  return polys;
}
