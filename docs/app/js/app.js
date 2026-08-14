/**
 * aLOTofImaginArches, in the browser.
 *
 * Wiring only: the mechanics lives in js/core, the drawing in js/render. This
 * file loads an example, keeps one piece of state, and redraws.
 */

import { Axes } from './render/axes.js';
import {
  drawBlocks, drawThrustLine, drawCable, drawWeights, drawSupports,
  drawForcePolygon, drawArrow, drawThrustLabels, labelStride,
  drawHinges, drawMacroBlocks, drawMechanism, drawCentres,
} from './render/draw.js';
import { bounds, area as signedAreaOf } from './core/geometry.js';
import {
  forcePolygon, funicular, poleFromForcePolygon, hangingCable, jointCrossings,
  freeThrustLine,
} from './core/statics.js';
import { fromExample, poleOf, consistency } from './core/model.js';
import {
  blocksBetween, checkTrace, weighBlocks, centroidsOf, springings,
} from './core/trace.js';
import { blocksLike } from './core/blocks.js';
import {
  SYSTEMS, unitsPerPixel, scaleModel, format, archDimensions,
} from './core/units.js';

import { serialise, deserialise, suggestedName } from './core/persist.js';
import {
  bestLineForThrust, collapseRange, analyse, displacedConfiguration, displaced,
} from './core/mechanism.js';

const DATA = 'data/examples/';

const el = (id) => document.getElementById(id);
const ui = {
  example: el('example'), meta: el('meta'), warn: el('warn'),
  thrust: el('thrust'), thrustValue: el('thrustValue'), reset: el('reset'),
  startPos: el('startPos'), startValue: el('startValue'),
  split: el('split'), splitValue: el('splitValue'),
  saveState: el('saveState'), loadState: el('loadState'),
  stateFile: el('stateFile'), saveStatus: el('saveStatus'),
  showImage: el('showImage'), showBlocks: el('showBlocks'),
  showWeights: el('showWeights'), showThrust: el('showThrust'),
  showCable: el('showCable'), showLabels: el('showLabels'),
  showRays: el('showRays'), showMech: el('showMech'),
  mechOn: el('mechOn'), mechVerdict: el('mechVerdict'),
  mechCount: el('mechCount'), mechBand: el('mechBand'),
  mechAmp: el('mechAmp'), goHmin: el('goHmin'), goHmax: el('goHmax'),
  showJoints: el('showJoints'), admissible: el('admissible'),
  flipY: el('flipY'),
  imageFile: el('imageFile'), traceInner: el('traceInner'),
  traceOuter: el('traceOuter'), traceHint: el('traceHint'),
  nBlocks: el('nBlocks'), gamma: el('gamma'), thick: el('thick'),
  thickLabel: el('thickLabel'),
  makeBlocks: el('makeBlocks'), clearTrace: el('clearTrace'),
  traceStatus: el('traceStatus'), gammaLabel: el('gammaLabel'),
  forceMag: el('forceMag'), forceLabel: el('forceLabel'),
  addForce: el('addForce'), clearForces: el('clearForces'),
  forceList: el('forceList'),
  system: el('system'), pickRef: el('pickRef'), refLength: el('refLength'),
  applyScale: el('applyScale'), scaleStatus: el('scaleStatus'),
};

const mainAx = new Axes(el('main'), { equal: true, yUp: true });
const forceAx = new Axes(el('force'), { equal: true, yUp: true });
mainAx.xlabel = 'x';
mainAx.ylabel = 'y';
forceAx.title = 'Force polygon';

/** Everything the drawing depends on. */
const state = {
  model: null,
  image: null,
  basePole: null,   // the pole as saved: thrust slider is relative to it
  mech: null,       // the hinge analysis, when the mechanism tab is driving
  band: null,       // the two collapse thrusts, once computed
  bandKey: null,    // what the band was computed for
  pole: null,
  fp: null,
  lot: null,
  consistent: null,
  // Tracing: the two curves the user is drawing, and which one is armed.
  trace: { inner: [], outer: [], armed: null, cursor: null },
  // Scale: the two picked reference points, and the system in force.
  ref: { points: [], picking: false },
  system: 'SI',
  // Applied point loads: where they act, how big, and whether we are placing.
  forces: { points: [], magnitudes: [], placing: false },
};

async function loadCatalogue() {
  const res = await fetch(`${DATA}index.json`);
  const cat = await res.json();
  ui.example.innerHTML = '';
  for (const e of cat.examples) {
    const o = document.createElement('option');
    o.value = e.file;
    o.textContent = `${e.name.replace(/_/g, ' ')}  (${e.blocks ?? '?'} blocks)`;
    ui.example.append(o);
  }
  const preferred = cat.examples.find((e) => /Heyman/.test(e.name));
  ui.example.value = (preferred ?? cat.examples[0]).file;
  await loadExample(ui.example.value);
}

async function loadExample(file) {
  const json = await (await fetch(DATA + file)).json();
  const model = fromExample(json);
  state.model = model;
  state.consistent = consistency(model);

  // The pole the example was saved with; the slider moves around it.
  try {
    state.basePole = poleOf(model, poleFromForcePolygon).pole;
  } catch {
    state.basePole = null;
  }
  ui.thrust.value = 50;

  // The saved examples were traced in MATLAB axes with y increasing UPWARD,
  // even when the coordinates are image pixels, because the user flips the
  // axis before tracing. So the default is the mathematical convention, and
  // the Flip Y button is there for the cases where it was not.
  ui.flipY.checked = false;
  mainAx.yUp = true;

  state.trace = { inner: [], outer: [], armed: null, cursor: null };
  state.forces = { points: [], magnitudes: [], placing: false };
  state.image = null;
  if (model.image) {
    const img = new Image();
    img.onload = () => { state.image = img; draw(); };
    img.src = DATA + model.image;
  }

  describe();
  recompute();
  fitViews();
  draw();
}

