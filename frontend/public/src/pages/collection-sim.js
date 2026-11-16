// "How milk collection works" animated simulation for the public website.
// Ported from design-assets/milk-collection-simulation.html (SVG + plain JS, no libraries):
//  - artwork is loaded from assets/sim/milk-collection.svg and inlined so it can be animated;
//  - all element lookups are scoped to this component (no global ids / globals);
//  - the loop stops when the page is left and pauses while scrolled out of view;
//  - controls and headings come from i18n; the illustration's own text stays Marathi (it is part of the art).
// Everything on screen is a pure function of time: render(t). Arms/legs use 2-bone IK; the walk is procedural.
import { html, mount } from '../core/dom.js';
import { t as tr } from '../core/i18n.js';

let svgCache = null;
const loadSvg = () => (svgCache ||= fetch('./assets/sim/milk-collection.svg').then((r) => {
  if (!r.ok) throw new Error('sim svg ' + r.status);
  return r.text();
}));

/** Render the simulation into `host`. Sample entry values can be passed in (litres, Fat, SNF). */
export async function mountCollectionSim(host, sample = { litre: 6.40, fat: 4.0, snf: 8.5 }) {
  mount(host, html`
    <section class="sim" aria-labelledby="sim-title">
      <div class="sim-head"><div><h2 id="sim-title">${tr('sim.title')}</h2><p>${tr('sim.sub')}</p></div></div>
      <div class="sim-stage" data-stage><div class="sim-loading">${tr('common.loading')}</div></div>
    </section>`);
  let markup;
  try { markup = await loadSvg(); } catch { host.querySelector('.sim')?.remove(); return; } // non-essential: page works without it
  const stage = host.querySelector('[data-stage]');
  stage.innerHTML = markup; // trusted, same-origin static asset
  const root = stage.querySelector('svg');
  start(host, root, sample);
}

