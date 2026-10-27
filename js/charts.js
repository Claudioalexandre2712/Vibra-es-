/* Gráfico 2D leve em canvas: eixos lineares ou logarítmicos, várias séries,
 * linhas verticais de referência e marcadores. */
(function (root) {
  'use strict';
  const Vib = root.Vib = root.Vib || {};
  const { theme, niceStep, alpha } = Vib.render;
  const fmt = Vib.fmt;

  class Chart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.W = 1; this.H = 1;
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w !== this.W || h !== this.H || this.dpr !== dpr) {
        this.W = w; this.H = h; this.dpr = dpr;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
      }
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    draw(cfg) {
      this.resize();
      const ctx = this.ctx, W = this.W, H = this.H;
      ctx.fillStyle = theme.c.panel;
      ctx.fillRect(0, 0, W, H);
      const pad = { l: 58, r: 14, t: 14, b: 32 };
      const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
      if (pw < 40 || ph < 30) return;
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      if (cfg.empty) {
        ctx.fillStyle = theme.c.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '400 13px "IBM Plex Sans", system-ui, sans-serif';
        ctx.fillText(cfg.empty, W / 2, H / 2);
        ctx.textAlign = 'left';
        return;
      }
      const X = axisMap(cfg.x, pad.l, pad.l + pw);
      const Y = axisMap(cfg.y, pad.t + ph, pad.t);

      // grade e marcas
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.c.grid;
      ctx.fillStyle = theme.c.muted;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      for (const v of ticks(cfg.x, pw / 90)) {
        const s = Math.round(X(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(s, pad.t); ctx.lineTo(s, pad.t + ph); ctx.stroke();
        ctx.fillText((cfg.x.fmt || fmt)(v), s, pad.t + ph + 6);
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const v of ticks(cfg.y, ph / 40)) {
        const s = Math.round(Y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(pad.l, s); ctx.lineTo(pad.l + pw, s); ctx.stroke();
        ctx.fillText((cfg.y.fmt || fmt)(v), pad.l - 6, s);
      }
      ctx.strokeStyle = theme.c['grid-major'];
      ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw - 1, ph - 1);
      if (!cfg.y.log && cfg.y.min < 0 && cfg.y.max > 0) {
        ctx.strokeStyle = theme.c.muted;
        ctx.beginPath();
        const s = Math.round(Y(0)) + 0.5;
        ctx.moveTo(pad.l, s); ctx.lineTo(pad.l + pw, s);
        ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(cfg.x.label || '', pad.l + pw, pad.t + ph + 30);
      ctx.save();
      ctx.translate(12, pad.t + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.y.label || '', 0, 0);
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.l, pad.t, pw, ph);
      ctx.clip();
      for (const v of cfg.vlines || []) {
        if (v.x < cfg.x.min || v.x > cfg.x.max) continue;
        const s = Math.round(X(v.x)) + 0.5;
        ctx.strokeStyle = v.color || theme.c.muted;
        ctx.setLineDash(v.dash || [3, 4]);
        ctx.lineWidth = v.width || 1;
        ctx.beginPath(); ctx.moveTo(s, pad.t); ctx.lineTo(s, pad.t + ph); ctx.stroke();
        ctx.setLineDash([]);
        if (v.label) {
          ctx.fillStyle = v.color || theme.c.muted;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(v.label, s + 3, pad.t + 3 + (v.row || 0) * 13);
        }
      }
      ctx.lineJoin = 'round';
      for (const s of cfg.series) {
        const n = s.n !== undefined ? s.n : s.y.length;
        if (n < 2) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width || 1.6;
        ctx.setLineDash(s.dash || []);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const xv = s.x[i], yv = s.y[i];
          if (!Number.isFinite(yv) || (cfg.y.log && yv <= 0) || (cfg.x.log && xv <= 0)) { started = false; continue; }
          const px = X(xv), py = Y(yv);
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        if (s.fill) {
          ctx.lineTo(X(s.x[n - 1]), pad.t + ph);
          ctx.lineTo(X(s.x[0]), pad.t + ph);
          ctx.closePath();
          ctx.fillStyle = s.fill;
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      for (const p of cfg.points || []) {
        if (!Number.isFinite(p.y) || (cfg.y.log && p.y <= 0)) continue;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = theme.c.panel;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), p.r || 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }

  function axisMap(a, p0, p1) {
    if (a.log) {
      const l0 = Math.log10(a.min), l1 = Math.log10(a.max);
      return v => p0 + (Math.log10(v) - l0) / (l1 - l0) * (p1 - p0);
    }
    return v => p0 + (v - a.min) / (a.max - a.min) * (p1 - p0);
  }

  function ticks(a, count) {
    const out = [];
    if (a.log) {
      const d0 = Math.floor(Math.log10(a.min)), d1 = Math.ceil(Math.log10(a.max));
      const span = d1 - d0;
      const subs = span <= 2 ? [1, 2, 5] : (span <= 6 ? [1] : [1]);
      const stepDec = Math.max(1, Math.ceil(span / Math.max(count, 1)));
      for (let d = d0; d <= d1; d += span > 6 ? stepDec : 1) {
        for (const m of subs) {
          const v = m * Math.pow(10, d);
          if (v >= a.min * 0.999 && v <= a.max * 1.001) out.push(v);
        }
      }
      return out;
    }
    const step = niceStep((a.max - a.min) / Math.max(count, 1));
    for (let v = Math.ceil(a.min / step) * step; v <= a.max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  Vib.Chart = Chart;
  Vib.chartColors = () => [theme.c.s1, theme.c.s2, theme.c.s3, theme.c.s4, theme.c.s5];
  Vib.chartAlpha = alpha;
})(typeof window !== 'undefined' ? window : globalThis);