function describe() {
  const m = state.model;
  const parts = [
    `${m.weights?.length ?? m.blocks.length} blocks`,
    m.units ? `units: ${m.units}` : null,
    `coordinates: ${m.frame.coordinates}`,
  ].filter(Boolean);
  ui.meta.textContent = parts.join(' · ');

  if (state.consistent && !state.consistent.ok) {
    ui.warn.hidden = false;
    ui.warn.textContent =
      `Stored solution not recomputable: ${state.consistent.reason}. ` +
      'The thrust line shown is the one saved with the example.';
  } else {
    ui.warn.hidden = true;
  }
}

/**
 * The two joints the thrust line runs between, or null.
 *
 * `start` is the right-hand springing, because the weights are ordered by
 * descending x and the walk goes with them. Only a traced arch has joints; a
 * stored example carries just its two springing POINTS, and its ends stay
 * where the file put them.
 */
function endJoints() {
  const j = state.model?.joints;
  if (!j || j.length < 2) return null;
  const midX = (k) => (k.a[0] + k.b[0]) / 2;
  const first = j[0];
  const last = j[j.length - 1];
  return midX(last) >= midX(first)
    ? { start: last, end: first }
    : { start: first, end: last };
}

/** The total load, blocks and applied forces together. */
function totalLoad() {
  const w = (state.model?.weights ?? []).reduce((s, v) => s + v, 0);
  const f = (state.forces?.magnitudes ?? []).reduce((s, v) => s + v, 0);
  return w + f;
}

/** Say where the line leaves one springing and where it arrives at the other. */
function reportEnds(ends) {
  const on = !!ends;
  ui.startPos.disabled = !on;
  ui.split.disabled = !on;
  if (!on) {
    ui.startValue.textContent = 'needs a traced arch';
    ui.splitValue.textContent = 'fixed by the stored force polygon';
    return;
  }
  const place = (s) => (s < 0 ? `${(-100 * s).toFixed(0)}% below the intrados`
    : s > 1 ? `${(100 * (s - 1)).toFixed(0)}% beyond the extrados`
      : `${(100 * s).toFixed(0)}% of the way to the extrados`);
  ui.startValue.textContent = `leaves the springing ${place(state.startFraction)}`;
  ui.splitValue.textContent = Number.isFinite(state.endFraction)
    ? `${ui.split.value}% of the weight here; the line arrives `
      + `${place(state.endFraction)}`
    : `${ui.split.value}% of the weight here; the line does not reach the joint`;
}

/**
 * How often to letter the rays, shared by both drawings.
 *
 * Segment j of the thrust line is parallel to ray j and carries the same
 * letter, so the two drawings MUST be lettered with the same stride or the
 * correspondence -- the entire point of the notation -- silently breaks.
 */
function raysStride() {
  return labelStride(state.fp ? state.fp.stations.length : 0);
}

/**
 * Hinges, macro-blocks and the degree of freedom, from the line just computed.
 *
 * The count is the classical one: the two springings are hinges throughout, so
 * h hinges carry h-1 bodies and the arch has 3(h-1) - 2h = h - 3 degrees of
 * freedom. Two hinges is once hyperstatic and undetermined, three is the
 * three-pin arch, four is a mechanism.
 */
function reportMechanism(thrustFraction) {
  const m = state.model;
  if (!m.joints || !state.crossings) {
    state.mech = null;
    ui.mechVerdict.className = 'verdict';
    ui.mechVerdict.textContent = 'needs a traced arch, which has joints';
    ui.mechCount.textContent = '';
    ui.mechAmp.disabled = true;
    return;
  }

  const a = analyse(state.crossings, m.joints, m.blocks.length);
  state.mech = a;

  ui.mechVerdict.className = `verdict ${a.dof > 0 ? 'bad' : a.dof === 0 ? 'ok' : ''}`;
  ui.mechVerdict.textContent = a.verdict;

  const faces = a.hinges
    .map((h, i) => `${String.fromCharCode(65 + i)} ${h.support ? 'support' : h.face}`)
    .join(', ');
  ui.mechCount.textContent =
    `${a.hingeCount} hinges (${faces}) · ${a.bodyCount} `
    + `${a.bodyCount === 1 ? 'body' : 'bodies'} · constraint multiplicity `
    + `${a.constraints} · 3×${a.bodyCount} − ${a.constraints} = ${a.dof}`;

  ui.mechAmp.disabled = a.dof <= 0;
  if (a.dof <= 0) ui.mechAmp.value = 0;

  if (state.band && thrustFraction !== undefined) {
    const scaled = m.frame && m.frame.coordinates === 'physical';
    const show = (f) => (scaled
      ? format(f * totalLoad(), 'force', state.system)
      : `${(f * totalLoad()).toPrecision(4)} (unscaled)`);
    ui.mechBand.textContent =
      `stands between H = ${show(state.band.min)} and ${show(state.band.max)}`
      + `  ·  now ${(thrustFraction / state.band.max).toFixed(2)} of H max`;
  }
}

/** Where the thrust slider must sit to ask for a given thrust fraction. */
function sliderForThrust(f) {
  const band = state.band;
  if (!band) return 50;
  const lo = band.min * 0.85;
  const hi = band.max * 1.15;
  return Math.max(0, Math.min(100, Math.round((100 * (f - lo)) / (hi - lo))));
}