function start(host, root, SAMPLE) {
  const D = 23, GROUND = 440;
  const byId = {};
  const $ = (id) => (byId[id] ||= root.querySelector('#' + id));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => { k = clamp(k, 0, 1); return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; };
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const P = (x, y) => x.toFixed(1) + ' ' + y.toFixed(1);
  const line = (a, b) => 'M' + P(a[0], a[1]) + ' L' + P(b[0], b[1]);
  const rot = (v, deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };

  // two-bone inverse kinematics: returns [elbow, hand]
  function ik(s, tg, a, b, sign) {
    const dx = tg[0] - s[0], dy = tg[1] - s[1], d0 = Math.hypot(dx, dy) || 1e-3;
    const d = clamp(d0, Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const base = Math.atan2(dy, dx), A = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const ang = base + sign * A, e = [s[0] + a * Math.cos(ang), s[1] + a * Math.sin(ang)];
    const hx = tg[0] - e[0], hy = tg[1] - e[1], hl = Math.hypot(hx, hy) || 1e-3;
    return [e, [e[0] + hx / hl * b, e[1] + hy / hl * b]];
  }

  // ---------- story timeline (seconds) ----------
  function farmerX(t) {
    if (t < 6.0) return 646;
    if (t < 7.4) return lerp(646, 774, ease(seg(t, 6.0, 7.4)));
    if (t < 16.8) return 774;
    if (t < 17.8) return lerp(774, 646, ease(seg(t, 16.8, 17.8)));
    return 646;
  }
  function bikeX(t) {
    if (t < 4.4) { const k = seg(t, 0, 4.4); return lerp(-260, 626, 1 - Math.pow(1 - k, 2.2)); }
    if (t < 19.6) return 626;
    const q = seg(t, 19.6, 22.8); return lerp(626, 1480, Math.pow(q, 1.7));
  }
  function ridingAt(t) {
    if (t < 4.4) return 1;
    if (t < 5.0) return 1 - ease(seg(t, 4.4, 5.0));
    if (t < 19.0) return 0;
    if (t < 19.6) return ease(seg(t, 19.0, 19.6));
    return 1;
  }
  function facing(t) {
    if (t < 16.8) return 1;
    if (t < 17.9) return -1;
    if (t < 18.2) return lerp(-1, 1, ease(seg(t, 17.9, 18.2)));
    return 1;
  }
  const litresAt = (t) => SAMPLE.litre * (1 - Math.pow(1 - seg(t, 8.6, 11.0), 1.6));

  const legF = $('legF'), legB = $('legB');
  function drawLeg(g, hip, foot) {
    const r = ik(hip, foot, 52, 50, -1), knee = r[0], ank = r[1];
    const hem = [lerp(knee[0], ank[0], 0.45), lerp(knee[1], ank[1], 0.45)];
    g.querySelector('.thigh').setAttribute('d', line(hip, knee));
    g.querySelector('.hem').setAttribute('d', line(knee, hem));
    g.querySelector('.shin').setAttribute('d', line(knee, ank));
    g.querySelector('.foot').setAttribute('d', line([ank[0] - 3, ank[1] + 1], [ank[0] + 14, ank[1] + 2]));
  }
  function drawArm(prefix, sh, target, sign) {
    const r = ik(sh, target, 38, 38, sign), el = r[0], hd = r[1];
    $(prefix + 'U').setAttribute('d', line(sh, el));
    $(prefix + 'F').setAttribute('d', line(el, hd));
    $(prefix + 'C').setAttribute('d', line(el, [lerp(el[0], hd[0], 0.55), lerp(el[1], hd[1], 0.55)]));
    return hd;
  }

  // illustration text that depends on the sample entry
  $('anTxt').textContent = `${SAMPLE.fat.toFixed(1)} / ${SAMPLE.snf.toFixed(1)}`;
  $('mFat').textContent = `Fat ${SAMPLE.fat.toFixed(1)} • SNF ${SAMPLE.snf.toFixed(1)}`;
  const msgTexts = root.querySelectorAll('#msg text');
  if (msgTexts[2]) msgTexts[2].textContent = `लिटर : ${SAMPLE.litre.toFixed(2)}`;
  if (msgTexts[3]) msgTexts[3].textContent = `Fat : ${SAMPLE.fat.toFixed(1)} • SNF : ${SAMPLE.snf.toFixed(1)}`;
  const tds = root.querySelectorAll('#typing .td');
  const dots = $('dots').children;

  function render(t) {
    t = clamp(t, 0, D);
    const fx = farmerX(t), bx = bikeX(t), face = facing(t), dir = face < 0 ? -1 : 1;
    const v = Math.abs(farmerX(t + 0.03) - farmerX(t - 0.03)) / 0.06;
    const walk = clamp(v / 120, 0, 1), phase = fx * 0.055;
    const bob = -2.2 * walk * Math.abs(Math.cos(phase));
    let hip = [2, -100 + bob], sh;

    const stride = 24 * walk;
    let footF = [stride * Math.sin(phase) + 4, -4 - Math.max(0, Math.cos(phase)) * 9 * walk];
    let footB = [stride * Math.sin(phase + Math.PI) - 4, -4 - Math.max(0, Math.cos(phase + Math.PI)) * 9 * walk];
    drawLeg(legF, hip, footF); drawLeg(legB, hip, footB);

    const swingB = [-2 + 16 * Math.sin(phase) * walk, -100];
    const grip = [(bx + 60 - fx) * dir, -130], seat = [(bx - 28 - fx) * dir, -118];
    const carry = [24, -104], lift = [64, -144];
    let canRot = 0, canOnBike = true, tF, tB = swingB;

    if (t < 5.2) { tF = grip; tB = seat; }
    else if (t < 5.6) { tF = grip; const k = ease(seg(t, 5.2, 5.6)); tB = [lerp(seat[0], swingB[0], k), lerp(seat[1], swingB[1], k)]; }
    else if (t < 6.0) { const k1 = ease(seg(t, 5.6, 6.0)); tF = [lerp(grip[0] - 6, carry[0], k1), lerp(grip[1] + 2, carry[1], k1)]; canOnBike = false; }
    else if (t < 7.6) { tF = carry; canOnBike = false; }
    else if (t < 11.2) {
      canOnBike = false;
      const k2 = ease(seg(t, 7.6, 8.4));
      tF = [lerp(carry[0], lift[0], k2), lerp(carry[1], lift[1], k2)];
      canRot = 24 * k2 + 72 * ease(seg(t, 8.4, 8.8)) + 8 * seg(t, 8.8, 11.0);
    }
    else if (t < 11.8) { canOnBike = false; const k3 = ease(seg(t, 11.2, 11.8)); tF = [lerp(lift[0], carry[0], k3), lerp(lift[1], carry[1], k3)]; canRot = 104 * (1 - k3); }
    else if (t < 18.3) { canOnBike = false; tF = carry; }
    else if (t < 18.9) { canOnBike = false; const k4 = ease(seg(t, 18.3, 18.9)); tF = [lerp(carry[0], grip[0], k4), lerp(carry[1], grip[1], k4)]; tB = [lerp(swingB[0], seat[0], k4), lerp(swingB[1], seat[1], k4)]; if (k4 > 0.98) canOnBike = true; }
    else { tF = grip; tB = seat; }

    if (t >= 8.2 && t < 11.6) { // supporting hand under the can while pouring
      const sup = rot([0, 50], canRot), kk = ease(seg(t, 8.2, 8.6)) * (1 - ease(seg(t, 11.2, 11.6)));
      const hs = [tF[0] + sup[0], tF[1] + sup[1]];
      tB = [lerp(swingB[0], hs[0], kk), lerp(swingB[1], hs[1], kk)];
    }
    let phoneUp = 0; // checking the phone
    if (t >= 14.8 && t < 16.9) {
      const pk = t < 15.2 ? seg(t, 14.8, 15.2) * 0.5 : (t < 16.5 ? 0.5 + 0.5 * ease(seg(t, 15.2, 15.6)) : 1 - ease(seg(t, 16.5, 16.9)));
      const pocket = [8, -148], face2 = [34, -184];
      tB = pk <= 0.5 ? [lerp(swingB[0], pocket[0], pk * 2), lerp(swingB[1], pocket[1], pk * 2)]
        : [lerp(pocket[0], face2[0], (pk - 0.5) * 2), lerp(pocket[1], face2[1], (pk - 0.5) * 2)];
      phoneUp = pk > 0.5 ? 1 : 0;
    }

    // blend the standing pose with the riding pose (scene space)
    const r = ridingAt(t);
    const gx = lerp(fx, bx - 28, r), gy = lerp(GROUND, GROUND - 20, r);
    const S = (p) => [fx + dir * p[0], GROUND + p[1]];
    const Lc = (p) => [(p[0] - gx) * dir, p[1] - gy];
    const mix = (a, b) => [lerp(a[0], b[0], r), lerp(a[1], b[1], r)];
    const crankA = bx * 0.02, crank = [bx - 6, GROUND - 40];
    const pedF = [crank[0] + 15 * Math.cos(crankA), crank[1] + 15 * Math.sin(crankA) - 3];
    const pedB = [crank[0] + 15 * Math.cos(crankA + Math.PI), crank[1] + 15 * Math.sin(crankA + Math.PI) - 3];
    if (r > 0) {
      hip = Lc(mix(S(hip), [bx - 26, GROUND - 120]));
      footF = Lc(mix(S(footF), pedF)); footB = Lc(mix(S(footB), pedB));
      // Getting off / on: the far leg swings up and back over the saddle instead of sliding through the frame.
      const swing = Math.sin(Math.PI * r);
      footB = [footB[0] - 34 * swing, footB[1] - 78 * swing];
      tF = Lc(mix(S(tF), [bx + 60, GROUND - 130])); tB = Lc(mix(S(tB), [bx + 52, GROUND - 128]));
      drawLeg(legF, hip, footF); drawLeg(legB, hip, footB);
    }
    // Depth: while riding he straddles the bicycle (far leg/arm behind the frame). Once the far leg has crossed
    // the saddle (r < 0.5) he stands on the near side, so both legs are drawn in front of the bicycle.
    const backG = $('farmerBack'), bikeG = $('bike');
    if (r < 0.5) { if (backG.previousElementSibling !== bikeG) bikeG.after(backG); }
    else if (backG.nextElementSibling !== bikeG) bikeG.before(backG);
    const lean = 26 * r;
    const up = rot([0, -71], lean);
    sh = [hip[0] + up[0], hip[1] + up[1]];
    const upper = 'translate(' + (hip[0] - 2).toFixed(1) + ' ' + (hip[1] + 100).toFixed(1) + ') rotate(' + lean.toFixed(1) + ' 2 -100)';
    $('torso').setAttribute('transform', upper); $('head').setAttribute('transform', upper);
    $('crankArm').setAttribute('d', line([pedF[0] - bx, pedF[1] + 3 - GROUND], [pedB[0] - bx, pedB[1] + 3 - GROUND]));
    $('pedalF').setAttribute('transform', 'translate(' + (pedF[0] - bx).toFixed(1) + ' ' + (pedF[1] + 3 - GROUND).toFixed(1) + ')');
    $('pedalB').setAttribute('transform', 'translate(' + (pedB[0] - bx).toFixed(1) + ' ' + (pedB[1] + 3 - GROUND).toFixed(1) + ')');

    const hB = drawArm('fArmB', [sh[0] - 4, sh[1] + 2], tB, 1);
    const hF = drawArm('fArmF', sh, tF, 1);
    $('fHandF').setAttribute('cx', hF[0]); $('fHandF').setAttribute('cy', hF[1]);
    const ftf = 'translate(' + gx.toFixed(1) + ' ' + gy.toFixed(1) + ') scale(' + face.toFixed(3) + ' 1)';
    $('farmer').setAttribute('transform', ftf); $('farmerBack').setAttribute('transform', ftf);
    $('fShadow').setAttribute('opacity', (0.16 * (1 - r)).toFixed(3));
    $('handPhone').setAttribute('opacity', phoneUp);
    $('handPhone').setAttribute('transform', 'translate(' + hB[0].toFixed(1) + ' ' + (hB[1] - 6).toFixed(1) + ') rotate(-12)');
    $('pocketPhone').setAttribute('opacity', phoneUp ? 0 : 1);
    const buzz = (t > 14.6 && t < 15.0) ? Math.sin(t * 90) * 1.5 : 0;
    $('pocketPhone').setAttribute('transform', 'translate(' + buzz.toFixed(2) + ' 0)');
    $('pocketGlow').setAttribute('opacity', (t > 14.6 && t < 15.0) ? 1 : 0);
    $('handGlow').setAttribute('opacity', t > 15.9 ? 1 : 0.35);
    $('fShadow').setAttribute('cx', (gx + 4).toFixed(1));
    $('bShadow').setAttribute('cx', bx.toFixed(1));

    const wheelDeg = (bx / 44) * 180 / Math.PI;
    $('bike').setAttribute('transform', 'translate(' + bx.toFixed(1) + ' ' + GROUND + ')');
    $('wR').setAttribute('transform', 'rotate(' + wheelDeg.toFixed(1) + ' -64 -44)');
    $('wF').setAttribute('transform', 'rotate(' + wheelDeg.toFixed(1) + ' 64 -44)');
    $('kick').setAttribute('opacity', (t >= 4.6 && t < 19.4) ? 1 : 0);

    let cx, cy, cr = 0, csx = 1;
    if (canOnBike) { cx = bx + 54; cy = GROUND - 132; } else { cx = gx + face * hF[0]; cy = gy + hF[1]; cr = canRot * dir; csx = face; }
    $('can').setAttribute('transform', 'translate(' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ') rotate(' + cr.toFixed(1) + ') scale(' + csx.toFixed(3) + ' 1)');

    const pouring = t >= 8.6 && t < 11.2;
    if (pouring) {
      const mouth = rot([0, 18], canRot); const m = [cx + mouth[0], cy + mouth[1]];
      const d = 'M' + P(m[0], m[1]) + ' Q' + P(m[0] + 22, m[1] - 6) + ' ' + P(861, 318);
      $('stream').setAttribute('d', d); $('streamCore').setAttribute('d', d);
      $('stream').setAttribute('stroke-dashoffset', (-t * 120).toFixed(1));
    }
    const so = pouring ? Math.min(1, seg(t, 8.6, 8.8) * 5) * (1 - seg(t, 11.0, 11.2)) : 0;
    $('stream').setAttribute('opacity', so); $('streamCore').setAttribute('opacity', so);
    const L = t < 16.8 ? litresAt(t) : SAMPLE.litre * (1 - seg(t, 16.8, 17.4));
    const fill = L / SAMPLE.litre * 30;
    $('milk').setAttribute('y', (342 - fill).toFixed(1)); $('milk').setAttribute('height', fill.toFixed(1));
    $('milkTop').setAttribute('y', (342 - fill).toFixed(1)); $('milkTop').setAttribute('opacity', fill > 1 ? 1 : 0);
    $('scaleTxt').textContent = (t < 16.8 ? litresAt(t) : (t < 17.4 ? SAMPLE.litre : 0)).toFixed(2);

    // operator: dip sample → analyzer → rest
    const opSh = [918, 292], rest = [898, 344], vessel = [861, 316], slot = [990, 330];
    let opT = rest;
    if (t >= 11.6 && t < 12.2) { const a1 = ease(seg(t, 11.6, 12.0)); opT = [lerp(rest[0], vessel[0], a1), lerp(rest[1], vessel[1], a1)]; }
    else if (t >= 12.2 && t < 12.6) { const a2 = ease(seg(t, 12.2, 12.6)); opT = [lerp(vessel[0], slot[0], a2), lerp(vessel[1], slot[1], a2)]; }
    else if (t >= 12.6 && t < 13.6) opT = slot;
    else if (t >= 13.6 && t < 14.0) { const a3 = ease(seg(t, 13.6, 14.0)); opT = [lerp(slot[0], rest[0], a3), lerp(slot[1], rest[1], a3)]; }
    const opA = ik(opSh, opT, 32, 32, 1), opB = ik(opSh, opT, 32, 32, -1);
    const op = opA[0][1] >= opB[0][1] ? opA : opB; // keep the elbow low, as a person would
    $('opArmU').setAttribute('d', line(opSh, op[0])); $('opArmF').setAttribute('d', line(op[0], op[1]));
    $('opArmC').setAttribute('d', line(op[0], [lerp(op[0][0], op[1][0], 0.35), lerp(op[0][1], op[1][1], 0.35)]));
    $('opHand').setAttribute('cx', op[1][0].toFixed(1)); $('opHand').setAttribute('cy', op[1][1].toFixed(1));
    $('dipper').setAttribute('transform', 'translate(' + op[1][0].toFixed(1) + ' ' + op[1][1].toFixed(1) + ')');
    $('dipper').setAttribute('opacity', (t >= 11.8 && t < 12.8) ? 1 : 0);
    $('anBar').setAttribute('width', (46 * seg(t, 12.6, 13.4)).toFixed(1));
    $('anBar').setAttribute('opacity', (t >= 12.6 && t < 13.45) ? 1 : 0);
    $('anTxt').setAttribute('opacity', (t >= 13.4 && t < 21) ? 1 : 0);
    $('anLed').setAttribute('fill', (t >= 12.6 && t < 13.4 && Math.floor(t * 8) % 2) ? '#8EE29B' : '#2E7D32');
    $('paper').setAttribute('height', (26 * seg(t, 14.0, 14.8)).toFixed(1));
    $('paper').setAttribute('y', (334 - 26 * seg(t, 14.0, 14.8)).toFixed(1));

    const on = (id, a, b) => $(id).setAttribute('opacity', (t >= a && t < (b || 21)) ? 1 : 0);
    on('mCode', 7.6); on('mLit', 8.6); on('mFat', 13.4); on('mDone', 13.8);
    $('mLit').textContent = 'लिटर ' + litresAt(t).toFixed(2);

    const A = [1120, 102], C = [640, 0], B = [130, 250]; // data flying to the phone
    for (let i = 0; i < dots.length; i++) {
      const q = seg(t, 14.2 + i * 0.12, 14.9 + i * 0.12), u = 1 - q;
      dots[i].setAttribute('cx', (u * u * A[0] + 2 * u * q * C[0] + q * q * B[0]).toFixed(1));
      dots[i].setAttribute('cy', (u * u * A[1] + 2 * u * q * C[1] + q * q * B[1]).toFixed(1));
      dots[i].setAttribute('opacity', (q > 0 && q < 1) ? 1 : 0);
    }
    $('signal').setAttribute('opacity', (t >= 14.0 && t < 15.0) ? (Math.floor(t * 6) % 2 ? 1 : 0.4) : 0);

    const py = t < 14.8 ? 560 : (t < 18.6 ? lerp(560, 190, ease(seg(t, 14.8, 15.3))) : lerp(190, 560, ease(seg(t, 18.6, 19.1))));
    $('phone').setAttribute('transform', 'translate(40 ' + py.toFixed(1) + ') scale(.88)');
    $('typing').setAttribute('opacity', (t >= 15.3 && t < 16.0) ? 1 : 0);
    for (let j = 0; j < tds.length; j++) tds[j].setAttribute('opacity', (Math.floor(t * 6) % 3 === j) ? 1 : 0.35);
    $('msg').setAttribute('opacity', t >= 16.0 ? 1 : 0);
    $('ticks').setAttribute('fill', t >= 16.5 ? '#2196F3' : '#9E9E9E');
    $('pStatus').textContent = (t >= 15.3 && t < 16.0) ? 'टाइप करत आहे…' : 'ऑनलाइन';

    const cur = t < 7.6 ? 0 : t < 11.2 ? 1 : t < 13.8 ? 2 : (t < 16.5 ? 3 : 4);
    for (let pi = 0; pi < 4; pi++) { // process panel: current step blue, finished steps green with a tick
      const done = pi < cur, act = pi === cur;
      $('procR' + pi).setAttribute('fill', act ? '#1F4E9A' : (done ? '#E8F3E9' : '#F4F7FB'));
      $('procC' + pi).setAttribute('fill', act ? '#FFFFFF' : (done ? '#2E7D32' : '#9AA6B5'));
      $('procN' + pi).setAttribute('fill', act ? '#1F4E9A' : '#FFFFFF');
      $('procN' + pi).setAttribute('opacity', done ? 0 : 1);
      $('procK' + pi).setAttribute('opacity', done ? 1 : 0);
      $('procI' + pi).setAttribute('stroke', act ? '#FFFFFF' : (done ? '#2E7D32' : '#1F4E9A'));
      $('procT' + pi).setAttribute('fill', act ? '#FFFFFF' : (done ? '#1B5E20' : '#1A1A1A'));
    }
  }

  // ---------- player: plays on its own, loops; no on-screen controls ----------
  let t = 0, last = null, visible = true, raf = 0, attached = false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Save battery on cheap phones: no frames while the simulation is scrolled out of view.
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.05 }) : null;
  function tick(now) {
    if (host.isConnected) attached = true; // the page may still be building off-screen when we start
    else if (attached) { io?.disconnect(); return; } // page left: stop for good
    if (visible) { if (last != null) { t += (now - last) / 1000; if (t > D) t = 0; } last = now; render(t); } else last = null;
    raf = requestAnimationFrame(tick);
  }
  if (reduce) { render(16.6); return () => {}; } // reduced motion: show the "message received" frame, still
  io?.observe(root);
  render(0);
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
