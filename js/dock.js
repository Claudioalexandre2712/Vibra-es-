/* Osciloscópio: registro da massa observada a 200 Hz e os cinco gráficos
 * (tempo, energia, espectro, plano de fase, resposta em frequência). */
(function () {
  'use strict';
  const V = window.Vib;
  const fmt = V.fmt;
  const CAP = 4096;
  const WINDOW = 10;           // s exibidos nos gráficos temporais

  const rec = {
    id: null, n: 0, head: 0,
    t: new Float64Array(CAP), x: new Float64Array(CAP), y: new Float64Array(CAP),
    vx: new Float64Array(CAP), vy: new Float64Array(CAP),
    ek: new Float64Array(CAP), ep: new Float64Array(CAP), ed: new Float64Array(CAP), ew: new Float64Array(CAP),
    Vref: null,
  };

  function clear() { rec.n = 0; rec.head = 0; rec.Vref = null; fftCache = null; }

  function observe(id) {
    if (rec.id === id) return;
    rec.id = id;
    clear();
    frfCache = null;
  }

  function onSample(engine) {
    if (rec.id === null) return;
    const st = engine.nodeState(rec.id);
    if (!st) return;
    const E = engine.energies();
    if (rec.Vref === null) rec.Vref = E.Vel + E.Vg;
    const i = rec.head;
    rec.t[i] = engine.t; rec.x[i] = st[0]; rec.y[i] = st[1]; rec.vx[i] = st[2]; rec.vy[i] = st[3];
    rec.ek[i] = E.T; rec.ep[i] = E.Vel + E.Vg; rec.ed[i] = E.D; rec.ew[i] = E.W;
    rec.head = (i + 1) % CAP;
    rec.n = Math.min(rec.n + 1, CAP);
  }

  /* Últimas `count` amostras em ordem cronológica. */
  function series(arr, count, offset = 0, scale = 1) {
    count = Math.min(count, rec.n);
    const out = new Float64Array(count);
    const start = (rec.head - count + CAP) % CAP;
    for (let k = 0; k < count; k++) out[k] = (arr[(start + k) % CAP] - offset) * scale;
    return out;
  }
  function windowCount(sec) {
    if (!rec.n) return 0;
    const tEnd = rec.t[(rec.head - 1 + CAP) % CAP];
    let c = 0;
    while (c < rec.n && rec.t[(rec.head - 1 - c + 2 * CAP) % CAP] >= tEnd - sec) c++;
    return c;
  }

  let chart, tab = 'time', fftCache = null, frfCache = null, frfTimer = null, lastDraw = 0;

  function node() { return V.app.scene.get(rec.id); }
  function ref() {
    const n = node();
    if (!n) return { x: 0, y: 0 };
    const eq = V.app.modal.eqMap && V.app.modal.eqMap.get(n.id);
    return eq || { x: n.x0, y: n.y0 };
  }
  function dofs() {
    const n = node();
    return n ? { x: !n.lockX, y: !n.lockY } : { x: false, y: false };
  }

  function sym(arr, minv) {
    let m = minv;
    for (const v of arr) if (Math.abs(v) > m) m = Math.abs(v);
    return m * 1.12;
  }

  function legend(items) {
    return '<div class="legend">' + items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('') + '</div>';
  }

  function ro(k, v) { return `<div class="ro"><span class="k">${k}</span><span class="v">${v}</span></div>`; }

  function dominant() {
    // espectro calculado periodicamente para a leitura de frequência dominante
    const now = performance.now();
    if (fftCache && now - fftCache.at < 500 && fftCache.n === rec.n && fftCache.head === rec.head) return fftCache;
    const nAvail = rec.n;
    if (nAvail < 256) { fftCache = null; return null; }
    let N = 256;
    while (N * 2 <= nAvail && N < 4096) N *= 2;
    const d = dofs(), r = ref(), dt = V.app.engine.sampleDt;
    const res = { at: now, n: rec.n, head: rec.head, N, df: 1 / (N * dt), f: null, ax: null, ay: null, peak: 0, peakF: 0 };
    const half = N / 2;
    res.f = new Float64Array(half);
    for (let k = 0; k < half; k++) res.f[k] = k * res.df;
    for (const key of ['x', 'y']) {
      if (!d[key]) continue;
      const s = series(rec[key], N, r[key], 1000);
      let mean = 0;
      for (const v of s) mean += v;
      mean /= N;
      const re = new Float64Array(N), im = new Float64Array(N);
      let wsum = 0;
      for (let k = 0; k < N; k++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (N - 1)); re[k] = (s[k] - mean) * w; wsum += w; }
      V.linalg.fft(re, im);
      const a = new Float64Array(half);
      for (let k = 0; k < half; k++) {
        a[k] = 2 * Math.hypot(re[k], im[k]) / wsum;
        if (k > 0 && a[k] > res.peak) { res.peak = a[k]; res.peakF = res.f[k]; }
      }
      res['a' + key] = a;
    }
    // interpolação parabólica do pico
    fftCache = res;
    return res;
  }

  function modalLines(fmaxPlot) {
    const an = V.app.modal.an, out = [];
    if (!an) return out;
    let j = 0;
    an.modes.forEach((m, r) => {
      if (m.kind !== 'elastic' || m.f > fmaxPlot || j > 12) return;
      out.push({ x: m.f, color: V.render.theme.c.muted, label: 'f' + (r + 1), row: j % 2 });
      j++;
    });
    return out;
  }

  function amplitude(key, sec) {
    const c = windowCount(sec);
    if (c < 10) return NaN;
    const s = series(rec[key], c);
    let lo = Infinity, hi = -Infinity;
    for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return (hi - lo) / 2;
  }

  function draw(force) {
    const now = performance.now();
    if (!force && now - lastDraw < 33) return;
    lastDraw = now;
    const C = V.chartColors(), th = V.render.theme.c;
    const n = node(), d = dofs(), r = ref();
    const roEl = document.getElementById('readouts');
    document.getElementById('dockObserved').textContent = n ? `observando ${n.name}` : '';
    if (!n || n.fixed) {
      chart.draw({ empty: 'Selecione uma massa para observar sua resposta.' });
      roEl.innerHTML = '';
      return;
    }
    let html = '';
    const latest = (rec.head - 1 + CAP) % CAP;
    const cTime = windowCount(WINDOW);
    const tEnd = rec.n ? rec.t[latest] : 0;
    const t0 = Math.max(0, tEnd - WINDOW);
    const cfgX = { min: t0, max: Math.max(t0 + WINDOW, 1e-3), label: 't [s]' };

    if (tab === 'time') {
      const ts = series(rec.t, cTime);
      const ser = [], leg = [];
      let m = 0.1;
      if (d.x) { const s = series(rec.x, cTime, r.x, 1000); m = Math.max(m, sym(s, 0)); ser.push({ x: ts, y: s, color: C[0], width: 1.8 }); leg.push([C[0], 'uₓ — desloc. em x']); }
      if (d.y) { const s = series(rec.y, cTime, r.y, 1000); m = Math.max(m, sym(s, 0)); ser.push({ x: ts, y: s, color: C[1], width: 1.8 }); leg.push([C[1], 'u_y — desloc. em y']); }
      chart.draw(rec.n < 2 ? { empty: 'Execute a simulação para registrar a resposta.' } : { x: cfgX, y: { min: -m, max: m, label: 'u [mm]' }, series: ser });
      html += legend(leg);
    } else if (tab === 'energy') {
      const ts = series(rec.t, cTime);
      const Veq = V.app.modal.Veq;
      const ek = series(rec.ek, cTime), ep = series(rec.ep, cTime, Number.isFinite(Veq) ? Veq : rec.Vref), ed = series(rec.ed, cTime), ew = series(rec.ew, cTime);
      const bal = new Float64Array(cTime);
      for (let k = 0; k < cTime; k++) bal[k] = ek[k] + ep[k] + ed[k] - ew[k];
      let lo = 0, hi = 1e-6;
      for (const s of [ek, ep, ed, ew, bal]) for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const pad = (hi - lo) * 0.08;
      chart.draw(rec.n < 2 ? { empty: 'Execute a simulação para registrar as energias.' } : {
        x: cfgX, y: { min: lo - pad, max: hi + pad, label: 'E [J]' },
        series: [
          { x: ts, y: ek, color: C[0], width: 1.6 },
          { x: ts, y: ep, color: C[2], width: 1.6 },
          { x: ts, y: ed, color: C[3], width: 1.6 },
          { x: ts, y: ew, color: C[1], width: 1.6 },
          { x: ts, y: bal, color: th.ink, width: 2.2, dash: [6, 4] },
        ],
      });
      html += legend([[C[0], 'cinética T'], [C[2], 'potencial V (rel. equilíbrio)'], [C[3], 'dissipada (acum.)'], [C[1], 'trabalho externo (acum.)'], [th.ink, 'T + V + dissipada − trabalho']]);
      const e = V.app.engine;
      html += ro('erro do balanço', fmt(e.energyErr, 2));
    } else if (tab === 'fft') {
      const F = dominant();
      if (!F) chart.draw({ empty: 'Aguardando ao menos 1,3 s de resposta para o espectro.' });
      else {
        const an = V.app.modal.an;
        const el = an ? an.modes.filter(m => m.kind === 'elastic') : [];
        let fmax = el.length ? el[Math.min(el.length, 8) - 1].f * 2.2 : 10;
        fmax = Math.max(1, Math.min(fmax, F.f[F.f.length - 1], Math.max(fmax, F.peakF * 1.5)));
        const ser = [];
        let top = 1e-3;
        for (const [key, c] of [['x', C[0]], ['y', C[1]]]) {
          const a = F['a' + key];
          if (!a) continue;
          for (let k = 0; k < a.length && F.f[k] <= fmax; k++) top = Math.max(top, a[k]);
          ser.push({ x: F.f, y: a, color: c, width: 1.6, fill: V.chartAlpha(key === 'x' ? 's1' : 's2', 0.12) });
        }
        chart.draw({ x: { min: 0, max: fmax, label: 'f [Hz]' }, y: { min: 0, max: top * 1.15, label: 'amplitude [mm]' }, series: ser, vlines: modalLines(fmax) });
        html += legend(ser.map((s, i) => [s.color, i === 0 && d.x ? 'espectro de uₓ' : 'espectro de u_y']));
        html += ro('pico', `${fmt(F.peakF, 3)} Hz`);
        html += ro('resolução Δf', `${fmt(F.df, 2)} Hz`);
        html += ro('janela', `${fmt(F.N * V.app.engine.sampleDt, 3)} s · Hann`);
      }
    } else if (tab === 'phase') {
      const key = d.x && (!d.y || amplitude('x', 3) >= amplitude('y', 3)) ? 'x' : 'y';
      const u = series(rec[key], cTime, r[key], 1000), v = series(rec['v' + key], cTime, 0, 1000);
      const mu = sym(u, 0.1), mv = sym(v, 0.1);
      chart.draw(rec.n < 2 ? { empty: 'Execute a simulação para traçar o plano de fase.' } : {
        x: { min: -mu, max: mu, label: `u${key === 'x' ? 'ₓ' : '_y'} [mm]` },
        y: { min: -mv, max: mv, label: 'v [mm/s]' },
        series: [{ x: u, y: v, color: C[0], width: 1.4 }],
        points: cTime ? [{ x: u[cTime - 1], y: v[cTime - 1], color: C[1], r: 5 }] : [],
      });
      html += legend([[C[0], `trajetória (${key}, últimos ${WINDOW} s)`], [C[1], 'estado atual']]);
      html += '<p class="muted" style="margin:0">Elipse fechada: oscilação livre sem perdas. Espiral para dentro: amortecimento. Ciclo limite: regime forçado.</p>';
    } else if (tab === 'frf') {
      const res = getFrf();
      if (!res) chart.draw({ empty: V.app.modal.an ? 'Calculando…' : 'Sem análise disponível para este sistema.' });
      else {
        const ser = [];
        let lo = Infinity, hi = 0;
        const unitScale = 1000;
        for (const [k, c] of [['ax', C[0]], ['ay', C[1]]]) {
          const a = res[k];
          if (!a) continue;
          const y = new Float64Array(a.length);
          for (let i = 0; i < a.length; i++) { y[i] = a[i] * unitScale; if (y[i] > 0) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); } }
          ser.push({ x: res.f, y, color: c, width: 1.8 });
        }
        if (!(hi > 0)) chart.draw({ empty: 'A massa observada não responde às excitações configuradas.' });
        else {
          lo = Math.max(lo, hi * 1e-5);
          const pts = [];
          let measured = null;
          if (res.excFreq) {
            for (const s of ser) {
              let bi = 0;
              for (let i = 1; i < res.f.length; i++) if (Math.abs(res.f[i] - res.excFreq) < Math.abs(res.f[bi] - res.excFreq)) bi = i;
              pts.push({ x: res.f[bi], y: s.y[bi], color: th.ink, r: 4.5 });
            }
          }
          const fmaxPlot = res.f[res.f.length - 1];
          chart.draw({
            x: { min: res.f[0], max: fmaxPlot, log: true, label: 'f [Hz]' },
            y: { min: lo / 1.5, max: hi * 2.5, log: true, label: res.unit === 'm' ? '|X| [mm]' : '|X/F| [mm/N]' },
            series: ser,
            vlines: modalLines(fmaxPlot).concat(res.excFreq ? [{ x: res.excFreq, color: th.ink, dash: [2, 3], label: 'excitação', row: 2 }] : []),
            points: pts,
          });
          html += legend(ser.map((s, i) => [s.color, (res.ax && i === 0) ? '|X| em x' : '|X| em y']));
          html += ro('entrada', res.input);
          html += ro('método', res.method === 'direct' ? 'solução complexa direta' : 'superposição modal');
          if (res.excFreq) {
            const key = res.ax ? 'ax' : 'ay';
            let bi = 0;
            for (let i = 1; i < res.f.length; i++) if (Math.abs(res.f[i] - res.excFreq) < Math.abs(res.f[bi] - res.excFreq)) bi = i;
            measured = amplitude(key === 'ax' ? 'x' : 'y', Math.max(3, 3 / res.excFreq));
            html += ro('previsto em regime', `${fmt(res[key][bi] * 1000, 3)} mm`);
            html += ro('medido (últimos 3 s)', `${fmt(measured * 1000, 3)} mm`);
          }
        }
      }
    }

    // leituras comuns
    html += '<div class="ro-title">Massa ' + n.name + '</div>';
    if (d.x) html += ro('uₓ', `${V.fixed((n.x - r.x) * 1000, 2)} mm`);
    if (d.y) html += ro('u_y', `${V.fixed((n.y - r.y) * 1000, 2)} mm`);
    html += ro('|v|', `${V.fixed(Math.hypot(n.vx, n.vy), 3)} m/s`);
    const F = tab === 'fft' ? fftCache : dominant();
    if (F && F.peak > 1e-3) html += ro('freq. dominante', `${fmt(F.peakF, 3)} Hz`);
    roEl.innerHTML = html;
  }

  function getFrf() {
    const app = V.app;
    const key = app.scene.rev + ':' + rec.id + ':' + (app.modal.an ? app.modal.stamp : 0);
    if (frfCache && frfCache.key === key) return frfCache.res;
    if (!app.modal.an) return null;
    if (!frfTimer) {
      frfTimer = setTimeout(() => {
        frfTimer = null;
        let res = null;
        try { res = V.analysis.frf(app.scene, app.modal.an, rec.id); } catch (err) { res = null; }
        frfCache = { key: app.scene.rev + ':' + rec.id + ':' + app.modal.stamp, res };
        draw(true);
      }, 120);
    }
    return frfCache ? frfCache.res : null;
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    try { localStorage.setItem('bancada-vibracoes:tab', t); } catch (e) { /* armazenamento indisponível */ }
    draw(true);
  }

  function init() {
    chart = new V.Chart(document.getElementById('chart'));
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    let saved = null;
    try { saved = localStorage.getItem('bancada-vibracoes:tab'); } catch (e) { saved = null; }
    if (saved && document.querySelector(`.tab[data-tab="${saved}"]`)) setTab(saved);
  }

  V.dock = { init, observe, onSample, clear, draw, rec, get tab() { return tab; } };
})();