/** Rebuild the force polygon and the thrust line for the current pole. */
function recompute() {
  const m = state.model;
  state.fp = null;
  state.lot = null;

  if (!state.consistent.ok) {
    // Cannot recompute; show what was stored, and say so.
    state.lot = m.thrustLine
      ? { points: m.thrustLine, closed: true, closureError: 0 }
      : null;
    ui.thrust.disabled = true;
    ui.thrustValue.textContent = 'not available for this example';
    reportEnds(null);
    return;
  }
  ui.thrust.disabled = false;

  // The slider scales the pole's distance from the load line between a fifth
  // and five times what the example was saved with, on a log scale so the
  // middle of the travel is the saved state.
  const t = (Number(ui.thrust.value) - 50) / 50;      // -1 .. 1
  const factor = Math.pow(5, t);
  // The pole's ORDINATE is left exactly where it was. For a stored example it
  // is the one recovered from the saved force polygon, and moving it would
  // stop the app reproducing that example at the middle of the slider.
  // Adding a load lengthens the load line, which is the view's problem, not
  // the pole's.
  // The pole's ORDINATE divides the load line, and so divides the total weight
  // between the two vertical reactions: at half the load the arch is
  // symmetric. For a stored example it is left exactly where the saved force
  // polygon put it -- moving it would stop the app reproducing that example at
  // the middle of the slider -- and the slider is disabled. A traced arch has
  // joints, so its ends can slide and the ordinate becomes a free parameter.
  const ends = endJoints();
  let ordinate = state.basePole[1];
  if (ends) {
    const share = Number(ui.split.value) / 100;      // of the total weight
    ordinate = -totalLoad() * share;
  }
  const pole = [state.basePole[0] * factor, ordinate];
  state.pole = pole;

  // Blocks and applied forces go into ONE sequence, ordered by x. From the
  // funicular's point of view a point load at a station is a load at a
  // station, and the whole construction is indifferent to which it is.
  const seq = blocksLike(
    { centroids: m.centroids, weights: m.weights,
      areas: m.areas ?? m.centroids.map(() => 0),
      thickness: m.thickness ?? m.centroids.map(() => 0) },
    state.forces,
  );
  state.seq = seq;

  // MECHANISM MODE. The thrust slider alone commands the line: the other two
  // parameters are chosen to hold it as far from both faces as it will go, so
  // that hinges appear only when the thrust really forces them to. The travel
  // runs a little past both collapse thrusts, so the far end of the slider
  // shows the arch turned into a mechanism rather than simply stopping.
  if (ends && ui.mechOn.checked) {
    // Keyed on a signature rather than invalidated by hand from each of the
    // half-dozen places that can change the arch: tracing, scaling, adding a
    // load, reopening a file. A missed one would leave a stale band on screen.
    const key = `${m.blocks.length}:${m.joints.length}:${totalLoad().toPrecision(12)}`;
    if (state.bandKey !== key) {
      state.band = collapseRange(seq, m.joints);
      state.bandKey = key;
    }
    const band = state.band;
    if (band) {
      const u = Number(ui.thrust.value) / 100;
      const lo = band.min * 0.85;
      const hi = band.max * 1.15;
      const f = lo + (hi - lo) * u;
      const best = bestLineForThrust(seq, m.joints, f);
      if (best) {
        state.pole = best.fp.pole;
        state.fp = best.fp;
        state.lot = best.lot;
        state.startFraction = best.s;
        state.endFraction = best.lot.endFraction;
        state.segForces = state.fp.magnitudes.map((r) => r[2]);
        // The sliders are shown following the search rather than commanding
        // it, so what is on screen always describes the line being drawn.
        ui.startPos.value = Math.round(best.s * 100);
        ui.split.value = Math.round(best.split * 100);
        assessAdmissibility();
        reportEnds(ends);
        reportMechanism(f);
        return;
      }
    }
  }
  state.mech = null;

  state.fp = forcePolygon(seq.weights, pole);
  if (ends) {
    // BOTH ENDS FREE. The line starts at a chosen fraction of one springing
    // joint and its last segment is carried on until it meets the other. The
    // old construction pinned both at the joint mid-points, which threw away
    // two of the three degrees of freedom and made this tool reject rings that
    // Heyman's criterion accepts: a semicircular ring needed t/ri of about
    // 0.20 against his 0.108. With the ends free the same ring manages 0.115,
    // and the limit line comes out running through the extrados at both
    // springings, exactly as the theory says it should.
    state.startFraction = Number(ui.startPos.value) / 100;
    state.lot = freeThrustLine(state.fp, seq.centroids,
      ends.start, ends.end, state.startFraction);
    state.endFraction = state.lot.endFraction;
  } else {
    state.startFraction = null;
    state.endFraction = null;
    state.lot = funicular(state.fp, seq.centroids, m.pointB, m.pointA);
  }
  state.segForces = state.fp.magnitudes.map((r) => r[2]);
  assessAdmissibility();
  reportEnds(ends);

  const scaled = m.frame && m.frame.coordinates === 'physical';
  ui.thrustValue.textContent =
    `H = ${scaled ? format(state.fp.thrust, 'force', state.system)
      : `${state.fp.thrust.toPrecision(4)} (unscaled)`}` +
    `  ·  ×${factor.toFixed(2)} of the reference pole`;
}

/**
 * Heyman's condition: does the thrust line stay inside the ring?
 *
 * Reported joint by joint. `s` runs from 0 at the intrados to 1 at the
 * extrados, so anything outside [0, 1] is a joint where the line has left the
 * masonry and no equilibrium is possible in that configuration.
 */
