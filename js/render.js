/* Desenho da cena no canvas: grade milimetrada, molas helicoidais coloridas
 * pela deformação, amortecedores com pistão, massas, apoios e forças. */
(function (root) {
  'use strict';
  const Vib = root.Vib = root.Vib || {};
  const DEG = Math.PI / 180;

  /* ---------- formatação numérica pt-BR ---------- */
  const nfCache = new Map();
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function fmt(v, sig = 3) {
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a < 1e-4 || a >= 1e6) {
      const [m, ex] = v.toExponential(Math.max(0, sig - 1)).split('e');
      const sup = String(+ex).replace(/[-0-9]/g, c => SUP[c]);
      return m.replace('.', ',') + '·10' + sup;
    }
    let f = nfCache.get(sig);
    if (!f) { f = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: sig }); nfCache.set(sig, f); }
    return f.format(v);
  }
  function fixed(v, d) {
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(d).replace('.', ',').replace(/^-(0,?0*)$/, '$1');
  }
  Vib.fmt = fmt;
  Vib.fixed = fixed;

  /* ---------- tema ---------- */
  const KEYS = ['canvas', 'grid', 'grid-major', 'ink', 'muted', 'line', 'accent', 'accent-soft', 'tension',
    'compression', 'mass', 'mass-hi', 'panel', 'panel-2', 'good', 'warn', 'bad', 's1', 's2', 's3', 's4', 's5'];
  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const theme = { c: {}, rgb: {} };
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of KEYS) {
      const v = cs.getPropertyValue('--' + k).trim() || '#888888';
      theme.c[k] = v;
      theme.rgb[k] = v.startsWith('#') ? hexRgb(v) : [128, 128, 128];
    }
    return theme;
  }
  function mix(a, b, t) {
    const A = theme.rgb[a], B = theme.rgb[b];
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  }
  function alpha(k, a) {
    const c = theme.rgb[k];
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  /* ---------- vista ---------- */
  class View {
    constructor() { this.cx = 0.5; this.cy = -0.2; this.scale = 240; this.W = 1; this.H = 1; }
    sx(x) { return (x - this.cx) * this.scale + this.W / 2; }
    sy(y) { return this.H / 2 - (y - this.cy) * this.scale; }
    wx(sx) { return this.cx + (sx - this.W / 2) / this.scale; }
    wy(sy) { return this.cy - (sy - this.H / 2) / this.scale; }
    zoomAt(sx, sy, f) {
      const wx = this.wx(sx), wy = this.wy(sy);
      this.scale = Math.min(4000, Math.max(20, this.scale * f));
      this.cx = wx - (sx - this.W / 2) / this.scale;
      this.cy = wy + (sy - this.H / 2) / this.scale;
    }
    fit(scene) {
      if (!scene.nodes.length) { this.cx = 0; this.cy = 0; this.scale = 240; return; }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const n of scene.nodes) {
        const x = n.fixed ? n.x0 : n.x, y = n.fixed ? n.y0 : n.y;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const w = Math.max(x1 - x0, 0.3), h = Math.max(y1 - y0, 0.3);
      const mx = Math.min(120, this.W * 0.12), my = Math.min(120, this.H * 0.18);
      this.scale = Math.min(700, Math.max(30, Math.min((this.W - mx) / (w * 1.2), (this.H - my) / (h * 1.3))));
      this.cx = (x0 + x1) / 2;
      this.cy = (y0 + y1) / 2;
    }
  }

  function massSize(n, view) {
    return Math.min(56, Math.max(13, 0.075 * Math.cbrt(n.m) * view.scale));
  }

  /* Deslocamento lateral de elementos paralelos entre o mesmo par de nós. */
  function elementOffsets(scene) {
    const groups = new Map(), off = new Map();
    for (const e of scene.elements) {
      const key = Math.min(e.a, e.b) + ':' + Math.max(e.a, e.b);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    for (const g of groups.values()) {
      g.sort((p, q) => (p.type === q.type ? p.id - q.id : (p.type === 'spring' ? -1 : 1)));
      g.forEach((e, i) => off.set(e.id, (i - (g.length - 1) / 2) * 18));
    }
    return off;
  }

  /* Extremos do elemento em pixels, já deslocados. */
  function elementEnds(scene, view, e, offsets, pos) {
    const a = scene.get(e.a), b = scene.get(e.b);
    if (!a || !b) return null;
    const pa = pos ? pos(a) : a, pb = pos ? pos(b) : b;
    let ax = view.sx(pa.x), ay = view.sy(pa.y), bx = view.sx(pb.x), by = view.sy(pb.y);
    const o = offsets.get(e.id) || 0;
    if (o) {
      // orientação estável: do menor id para o maior
      const s = e.a < e.b ? 1 : -1;
      const dx = (bx - ax) * s, dy = (by - ay) * s, L = Math.hypot(dx, dy) || 1;
      const px = -dy / L * o, py = dx / L * o;
      ax += px; ay += py; bx += px; by += py;
    }
    return { ax, ay, bx, by };
  }

  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  function hitNode(scene, view, sx, sy) {
    let best = null, bd = Infinity;
    for (let i = scene.nodes.length - 1; i >= 0; i--) {
      const n = scene.nodes[i];
      const r = n.fixed ? 13 : massSize(n, view) / 2 + 5;
      const d = Math.hypot(view.sx(n.x) - sx, view.sy(n.y) - sy);
      if (d <= r && d < bd) { best = n; bd = d; }
    }
    return best;
  }

  function hitElement(scene, view, sx, sy, offsets) {
    let best = null, bd = 8;
    for (const e of scene.elements) {
      const p = elementEnds(scene, view, e, offsets);
      if (!p) continue;
      const d = distSeg(sx, sy, p.ax, p.ay, p.bx, p.by);
      if (d < bd) { best = e; bd = d; }
    }
    return best;
  }

  /* ---------- primitivas ---------- */
  function drawSpring(ctx, ax, ay, bx, by, amp, coils) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    if (L < 1) return;
    const ux = dx / L, uy = dy / L, px = -uy, py = ux;
    const lead = Math.min(16, L * 0.16), body = L - 2 * lead, n = coils * 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + ux * lead, ay + uy * lead);
    for (let i = 0; i < n; i++) {
      const s = lead + body * (i + 0.5) / n, side = (i % 2 ? -1 : 1) * amp;
      ctx.lineTo(ax + ux * s + px * side, ay + uy * s + py * side);
    }
    ctx.lineTo(bx - ux * lead, by - uy * lead);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  /* Amortecedor: cilindro de tamanho limitado no meio do elemento;
   * o êmbolo acompanha a variação de comprimento. */
  function drawDamper(ctx, ax, ay, bx, by, Lref, hw) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    if (L < 1) return;
    const ux = dx / L, uy = dy / L, px = -uy, py = ux;
    Lref = Math.max(Lref, 30);
    const cl = Math.max(18, Math.min(44, 0.4 * Lref));
    const s1 = Math.max(4, Math.min((Lref - cl) / 2, L * 0.35));
    const s2 = s1 + cl;
    const rod = Lref - ((Lref - cl) / 2 + 0.55 * cl);
    const sp = Math.max(s1 + 3, Math.min(L - 3, s2 + 0.3 * cl, L - rod));
    const P = (s, o) => [ax + ux * s + px * o, ay + uy * s + py * o];
    const line = (pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke(); };
    line([P(0, 0), P(s1, 0)]);
    ctx.save();
    ctx.fillStyle = alpha('compression', 0.12);
    ctx.beginPath();
    [P(s1, -hw), P(Math.min(sp, s2), -hw), P(Math.min(sp, s2), hw), P(s1, hw)].forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath(); ctx.fill();
    ctx.restore();
    line([P(s2, -hw), P(s1, -hw), P(s1, hw), P(s2, hw)]);
    ctx.save();
    ctx.lineWidth += 1.6;
    line([P(sp, -hw + 2.5), P(sp, hw - 2.5)]);
    ctx.restore();
    line([P(sp, 0), [bx, by]]);
  }

  function arrow(ctx, x0, y0, x1, y1, head = 7) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 2) return;
    const ux = dx / L, uy = dy / L;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.moveTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55);
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  function drawGrid(ctx, view) {
    const { W, H } = view;
    const minor = niceStep(16 / view.scale);
    const major = minor * 5;
    const x0 = view.wx(0), x1 = view.wx(W), y0 = view.wy(H), y1 = view.wy(0);
    ctx.lineWidth = 1;
    for (const [step, color] of [[minor, theme.c.grid], [major, theme.c['grid-major']]]) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const s = Math.round(view.sx(x)) + 0.5;
        ctx.moveTo(s, 0); ctx.lineTo(s, H);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const s = Math.round(view.sy(y)) + 0.5;
        ctx.moveTo(0, s); ctx.lineTo(W, s);
      }
      ctx.stroke();
    }
    // barra de escala
    const bar = major;
    const px = bar * view.scale, bx = 14, by = H - 16;
    ctx.strokeStyle = theme.c.muted;
    ctx.fillStyle = theme.c.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + px, by); ctx.lineTo(bx + px, by - 4);
    ctx.stroke();
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'bottom';
    ctx.fillText(bar >= 1 ? fmt(bar) + ' m' : fmt(bar * 100) + ' cm', bx + 4, by - 5);
  }

  function anchorDir(scene, n) {
    let dx = 0, dy = 0;
    for (const e of scene.elements) {
      if (e.a !== n.id && e.b !== n.id) continue;
      const o = scene.get(e.a === n.id ? e.b : e.a);
      const L = Math.hypot(o.x - n.x, o.y - n.y) || 1;
      dx += (o.x - n.x) / L; dy += (o.y - n.y) / L;
    }
    const L = Math.hypot(dx, dy);
    return L < 1e-6 ? [0, 1] : [dx / L, dy / L];
  }

  /* ---------- cena ---------- */
  function drawScene(ctx, scene, view, st) {
    const { W, H } = view;
    ctx.fillStyle = theme.c.canvas;
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, view);
    const offsets = st.offsets;
    const queue = [], obstacles = [];
    const zoomK = Math.max(0.65, Math.min(1.4, view.scale / 260));

    // rastro
    if (st.trail && st.trail.length > 1) {
      const tr = st.trail, n = tr.length;
      ctx.lineWidth = 2;
      for (let i = 1; i < n; i++) {
        ctx.strokeStyle = alpha('accent', 0.55 * i / n);
        ctx.beginPath();
        ctx.moveTo(view.sx(tr[i - 1][0]), view.sy(tr[i - 1][1]));
        ctx.lineTo(view.sx(tr[i][0]), view.sy(tr[i][1]));
        ctx.stroke();
      }
    }

    // elementos
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const e of scene.elements) {
      const p = elementEnds(scene, view, e, offsets);
      if (!p) continue;
      const sel = st.selection && st.selection.id === e.id;
      const hov = st.hover && st.hover.id === e.id;
      if (sel || hov) {
        ctx.strokeStyle = alpha('accent', sel ? 0.28 : 0.16);
        ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(p.bx, p.by); ctx.stroke();
      }
      if (e.type === 'spring') {
        const L = scene.elementLength(e);
        const strain = e.L0 > 1e-9 ? (L - e.L0) / e.L0 : 0;
        const t = Math.max(-1, Math.min(1, strain / 0.2));
        ctx.strokeStyle = t >= 0 ? mix('ink', 'tension', Math.sqrt(t)) : mix('ink', 'compression', Math.sqrt(-t));
        ctx.lineWidth = 1.8 * Math.min(1.3, Math.max(0.8, 0.8 + Math.log10(1 + e.k) / 6));
        const lenPx = Math.hypot(p.bx - p.ax, p.by - p.ay);
        const coils = Math.max(3, Math.min(9, Math.round(lenPx / 16)));
        drawSpring(ctx, p.ax, p.ay, p.bx, p.by, 7 * zoomK, coils);
      } else {
        ctx.strokeStyle = theme.c.ink;
        ctx.lineWidth = 1.8;
        drawDamper(ctx, p.ax, p.ay, p.bx, p.by, (e.L0 || scene.elementLength(e)) * view.scale, 7 * zoomK);
      }
    }

    // apoios
    for (const n of scene.nodes) {
      if (!n.fixed) continue;
      const x = view.sx(n.x), y = view.sy(n.y);
      const [dx, dy] = anchorDir(scene, n);
      const ux = dx, uy = -dy;                // direção em pixels
      const px = -uy, py = ux;
      const back = 9, half = 15;
      const bx = x - ux * back, by = y - uy * back;
      ctx.strokeStyle = theme.c.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(bx, by);
      ctx.moveTo(bx + px * half, by + py * half); ctx.lineTo(bx - px * half, by - py * half);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = theme.c.muted;
      ctx.beginPath();
      for (let k = -half + 3; k <= half; k += 6) {
        const hx = bx + px * k, hy = by + py * k;
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - ux * 7 - px * 5, hy - uy * 7 - py * 5);
      }
      ctx.stroke();
      ctx.fillStyle = theme.c.canvas;
      ctx.strokeStyle = theme.c.ink;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4.2, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      if (n.base && n.base.A) {
        const a = n.base.angle * DEG, cx = Math.cos(a), cy = -Math.sin(a);
        const ox = bx - ux * 18, oy = by - uy * 18;
        ctx.strokeStyle = theme.c.s2;
        ctx.lineWidth = 1.8;
        arrow(ctx, ox, oy, ox + cx * 14, oy + cy * 14, 5);
        arrow(ctx, ox, oy, ox - cx * 14, oy - cy * 14, 5);
      }
      const sel = st.selection && st.selection.id === n.id;
      if (sel || (st.hover && st.hover.id === n.id)) {
        ctx.strokeStyle = alpha('accent', sel ? 1 : 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI); ctx.stroke();
      }
      obstacles.push([x - 12, y - 12, 24, 24]);
      if (st.labels) queue.push({ txt: n.name, pri: 2, cands: [[x + 14, y - 14, 'l'], [x - 14, y - 14, 'r'], [x + 14, y + 14, 'l'], [x - 14, y + 14, 'r']] });
    }

    // massas
    for (const n of scene.nodes) {
      if (n.fixed) continue;
      const x = view.sx(n.x), y = view.sy(n.y), s = massSize(n, view);
      if (n.lockX !== n.lockY) {
        ctx.strokeStyle = theme.c.line;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const ext = s * 1.6;
        if (n.lockY) { ctx.moveTo(x - ext, y + s / 2 + 3); ctx.lineTo(x + ext, y + s / 2 + 3); }
        else { ctx.moveTo(x - s / 2 - 3, y - ext); ctx.lineTo(x - s / 2 - 3, y + ext); }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const sel = st.selection && st.selection.id === n.id;
      const hov = st.hover && st.hover.id === n.id;
      const g = ctx.createLinearGradient(x - s / 2, y - s / 2, x + s / 2, y + s / 2);
      g.addColorStop(0, theme.c['mass-hi']);
      g.addColorStop(1, theme.c.mass);
      ctx.fillStyle = g;
      roundRect(ctx, x - s / 2, y - s / 2, s, s, Math.min(6, s / 4));
      ctx.fill();
      if (sel || hov) {
        ctx.strokeStyle = alpha('accent', sel ? 1 : 0.55);
        ctx.lineWidth = 2.5;
        roundRect(ctx, x - s / 2 - 4, y - s / 2 - 4, s + 8, s + 8, Math.min(9, s / 3));
        ctx.stroke();
      }
      if (n.lockX && n.lockY) {
        ctx.strokeStyle = theme.c.bad;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - s / 3, y - s / 3); ctx.lineTo(x + s / 3, y + s / 3); ctx.stroke();
      }
      if (n.force && n.force.F0) {
        const v = Vib.physics.forceValue(n.force, st.t) / n.force.F0;
        const a = n.force.angle * DEG, cx = Math.cos(a), cy = -Math.sin(a);
        const len = 34 * v;
        const ox = x + cx * (s / 2 + 4) * Math.sign(v || 1), oy = y + cy * (s / 2 + 4) * Math.sign(v || 1);
        ctx.strokeStyle = theme.c.s2;
        ctx.lineWidth = 2.4;
        arrow(ctx, ox, oy, ox + cx * len, oy + cy * len, 7);
      }
      obstacles.push([x - s / 2 - 3, y - s / 2 - 3, s + 6, s + 6]);
      if (st.labels) {
        const gy = s / 2 + 13;
        queue.push({ txt: `${n.name} · ${fmt(n.m)} kg`, pri: 0, strong: true, cands: [[x, y - gy, 'c'], [x, y + gy, 'c'], [x + s / 2 + 8, y, 'l'], [x - s / 2 - 8, y, 'r'], [x, y - gy - 16, 'c'], [x, y + gy + 16, 'c']] });
      }
    }

    if (st.labels) {
      for (const e of scene.elements) {
        const p = elementEnds(scene, view, e, offsets);
        if (!p) continue;
        const L = Math.hypot(p.bx - p.ax, p.by - p.ay) || 1;
        let nx = -(p.by - p.ay) / L, ny = (p.bx - p.ax) / L;
        const o = offsets.get(e.id) || 0;
        if (o < 0 || (o === 0 && ny > 0)) { nx = -nx; ny = -ny; }
        const txt = e.type === 'spring' ? `${e.name} · ${fmt(e.k)} N/m` : `${e.name} · ${fmt(e.c)} N·s/m`;
        const cands = [];
        for (const d of [18, 30]) {
          for (const f of [0.5, 0.35, 0.65]) {
            const mx = p.ax + (p.bx - p.ax) * f, my = p.ay + (p.by - p.ay) * f;
            cands.push([mx + nx * d, my + ny * d, 'c'], [mx - nx * d, my - ny * d, 'c']);
          }
        }
        queue.push({ txt, pri: 1, cands });
      }
    }
    obstacles.push([8, view.H - 38, 140, 34]);
    placeLabels(ctx, queue, obstacles, view);

    // fantasma do modo
    if (st.ghost) {
      const G = st.ghost;
      ctx.strokeStyle = theme.c.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      for (const e of scene.elements) {
        const a = G.get(e.a), b = G.get(e.b);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(view.sx(a.x), view.sy(a.y));
        ctx.lineTo(view.sx(b.x), view.sy(b.y));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of scene.nodes) {
        if (n.fixed) continue;
        const p = G.get(n.id), s = massSize(n, view);
        ctx.fillStyle = alpha('accent', 0.18);
        roundRect(ctx, view.sx(p.x) - s / 2, view.sy(p.y) - s / 2, s, s, Math.min(6, s / 4));
        ctx.fill(); ctx.stroke();
      }
    }

    // ligação em construção
    if (st.connect) {
      const c = st.connect;
      ctx.strokeStyle = theme.c.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(c.x0, c.y0); ctx.lineTo(c.x1, c.y1); ctx.stroke();
      ctx.setLineDash([]);
      if (c.target) {
        ctx.beginPath(); ctx.arc(c.x1, c.y1, 14, 0, 2 * Math.PI); ctx.stroke();
      }
    }
    // mão elástica
    if (st.hand) {
      const h = st.hand;
      ctx.strokeStyle = theme.c.s2;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(h.x0, h.y0); ctx.lineTo(h.x1, h.y1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = theme.c.s2;
      ctx.beginPath(); ctx.arc(h.x1, h.y1, 4.5, 0, 2 * Math.PI); ctx.fill();
    }
  }

  /* Posiciona rótulos sem sobreposição: cada rótulo testa posições candidatas
   * e fica na primeira que não colide com outro rótulo, massa ou apoio. */
  function placeLabels(ctx, queue, obstacles, view) {
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    const placed = [];
    const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    queue.sort((a, b) => a.pri - b.pri);
    for (const q of queue) {
      const w = ctx.measureText(q.txt).width + 10, hgt = 17;
      for (const [x, y, al] of q.cands) {
        const x0 = al === 'c' ? x - w / 2 : al === 'r' ? x - w : x, y0 = y - hgt / 2;
        if (x0 < 4 || y0 < 4 || x0 + w > view.W - 4 || y0 + hgt > view.H - 4) continue;
        const r = [x0, y0, w, hgt];
        if (placed.some(o => hit(o, r)) || obstacles.some(o => hit(o, r))) continue;
        placed.push(r);
        ctx.fillStyle = alpha('canvas', 0.9);
        roundRect(ctx, x0, y0, w, hgt, 4);
        ctx.fill();
        ctx.strokeStyle = alpha('muted', 0.18);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = q.strong ? theme.c.ink : theme.c.muted;
        ctx.fillText(q.txt, x0 + 5, y0 + hgt / 2 + 0.5);
        break;
      }
    }
  }

  Vib.render = { View, theme, readTheme, drawScene, hitNode, hitElement, elementOffsets, massSize, mix, alpha, niceStep };
})(typeof window !== 'undefined' ? window : globalThis);
