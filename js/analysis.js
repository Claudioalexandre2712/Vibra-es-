/* Análises lineares em torno do equilíbrio estático:
 * - equilíbrio por Newton–Raphson com busca linear;
 * - matrizes tangentes K (inclui rigidez geométrica T/L), C e M;
 * - problema de autovalor K·φ = ω²·M·φ (modos normais);
 * - resposta em frequência em regime permanente (solução direta complexa
 *   ou superposição modal para sistemas grandes). */
(function (root) {
  'use strict';
  const Vib = root.Vib = root.Vib || {};
  const { symEig, solve, matrix } = Vib.linalg;
  const TAU = 2 * Math.PI, DEG = Math.PI / 180;

  function indexOf(scene) {
    const m = new Map();
    scene.nodes.forEach((n, i) => m.set(n.id, i));
    return m;
  }

  /* Posições de referência: apoios na posição de repouso, massas na posição atual. */
  function positions(scene) {
    const P = new Float64Array(2 * scene.nodes.length);
    scene.nodes.forEach((n, i) => {
      P[2 * i] = n.fixed ? n.x0 : n.x;
      P[2 * i + 1] = n.fixed ? n.y0 : n.y;
    });
    return P;
  }

  function freeDofs(scene) {
    const d = [];
    scene.nodes.forEach((n, i) => {
      if (n.fixed) return;
      if (!n.lockX) d.push(2 * i);
      if (!n.lockY) d.push(2 * i + 1);
    });
    return d;
  }

  /* Forças estáticas (molas + gravidade) em todos os GDL. */
  function staticForces(scene, P, idx) {
    const F = new Float64Array(P.length);
    const g = scene.gravity ? scene.g : 0;
    scene.nodes.forEach((n, i) => { if (!n.fixed) F[2 * i + 1] -= n.m * g; });
    for (const e of scene.elements) {
      if (e.type !== 'spring') continue;
      const a = idx.get(e.a), b = idx.get(e.b);
      const dx = P[2 * b] - P[2 * a], dy = P[2 * b + 1] - P[2 * a + 1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-12) continue;
      const dL = L - e.L0, f = e.k * dL + e.k3 * dL * dL * dL;
      const fx = f * dx / L, fy = f * dy / L;
      F[2 * a] += fx; F[2 * a + 1] += fy;
      F[2 * b] -= fx; F[2 * b + 1] -= fy;
    }
    return F;
  }

  function potential(scene, P, idx = indexOf(scene)) {
    const g = scene.gravity ? scene.g : 0;
    let V = 0;
    scene.nodes.forEach((n, i) => { if (!n.fixed) V += n.m * g * P[2 * i + 1]; });
    for (const e of scene.elements) {
      if (e.type !== 'spring') continue;
      const a = idx.get(e.a), b = idx.get(e.b);
      const dL = Math.hypot(P[2 * b] - P[2 * a], P[2 * b + 1] - P[2 * a + 1]) - e.L0;
      V += 0.5 * e.k * dL * dL + 0.25 * e.k3 * dL ** 4;
    }
    return V;
  }

  /* Matrizes globais 2N×2N na configuração P. */
  function assemble(scene, P, idx = indexOf(scene)) {
    const n2 = P.length;
    const K = matrix(n2), C = matrix(n2), M = new Float64Array(n2);
    scene.nodes.forEach((n, i) => { if (!n.fixed) { M[2 * i] = n.m; M[2 * i + 1] = n.m; } });
    for (const e of scene.elements) {
      const a = idx.get(e.a), b = idx.get(e.b);
      const dx = P[2 * b] - P[2 * a], dy = P[2 * b + 1] - P[2 * a + 1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-12) continue;
      const nx = dx / L, ny = dy / L;
      let k11, k12, k22, T;
      if (e.type === 'spring') {
        const dL = L - e.L0;
        const kt = e.k + 3 * e.k3 * dL * dL;
        const gT = (e.k * dL + e.k3 * dL * dL * dL) / L;   // rigidez geométrica T/L
        k11 = kt * nx * nx + gT * (1 - nx * nx);
        k12 = kt * nx * ny - gT * nx * ny;
        k22 = kt * ny * ny + gT * (1 - ny * ny);
        T = K;
      } else {
        k11 = e.c * nx * nx; k12 = e.c * nx * ny; k22 = e.c * ny * ny;
        T = C;
      }
      const da = 2 * a, db = 2 * b;
      const blk = [[k11, k12], [k12, k22]];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const v = blk[r][c];
        T[da + r][da + c] += v; T[db + r][db + c] += v;
        T[da + r][db + c] -= v; T[db + r][da + c] -= v;
      }
    }
    return { K, C, M };
  }

  function charLength(scene) {
    let s = 0, n = 0;
    for (const e of scene.elements) { s += Math.max(scene.elementLength(e), e.L0 || 0); n++; }
    return n ? Math.max(s / n, 0.05) : 1;
  }

  /* Equilíbrio estático: resolve F(u) = 0 nos GDL livres. */
  function equilibrium(scene, maxIter = 80) {
    const idx = indexOf(scene);
    const P = positions(scene);
    const dofs = freeDofs(scene), nf = dofs.length;
    if (nf === 0) return { ok: true, P, iters: 0, residual: 0 };
    const Lc = charLength(scene);
    let kmax = 0;
    for (const e of scene.elements) if (e.type === 'spring') kmax = Math.max(kmax, e.k);
    let fs = 0;
    for (const n of scene.nodes) if (!n.fixed) fs += n.m * (scene.gravity ? scene.g : 0);
    const tol = 1e-10 * Math.max(1, fs, kmax * Lc);
    const P0 = Float64Array.from(P);

    const resid = Q => {
      const F = staticForces(scene, Q, idx);
      let r = 0;
      const R = new Float64Array(nf);
      for (let i = 0; i < nf; i++) { R[i] = F[dofs[i]]; r = Math.max(r, Math.abs(R[i])); }
      return { R, r };
    };

    let { R, r } = resid(P);
    let it = 0;
    for (; it < maxIter && r > tol; it++) {
      const { K } = assemble(scene, P, idx);
      const A = matrix(nf);
      let dmax = 0;
      for (let i = 0; i < nf; i++) {
        for (let j = 0; j < nf; j++) A[i][j] = K[dofs[i]][dofs[j]];
        dmax = Math.max(dmax, Math.abs(A[i][i]));
      }
      const mu = 1e-9 * (dmax || 1);
      for (let i = 0; i < nf; i++) A[i][i] += mu;
      const d = solve(A, Float64Array.from(R));
      if (!d) return { ok: false, P: P0, iters: it, residual: r, reason: 'matriz de rigidez singular' };
      let dmaxStep = 0;
      for (let i = 0; i < nf; i++) dmaxStep = Math.max(dmaxStep, Math.abs(d[i]));
      let alpha = Math.min(1, (0.3 * Lc) / (dmaxStep || 1));
      const Q = new Float64Array(P.length);
      let accepted = false;
      for (let ls = 0; ls < 14; ls++) {
        Q.set(P);
        for (let i = 0; i < nf; i++) Q[dofs[i]] += alpha * d[i];
        const t = resid(Q);
        if (t.r < r * (1 - 1e-4 * alpha) || ls === 13) {
          P.set(Q); R = t.R; r = t.r; accepted = true;
          break;
        }
        alpha *= 0.5;
      }
      if (!accepted) break;
      let drift = 0;
      for (let i = 0; i < nf; i++) drift = Math.max(drift, Math.abs(P[dofs[i]] - P0[dofs[i]]));
      if (drift > 50 * Lc) return { ok: false, P: P0, iters: it, residual: r, reason: 'o sistema não tem posição de equilíbrio (mecanismo ou corpo livre)' };
    }
    if (r > tol * 1e3) return { ok: false, P: P0, iters: it, residual: r, reason: 'sem convergência — o sistema pode ser um mecanismo' };
    return { ok: true, P, iters: it, residual: r };
  }

  /* Modos normais na configuração P. */
  function modal(scene, P) {
    const idx = indexOf(scene);
    const dofs = freeDofs(scene), nf = dofs.length;
    const { K, C, M } = assemble(scene, P, idx);
    const res = { dofs, K, C, M, P, modes: [] };
    if (nf === 0) return res;
    const D = dofs.map(d => 1 / Math.sqrt(M[d]));
    const A = matrix(nf);
    for (let i = 0; i < nf; i++) for (let j = 0; j < nf; j++) {
      A[i][j] = 0.5 * (K[dofs[i]][dofs[j]] + K[dofs[j]][dofs[i]]) * D[i] * D[j];
    }
    const { values, vectors } = symEig(A);
    let lamScale = 0;
    for (const v of values) lamScale = Math.max(lamScale, Math.abs(v));
    const zt = 1e-9 * lamScale + 1e-12;
    for (let r = 0; r < nf; r++) {
      const lam = values[r];
      const phi = new Float64Array(nf);               // normalizado pela massa: φᵀMφ = 1
      for (let i = 0; i < nf; i++) phi[i] = vectors[i][r] * D[i];
      const w = Math.sqrt(Math.max(lam, 0));
      let cphi = 0;
      for (let i = 0; i < nf; i++) {
        let s = 0;
        const Ci = C[dofs[i]];
        for (let j = 0; j < nf; j++) s += Ci[dofs[j]] * phi[j];
        cphi += phi[i] * s;
      }
      const kind = lam < -zt ? 'unstable' : (lam < zt ? 'rigid' : 'elastic');
      const zeta = kind === 'elastic' ? cphi / (2 * w) : 0;
      // forma para desenho: deslocamento nodal com máximo 1
      const shape = new Float64Array(P.length);
      let smax = 0;
      for (let i = 0; i < nf; i++) shape[dofs[i]] = phi[i];
      for (let i = 0; i < P.length; i += 2) smax = Math.max(smax, Math.hypot(shape[i], shape[i + 1]));
      if (smax > 0) for (let i = 0; i < shape.length; i++) shape[i] /= smax;
      res.modes.push({ lam, w, f: w / TAU, zeta, fd: w / TAU * Math.sqrt(Math.max(0, 1 - zeta * zeta)), kind, phi, shape, cphi });
    }
    return res;
  }

  /* Fasores das excitações configuradas (forças e excitações de base). */
  function excitations(scene) {
    const N = scene.nodes.length;
    const Fr = new Float64Array(2 * N), Fi = new Float64Array(2 * N);
    const Ur = new Float64Array(2 * N), Ui = new Float64Array(2 * N);
    let has = false, freq = 0;
    scene.nodes.forEach((n, i) => {
      if (!n.fixed && n.force && n.force.F0) {
        const a = n.force.angle * DEG, ph = (n.force.phase || 0) * DEG;
        Fr[2 * i] = n.force.F0 * Math.cos(a) * Math.cos(ph);
        Fi[2 * i] = n.force.F0 * Math.cos(a) * Math.sin(ph);
        Fr[2 * i + 1] = n.force.F0 * Math.sin(a) * Math.cos(ph);
        Fi[2 * i + 1] = n.force.F0 * Math.sin(a) * Math.sin(ph);
        has = true;
        if (n.force.type !== 'sweep') freq = freq || n.force.f;
      }
      if (n.fixed && n.base && n.base.A) {
        const a = n.base.angle * DEG, ph = (n.base.phase || 0) * DEG;
        Ur[2 * i] = n.base.A * Math.cos(a) * Math.cos(ph);
        Ui[2 * i] = n.base.A * Math.cos(a) * Math.sin(ph);
        Ur[2 * i + 1] = n.base.A * Math.sin(a) * Math.cos(ph);
        Ui[2 * i + 1] = n.base.A * Math.sin(a) * Math.sin(ph);
        has = true;
        freq = freq || n.base.f;
      }
    });
    return { Fr, Fi, Ur, Ui, has, freq };
  }

  /* Resposta em frequência: amplitude de regime do nó outId (x e y) para
   * todas as excitações configuradas (mesma frequência). Sem excitação,
   * usa força unitária no próprio nó (receptância, m/N). */
  function frf(scene, an, outId, opts = {}) {
    const idx = indexOf(scene);
    const { dofs, K, C, M, modes } = an;
    const nf = dofs.length;
    const out = idx.get(outId);
    if (nf === 0 || out === undefined) return null;
    const pos = new Map(dofs.map((d, i) => [d, i]));
    const ex = excitations(scene);
    let unit = 'm', input = 'excitações configuradas';
    if (!ex.has) {
      const d = pos.has(2 * out) ? 2 * out : (pos.has(2 * out + 1) ? 2 * out + 1 : dofs[0]);
      ex.Fr[d] = 1;
      unit = 'm/N';
      input = 'força unitária em ' + scene.nodes[Math.floor(d / 2)].name + (d % 2 ? ' (y)' : ' (x)');
    }
    const baseDofs = [];
    for (let j = 0; j < ex.Ur.length; j++) if (ex.Ur[j] || ex.Ui[j]) baseDofs.push(j);

    const el = modes.filter(m => m.kind === 'elastic' && m.f > 0);
    let fmin = opts.fmin, fmax = opts.fmax;
    if (!fmin || !fmax) {
      if (el.length) {
        fmin = el[0].f / 8;
        fmax = el[Math.min(el.length, 10) - 1].f * 3;
      } else { fmin = 0.05; fmax = 20; }
      if (ex.freq) { fmin = Math.min(fmin, ex.freq / 2); fmax = Math.max(fmax, ex.freq * 2); }
    }
    const npts = opts.npts || 360;
    const fl = [];
    for (let i = 0; i < npts; i++) fl.push(npts === 1 ? fmin : fmin * Math.pow(fmax / fmin, i / (npts - 1)));
    for (const m of el) if (m.f > fmin && m.f < fmax) fl.push(m.f, m.f * (1 - 0.5 * m.zeta), m.f * (1 + 0.5 * m.zeta));
    fl.sort((a, b) => a - b);

    const method = opts.method || (nf <= 70 ? 'direct' : 'modal');
    const ax = pos.has(2 * out) ? new Float64Array(fl.length) : null;
    const ay = pos.has(2 * out + 1) ? new Float64Array(fl.length) : null;
    const br = new Float64Array(nf), bi = new Float64Array(nf);

    fl.forEach((f, k) => {
      const w = TAU * f;
      // b = F − (K_fb + iωC_fb)·U_b
      for (let i = 0; i < nf; i++) {
        const di = dofs[i];
        let sr = ex.Fr[di], si = ex.Fi[di];
        for (const j of baseDofs) {
          const kk = K[di][j], cc = w * C[di][j];
          sr -= kk * ex.Ur[j] - cc * ex.Ui[j];
          si -= kk * ex.Ui[j] + cc * ex.Ur[j];
        }
        br[i] = sr; bi[i] = si;
      }
      let xr, xi;
      if (method === 'direct') {
        const n2 = 2 * nf, A = matrix(n2), rhs = new Float64Array(n2);
        for (let i = 0; i < nf; i++) {
          const Ki = K[dofs[i]], Ci = C[dofs[i]];
          for (let j = 0; j < nf; j++) {
            const re = Ki[dofs[j]] - (i === j ? w * w * M[dofs[i]] : 0);
            const im = w * Ci[dofs[j]];
            A[i][j] = re; A[i][j + nf] = -im;
            A[i + nf][j] = im; A[i + nf][j + nf] = re;
          }
          rhs[i] = br[i]; rhs[i + nf] = bi[i];
        }
        const x = solve(A, rhs);
        if (!x) { xr = new Float64Array(nf).fill(NaN); xi = xr; }
        else { xr = x.subarray(0, nf); xi = x.subarray(nf); }
      } else {
        xr = new Float64Array(nf); xi = new Float64Array(nf);
        for (const m of modes) {
          let pr = 0, pi = 0;
          for (let i = 0; i < nf; i++) { pr += m.phi[i] * br[i]; pi += m.phi[i] * bi[i]; }
          const dr = Math.max(m.lam, 0) - w * w, di = 2 * m.zeta * m.w * w;
          const den = dr * dr + di * di || 1e-300;
          const qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
          for (let i = 0; i < nf; i++) { xr[i] += m.phi[i] * qr; xi[i] += m.phi[i] * qi; }
        }
      }
      if (ax) { const i = pos.get(2 * out); ax[k] = Math.hypot(xr[i], xi[i]); }
      if (ay) { const i = pos.get(2 * out + 1); ay[k] = Math.hypot(xr[i], xi[i]); }
    });
    return { f: Float64Array.from(fl), ax, ay, unit, input, method, excFreq: ex.has && unit === 'm' ? ex.freq : 0 };
  }

  Vib.analysis = { positions, freeDofs, staticForces, potential, assemble, equilibrium, modal, frf, excitations, indexOf };
})(typeof window !== 'undefined' ? window : globalThis);