function assessAdmissibility() {
  const m = state.model;
  state.crossings = null;
  if (!m.joints || !state.lot) {
    ui.admissible.className = 'verdict';
    ui.admissible.textContent = m.joints
      ? '—' : 'available for a traced arch, which has joints';
    return;
  }

  const cr = jointCrossings(state.lot.points, m.joints);
  state.crossings = cr;
  const missing = cr.filter((c) => c === null).length;
  const out = cr.filter((c) => c && !c.inside);
  const inside = cr.filter((c) => c && c.inside);

  if (missing) {
    ui.admissible.className = 'verdict bad';
    ui.admissible.textContent =
      `${missing} joint(s) are not crossed at all: the line does not span ` +
      'the arch.';
    return;
  }
  if (out.length) {
    // How far out, and where: the worst joint is the one to look at.
    let worst = out[0];
    for (const c of out) {
      const miss = (x) => (x.s < 0 ? -x.s : x.s - 1);
      if (miss(c) > miss(worst)) worst = c;
    }
    const side = worst.s < 0 ? 'below the intrados' : 'beyond the extrados';
    ui.admissible.className = 'verdict bad';
    ui.admissible.textContent =
      `NOT admissible — the line leaves the ring at ${out.length} of ` +
      `${cr.length} joints, worst ${side} by ` +
      `${(100 * Math.abs(worst.s < 0 ? worst.s : worst.s - 1)).toFixed(0)}% ` +
      'of the joint.';
    return;
  }
  // Inside everywhere: report how much room is left, which is the closest the
  // line comes to either face.
  const margin = Math.min(...inside.map((c) => Math.min(c.s, 1 - c.s)));
  ui.admissible.className = 'verdict ok';
  ui.admissible.textContent =
    `Admissible — the line stays inside all ${cr.length} joints, closest ` +
    `approach ${(100 * margin).toFixed(0)}% of the joint from a face. ` +
    'By the safe theorem, the arch stands.';
}

function fitViews() {
  const m = state.model;
  mainAx.syncSize();
  forceAx.syncSize();

  let b = bounds(m.blocks);
  if (m.frame.coordinates === 'pixels' && m.imageSize) {
    b = {
      xmin: Math.min(b.xmin, 0), xmax: Math.max(b.xmax, m.imageSize[0]),
      ymin: Math.min(b.ymin, 0), ymax: Math.max(b.ymax, m.imageSize[1]),
    };
  }
  mainAx.fit(b);

  fitForceView();
}

function fitForceView() {
  if (!state.fp) return;
  forceAx.syncSize();
  const xs = [0, state.fp.pole[0]];
  const ys = [...state.fp.stations, state.fp.pole[1]];
  forceAx.fit({
    xmin: Math.min(...xs), xmax: Math.max(...xs),
    ymin: Math.min(...ys), ymax: Math.max(...ys),
  }, 0.12);
}

function draw() {
  const m = state.model;
  if (!m) return;

  mainAx.begin();
  mainAx.reequalize();
  if (ui.showImage.checked && state.image && m.imageSize) {
    mainAx.clipped((c) => {
      // The stored file may be downscaled; the coordinates always refer to the
      // ORIGINAL pixel size, so the image is stretched onto that frame.
      const upp = m.frame.coordinates === 'physical'
        ? m.frame.units_per_pixel : 1;
      const W = m.imageSize[0] * upp;
      const H = m.imageSize[1] * upp;
      const [xa, ya] = mainAx.toPx([0, 0]);
      const [xb, yb] = mainAx.toPx([W, H]);
      const x = Math.min(xa, xb);
      const y = Math.min(ya, yb);
      const w = Math.abs(xb - xa);
      const h = Math.abs(yb - ya);
      c.save();
      c.globalAlpha = 0.85;
      // Row 0 of a photograph is its TOP, which in the pixel frame is y = 0.
      // With the axis running upward, y = 0 is at the bottom of the box, so
      // the image has to be reflected about its own rectangle or it comes out
      // upside down -- the whole figure, lettering included.
      if (mainAx.yUp) {
        c.translate(0, 2 * y + h);
        c.scale(1, -1);
      }
      c.drawImage(state.image, x, y, w, h);
      c.restore();
    });
  }
  if (ui.showBlocks.checked) {
    if (ui.showMech.checked && state.mech) {
      // While a mechanism is on show, what matters is which pieces move
      // together, not that adjacent stones are distinguishable.
      drawMacroBlocks(mainAx, m.blocks, state.mech.bodyOf);
    } else {
      drawBlocks(mainAx, m.blocks, { labels: ui.showLabels.checked });
    }
  }
  if (ui.showWeights.checked && m.centroids && m.weights) {
    drawWeights(mainAx, m.centroids, m.weights);
  }
  if (ui.showThrust.checked && state.lot) {
    drawThrustLine(mainAx, state.lot.points, state.segForces);
    if (ui.showRays.checked) {
      drawThrustLabels(mainAx, state.lot.points, { stride: raysStride() });
    }
  }
  if (ui.showCable.checked && state.lot) {
    // Reflected about the CHORD through the two ends, so the cable is hung
    // from A and B themselves. Reflecting about a horizontal line, as this
    // used to, left the cable floating clear of the springings on any arch
    // that was not symmetric -- which is exactly when the analogy is worth
    // looking at.
    drawCable(mainAx, hangingCable(state.lot.points));
  }
  if (ui.showMech.checked && state.mech) {
    const a = state.mech;
    const amp = (Number(ui.mechAmp.value) / 100) * 0.25;   // radians, capped
    if (a.dof > 0 && amp > 0) {
      const T = displacedConfiguration(a.hinges, a.bodies, amp);
      drawMechanism(mainAx, displaced(m.blocks, a.bodyOf, T));
      drawCentres(mainAx, a.motion);
    }
    drawHinges(mainAx, a.hinges);
  }
  drawSupports(mainAx, m.pointA, m.pointB);
  if (ui.showJoints.checked) drawJoints();
  drawTrace();
  drawForces();
  drawReference();
  mainAx.decorate();

  forceAx.begin();
  forceAx.reequalize();
  if (state.fp) {
    drawForcePolygon(forceAx, state.fp, {
      rayLabels: ui.showRays.checked,
      stride: raysStride(),
    });
  }
  forceAx.decorate();
}

/* ---------------------------------------------------------------- tracing -- */

const TRACE_COLOUR = { inner: '#0072BD', outer: '#7E2F8E' };

function drawTrace() {
  const t = state.trace;
  mainAx.clipped((c) => {
    for (const which of ['inner', 'outer']) {
      const pts = t[which];
      if (!pts.length) continue;
      const live = t.armed === which && t.cursor
        ? [...pts, t.cursor] : pts;
      c.strokeStyle = TRACE_COLOUR[which];
      c.lineWidth = 2;
      c.setLineDash(t.armed === which ? [5, 3] : []);
      c.beginPath();
      live.forEach((p, i) => {
        const [X, Y] = mainAx.toPx(p);
        if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
      });
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = TRACE_COLOUR[which];
      pts.forEach((p) => {
        const [X, Y] = mainAx.toPx(p);
        c.beginPath();
        c.arc(X, Y, 3, 0, 2 * Math.PI);
        c.fill();
      });
    }
  });
}

function drawJoints() {
  const m = state.model;
  if (!m.joints) return;
  const cr = state.crossings;
  mainAx.clipped((c) => {
    m.joints.forEach((j, i) => {
      const hit = cr && cr[i];
      const bad = hit && !hit.inside;
      const [x0, y0] = mainAx.toPx(j.a);
      const [x1, y1] = mainAx.toPx(j.b);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.strokeStyle = bad ? '#A2142F' : 'rgba(60,60,60,0.55)';
      c.lineWidth = bad ? 2.2 : 0.9;
      c.stroke();
      if (hit) {
        const [X, Y] = mainAx.toPx(hit.point);
        c.beginPath();
        c.arc(X, Y, bad ? 4 : 3, 0, 2 * Math.PI);
        c.fillStyle = bad ? '#A2142F' : '#2e7d32';
        c.fill();
      }
    });
  });
}

function drawForces() {
  const f = state.forces;
  if (!f.points.length) return;
  const max = Math.max(...f.magnitudes.map(Math.abs), 1);
  const span = (mainAx.view.ymax - mainAx.view.ymin) * 0.16;
  mainAx.clipped((c) => {
    f.points.forEach((p, i) => {
      const l = (Math.abs(f.magnitudes[i]) / max) * span;
      // Drawn arriving AT the point of application, which is where it acts.
      drawArrow(mainAx, [p[0], p[1] + l], p, '#A2142F', 10);
      const [X, Y] = mainAx.toPx([p[0], p[1] + l]);
      c.font = 'bold 10px Helvetica, Arial, sans-serif';
      c.fillStyle = '#A2142F';
      c.textAlign = 'left';
      c.textBaseline = 'bottom';
      c.fillText(`F${i + 1}`, X + 4, Y);
    });
  });
}

function armForce() {
  state.forces.placing = !state.forces.placing;
  if (state.forces.placing) {
    if (state.trace.armed) finishTrace();
    if (state.ref.picking) armReference();
  }
  ui.addForce.classList.toggle('armed', state.forces.placing);
  ui.addForce.textContent = state.forces.placing
    ? 'Click where it acts…' : 'Add a force';
  draw();
}

function listForces() {
  const f = state.forces;
  const scaled = state.model?.frame?.coordinates === 'physical';
  ui.forceList.innerHTML = '';
  f.points.forEach((p, i) => {
    const li = document.createElement('li');
    const mag = scaled ? format(f.magnitudes[i], 'force', state.system)
      : `${f.magnitudes[i].toPrecision(4)}`;
    li.append(document.createTextNode(
      `F${i + 1}  ${mag}  at x = ${p[0].toPrecision(4)}`));
    const del = document.createElement('button');
    del.textContent = 'remove';
    del.addEventListener('click', () => {
      f.points.splice(i, 1);
      f.magnitudes.splice(i, 1);
      listForces();
      recompute();
      fitForceView();
      draw();
    });
    li.append(del);
    ui.forceList.append(li);
  });
  ui.forceLabel.textContent =
    `Magnitude ${SYSTEMS[state.system].force.label}`;
}

function drawReference() {
  const pts = state.ref.points;
  if (!pts.length) return;
  mainAx.clipped((c) => {
    c.strokeStyle = '#C88A2E';
    c.fillStyle = '#C88A2E';
    c.lineWidth = 2;
    if (pts.length === 2) {
      const [x0, y0] = mainAx.toPx(pts[0]);
      const [x1, y1] = mainAx.toPx(pts[1]);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      c.font = 'bold 11px Helvetica, Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      const label = `${ui.refLength.value} ${SYSTEMS[state.system].length.label}`;
      c.fillText(label, (x0 + x1) / 2, (y0 + y1) / 2 - 5);
    }
    for (const p of pts) {
      const [X, Y] = mainAx.toPx(p);
      c.beginPath();
      c.moveTo(X - 6, Y); c.lineTo(X + 6, Y);
      c.moveTo(X, Y - 6); c.lineTo(X, Y + 6);
      c.stroke();
    }
  });
}

function armReference() {
  state.ref.picking = !state.ref.picking;
  if (state.ref.picking) {
    state.ref.points = [];
    // Picking a reference and tracing a curve would fight over the clicks.
    if (state.trace.armed) finishTrace();
  }
  ui.pickRef.classList.toggle('armed', state.ref.picking);
  ui.pickRef.textContent = state.ref.picking
    ? 'Click the two ends…' : 'Pick a reference length';
  reportScale();
  draw();
}

function reportBlocks(n, flipped) {
  const m = state.model;
  const total = (m.weights ?? []).reduce((s, v) => s + v, 0);
  const scaled = m.frame && m.frame.coordinates === 'physical';
  ui.traceStatus.textContent =
    `${n ?? (m.blocks ?? []).length} blocks · total weight ` +
    (scaled ? format(total, 'force', state.system) : total.toPrecision(4)) +
    (flipped ? ' · extrados direction corrected' : '');
}

function reportScale() {
  const m = state.model;
  const sys = SYSTEMS[state.system];
  ui.applyScale.disabled = state.ref.points.length !== 2;
  ui.gammaLabel.textContent = `Unit weight ${sys.density.label}`;
  ui.thickLabel.textContent = `Thickness ${sys.length.label}`;

  if (m && m.frame && m.frame.coordinates === 'physical' && m.joints) {
    const d = archDimensions(m.joints);
    if (d) {
      ui.scaleStatus.textContent =
        `span ${format(d.span, 'length', state.system)} · ` +
        `rise ${format(d.rise, 'length', state.system)} · ` +
        `rise/span ${d.ratio.toFixed(3)}`;
      return;
    }
  }
  ui.scaleStatus.textContent = state.ref.points.length === 2
    ? 'reference picked — set the length, then apply'
    : 'not scaled — lengths are pixels';
}

/** Turn pixels into physical units, once and for all. */
function applyScale() {
  const [p1, p2] = state.ref.points;
  const real = Number(ui.refLength.value);
  let k;
  try {
    k = unitsPerPixel(p1, p2, real);
  } catch (err) {
    ui.warn.hidden = false;
    ui.warn.textContent = err.message;
    return;
  }

  // The out-of-plane thickness is a PHYSICAL quantity the user typed, not a
  // pixel count, so it does not scale with the picture and the weights go as
  // k^2. Treating it as pixels once gave an arch 25 mm thick and a thrust of
  // 1.8 kN, which is arithmetically right and physically absurd.
  state.model = scaleModel(state.model, k, { thicknessInPixels: false });
  state.trace.inner = state.trace.inner.map(([x, y]) => [x * k, y * k]);
  state.trace.outer = state.trace.outer.map(([x, y]) => [x * k, y * k]);
  state.ref.points = state.ref.points.map(([x, y]) => [x * k, y * k]);
  // The forces move with the drawing; their MAGNITUDES are already in the
  // system's force unit and must not be scaled by a length factor.
  state.forces.points = state.forces.points.map(([x, y]) => [x * k, y * k]);
  ui.refLength.value = String(real);

  const total = (state.model.weights ?? []).reduce((s, v) => s + v, 0);
  state.basePole = [total / 4, -total / 2];
  ui.thrust.value = 50;
  state.model.units = state.system;

  armReference();          // disarm
  reportScale();
  reportBlocks();
  listForces();
  describe();
  recompute();
  fitViews();
  draw();
  ui.warn.hidden = true;
}

function arm(which) {
  const t = state.trace;
  t.armed = t.armed === which ? null : which;
  if (t.armed) t[t.armed] = [];
  t.cursor = null;
  ui.traceInner.classList.toggle('armed', t.armed === 'inner');
  ui.traceOuter.classList.toggle('armed', t.armed === 'outer');
  ui.traceHint.textContent = t.armed
    ? `Clicking along the ${t.armed === 'inner' ? 'intrados' : 'extrados'}. ` +
      'Double-click or press Enter to finish, Esc to cancel.'
    : 'Click along a curve; double-click, or press Enter, to finish. ' +
      'Esc cancels.';
  reportTrace();
  draw();
}

function finishTrace() {
  if (!state.trace.armed) return;
  state.trace.armed = null;
  state.trace.cursor = null;
  ui.traceInner.classList.remove('armed');
  ui.traceOuter.classList.remove('armed');
  ui.traceHint.textContent =
    'Click along a curve; double-click, or press Enter, to finish. Esc cancels.';
  reportTrace();
  draw();
}

function reportTrace() {
  const t = state.trace;
  const n = Number(ui.nBlocks.value) || 1;
  const bits = [`intrados ${t.inner.length} pts`,
    `extrados ${t.outer.length} pts`];
  let problems = [];
  if (t.inner.length >= 2 && t.outer.length >= 2) {
    problems = checkTrace(t.inner, t.outer, n);
  }
  ui.traceStatus.textContent = bits.join(' · ');
  ui.makeBlocks.disabled = t.inner.length < 2 || t.outer.length < 2;
  if (problems.length) {
    ui.warn.hidden = false;
    ui.warn.textContent = problems.join('; ') + '.';
  } else if (state.consistent && state.consistent.ok !== false) {
    ui.warn.hidden = true;
  }
}

/** Turn the two traced curves into an arch and hand it to the statics. */
function generateBlocks() {
  const t = state.trace;
  const n = Math.max(1, Number(ui.nBlocks.value) || 1);
  const gamma = Number(ui.gamma.value) || 20;

  const thickness = Math.max(0, Number(ui.thick.value) || 1);
  const { blocks, joints, flipped } = blocksBetween(t.inner, t.outer, n);
  const weights = weighBlocks(blocks, { specificWeight: gamma, thickness });
  const centroids = centroidsOf(blocks);
  const { pointA, pointB } = springings(joints);

  const total = weights.reduce((s, v) => s + v, 0);
  state.model = {
    ...state.model,
    blocks, centroids, weights, joints,
    areas: blocks.map((p) => Math.abs(signedAreaOf(p))),
    thickness: blocks.map(() => thickness),
    pointA, pointB,
    forcePolygon: null, thrustLine: null,
    // A FRESH TRACE IS IN VIEW COORDINATES, whatever the previous model was.
    // Inheriting a "physical" frame from an arch that has already been scaled
    // would label the new one in metres while its numbers are still pixels.
    units: null,
    frame: { coordinates: 'pixels', units_per_pixel: 1, inferred: false },
  };
  // A traced arch has no stored solution to be inconsistent with.
  state.consistent = { ok: true, reason: null, extraRows: 0 };
  // Start from a pole giving a thrust of about a quarter of the total weight,
  // which for a normal arch puts the line roughly inside the ring.
  state.basePole = [total / 4, -total / 2];
  ui.thrust.value = 50;

  reportBlocks(n, flipped);
  ui.warn.hidden = true;

  recompute();
  fitViews();
  draw();
}

/* ------------------------------------------------------------ interaction -- */

function attachNavigation(ax) {
  let dragging = false;
  let last = null;
  ax.canvas.addEventListener('pointerdown', (e) => {
    // Bring the transform up to date before reading a pointer position: the
    // layout may have moved since the last frame.
    ax.syncSize();
    // While a curve is armed, a click on the main axes adds a point instead
    // of starting a pan.
    if (ax === mainAx && state.forces.placing) {
      const mag = Number(ui.forceMag.value);
      if (mag > 0) {
        state.forces.points.push(mainAx.toData([e.offsetX, e.offsetY]));
        state.forces.magnitudes.push(mag);
        listForces();
        recompute();
        fitForceView();
      }
      armForce();
      return;
    }
    if (ax === mainAx && state.ref.picking) {
      state.ref.points.push(mainAx.toData([e.offsetX, e.offsetY]));
      if (state.ref.points.length >= 2) {
        state.ref.points = state.ref.points.slice(0, 2);
        armReference();
      }
      reportScale();
      draw();
      return;
    }
    if (ax === mainAx && state.trace.armed) {
      state.trace[state.trace.armed].push(mainAx.toData([e.offsetX, e.offsetY]));
      reportTrace();
      draw();
      return;
    }
    dragging = true;
    last = [e.offsetX, e.offsetY];
    ax.canvas.setPointerCapture(e.pointerId);
  });
  ax.canvas.addEventListener('pointermove', (e) => {
    if (ax === mainAx && state.trace.armed) {
      state.trace.cursor = mainAx.toData([e.offsetX, e.offsetY]);
      draw();
      return;
    }
    if (!dragging) return;
    ax.pan(e.offsetX - last[0], e.offsetY - last[1]);
    last = [e.offsetX, e.offsetY];
    draw();
  });
  const stop = () => { dragging = false; };
  ax.canvas.addEventListener('pointerup', stop);
  ax.canvas.addEventListener('pointercancel', stop);
  ax.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    ax.zoomAt([e.offsetX, e.offsetY], e.deltaY > 0 ? 1.1 : 1 / 1.1);
    draw();
  }, { passive: false });
}

attachNavigation(mainAx);
attachNavigation(forceAx);

el('main').addEventListener('dblclick', (e) => { e.preventDefault(); finishTrace(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') finishTrace();
  if (e.key === 'Escape' && state.trace.armed) {
    state.trace[state.trace.armed] = [];
    finishTrace();
  }
});

ui.addForce.addEventListener('click', armForce);
ui.clearForces.addEventListener('click', () => {
  state.forces.points = [];
  state.forces.magnitudes = [];
  listForces();
  recompute();
  fitForceView();
  draw();
});

ui.pickRef.addEventListener('click', armReference);
ui.applyScale.addEventListener('click', applyScale);
ui.refLength.addEventListener('input', () => { reportScale(); draw(); });
ui.system.addEventListener('change', () => {
  state.system = ui.system.value;
  ui.gamma.value = String(SYSTEMS[state.system].typicalDensity);
  reportScale();
  listForces();
  draw();
});

ui.traceInner.addEventListener('click', () => arm('inner'));
ui.traceOuter.addEventListener('click', () => arm('outer'));
ui.makeBlocks.addEventListener('click', generateBlocks);
ui.nBlocks.addEventListener('change', reportTrace);
ui.clearTrace.addEventListener('click', () => {
  state.trace = { inner: [], outer: [], armed: null, cursor: null };
  finishTrace();
});

ui.imageFile.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    // A fresh image resets the model to an empty arch in ITS pixel frame, so
    // a trace on top of it lands in the right coordinates.
    state.image = img;
    state.model = {
      name: file.name, blocks: [], centroids: [], weights: [],
      pointA: null, pointB: null, forcePolygon: null, thrustLine: null,
      units: null, lengthScaling: 1, massToWeight: 1,
      image: file.name, imageSize: [img.naturalWidth, img.naturalHeight],
      frame: { coordinates: 'pixels', units_per_pixel: 1, inferred: false },
    };
    state.consistent = { ok: true, reason: null, extraRows: 0 };
    state.fp = null; state.lot = null; state.basePole = null;
    state.trace = { inner: [], outer: [], armed: null, cursor: null };
    ui.meta.textContent =
      `${file.name} · ${img.naturalWidth}×${img.naturalHeight} px`;
    ui.warn.hidden = true;
    ui.thrustValue.textContent = 'trace the arch first';
    mainAx.syncSize();
    mainAx.fit({ xmin: 0, xmax: img.naturalWidth,
      ymin: 0, ymax: img.naturalHeight });
    reportTrace();
    draw();
  };
  img.src = URL.createObjectURL(file);
});

ui.example.addEventListener('change', () => loadExample(ui.example.value));
ui.thrust.addEventListener('input', () => {
  recompute();
  // Refit the force plane only: the pole travels a long way and would leave
  // the view. The arch view is left alone, so the flattening of the thrust
  // line stays visible against a fixed frame.
  fitForceView();
  draw();
});
for (const k of ['startPos', 'split']) {
  ui[k].addEventListener('input', () => {
    recompute();
    // The pole moves along the load line, so the force plane must follow; the
    // arch view is left alone so the line's swing stays visible.
    fitForceView();
    draw();
  });
}
ui.mechOn.addEventListener('change', () => {
  if (!ui.mechOn.checked) {
    state.mech = null;
    ui.mechVerdict.className = 'verdict';
    ui.mechVerdict.textContent = '—';
    ui.mechCount.textContent = '';
    ui.mechBand.textContent = '';
    ui.mechAmp.disabled = true;
  } else if (!ui.showMech.checked) {
    // Turning the analysis on without showing it would be a readout with
    // nothing on the drawing to match.
    ui.showMech.checked = true;
  }
  ui.goHmin.disabled = !ui.mechOn.checked;
  ui.goHmax.disabled = !ui.mechOn.checked;
  recompute();
  fitForceView();
  draw();
});
ui.mechAmp.addEventListener('input', draw);
for (const [b, pick] of [[ui.goHmin, (x) => x.min], [ui.goHmax, (x) => x.max]]) {
  b.addEventListener('click', () => {
    if (!state.band) return;
    ui.thrust.value = sliderForThrust(pick(state.band));
    recompute();
    fitForceView();
    draw();
  });
}
ui.reset.addEventListener('click', () => { fitViews(); draw(); });

// -------------------------------------------------------- save and reopen --

/**
 * Hand the file to the browser.
 *
 * A blob URL and a synthetic click is the only way a page with no server can
 * give a file to the person reading it. The URL is revoked afterwards, or the
 * blob stays in memory for the life of the tab.
 */
function saveWork() {
  try {
    const data = serialise(state, {
      thrust: ui.thrust.value,
      startPos: ui.startPos.value,
      split: ui.split.value,
    });
    const text = JSON.stringify(data, null, 1);
    const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName(state);
    a.click();
    URL.revokeObjectURL(url);
    const kb = (text.length / 1024).toFixed(0);
    ui.saveStatus.textContent = `saved ${a.download} (${kb} kB)`;
  } catch (e) {
    ui.saveStatus.textContent = `could not save: ${e.message}`;
  }
}

/** Read a saved session back and put the app into it. */
function openWork(text) {
  let data;
  try {
    data = deserialise(text);
  } catch (e) {
    ui.saveStatus.textContent = `could not open: ${e.message}`;
    return;
  }

  state.model = data.model;
  state.trace = data.trace
    ? { inner: data.trace.inner, outer: data.trace.outer,
      armed: null, cursor: null }
    : null;
  state.forces = data.forces;
  state.basePole = data.basePole
    ?? [totalLoad() / 4, -totalLoad() / 2];
  state.system = data.system;
  state.exampleName = data.exampleName;
  state.image = null;                 // the image is not in the file
  state.consistent = { ok: true, problems: [] };

  ui.system.value = data.system;
  ui.thrust.value = data.controls.thrust;
  ui.startPos.value = data.controls.startPos;
  ui.split.value = data.controls.split;

  recompute();
  fitViews();
  draw();
  listForces();
  reportScale();
  ui.saveStatus.textContent = data.imageName
    ? `opened — the background image (${data.imageName}) is not in the file, `
      + 'load it again if you want it'
    : 'opened';
}

ui.saveState.addEventListener('click', saveWork);
ui.loadState.addEventListener('click', () => ui.stateFile.click());
ui.stateFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => openWork(String(reader.result));
  reader.onerror = () => {
    ui.saveStatus.textContent = 'could not read that file';
  };
  reader.readAsText(file);
  // Clear it, or picking the same file twice in a row does nothing.
  e.target.value = '';
});
for (const k of ['showImage', 'showBlocks', 'showWeights', 'showThrust',
  'showCable', 'showLabels', 'showJoints', 'showRays', 'showMech']) {
  ui[k].addEventListener('change', draw);
}
ui.flipY.addEventListener('change', () => {
  mainAx.yUp = !ui.flipY.checked;
  fitViews();
  draw();
});
window.addEventListener('resize', () => {
  // A resize changes the box without touching the view, which breaks the equal
  // aspect and quietly falsifies every length read off the drawing.
  mainAx.syncSize();
  forceAx.syncSize();
  mainAx.reequalize();
  forceAx.reequalize();
  draw();
});

/**
 * A diagnostic hook, deliberately kept.
 *
 * `axis equal` is the one property of this drawing that cannot be checked by
 * looking at it -- a ten per cent anisotropy is invisible and falsifies every
 * length read off the picture. This exposes the two scales so that the
 * property can be MEASURED, from the console or from a test:
 *
 *     aLOT.scales()   ->  { sx, sy, ratio }   ratio must be 1
 */
window.aLOT = {
  scales(ax = mainAx) {
    ax.syncSize();
    const b = ax.box;
    return {
      sx: b.w / (ax.view.xmax - ax.view.xmin),
      sy: b.h / (ax.view.ymax - ax.view.ymin),
      get ratio() { return this.sx / this.sy; },
    };
  },
  state,
  axes: { main: mainAx, force: forceAx },
};

loadCatalogue().catch((err) => {
  ui.meta.textContent = `could not load the examples: ${err.message}`;
});
