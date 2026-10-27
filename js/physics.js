/* Motor de integração temporal.
 * Equações: m·a = Σ forças de molas (lineares + cúbicas, geometria exata em 2D),
 * amortecedores viscosos, gravidade, forças harmônicas e excitação de base.
 * Integrador: Runge–Kutta de 4ª ordem com passo escolhido pela maior
 * frequência estimada (limite de Gershgorin), nunca pelo relógio da tela. */
(function (root) {
  'use strict';
  const Vib = root.Vib = root.Vib || {};
  const TAU = 2 * Math.PI;
  const DEG = Math.PI / 180;
  const DRAG_HZ = 4;        // rigidez da "mão" que puxa a massa: f = 4 Hz para a massa sozinha
  const DRAG_ZETA = 0.9;

  /* Valor escalar da força externa no instante t. */
  function forceValue(f, t) {
    if (!f) return 0;
    const ph0 = (f.phase || 0) * DEG;
    if (f.type === 'sweep') {
      const T = Math.max(f.T || 1, 1e-6);
      const ph = t <= T
        ? TAU * (f.f * t + (f.f1 - f.f) * t * t / (2 * T))
        : TAU * (f.f * T + (f.f1 - f.f) * T / 2 + f.f1 * (t - T));
      return f.F0 * Math.sin(ph + ph0);
    }
    return f.F0 * Math.sin(TAU * f.f * t + ph0);
  }

  function forceFreq(f, t) {
    if (!f) return 0;
    if (f.type === 'sweep') return t <= f.T ? f.f + (f.f1 - f.f) * t / f.T : f.f1;
    return f.f;
  }

  /* Deslocamento e velocidade de um apoio com excitação de base. */
  function baseMotion(b, t, out) {
    const w = TAU * b.f, arg = w * t + (b.phase || 0) * DEG;
    const s = Math.sin(arg), c = Math.cos(arg);
    const ux = Math.cos(b.angle * DEG), uy = Math.sin(b.angle * DEG);
    out[0] = b.A * s * ux; out[1] = b.A * s * uy;
    out[2] = b.A * w * c * ux; out[3] = b.A * w * c * uy;
    return out;
  }

  class Engine {
    constructor(scene) {
      this.setScene(scene);
    }

    setScene(scene) {
      this.scene = scene;
      this.t = 0;
      this.Ediss = 0;
      this.Win = 0;
      this.version = -1;
      this.baseRev = -1;
      this.drag = null;          // { id, tx, ty }
      this.limited = false;
      this.lastH = 0;
      this.lastSteps = 0;
      this.sampleDt = 1 / 200;
      this.nextSample = 0;
      this.onSample = null;
      this.E0 = 0;
      this.Escale = 1e-12;
      this.energyErr = 0;
      this._bm = new Float64Array(4);
    }

    compile() {
      const s = this.scene, N = s.nodes.length;
      this.N = N;
      this.index = new Map();
      s.nodes.forEach((n, i) => this.index.set(n.id, i));
      this.els = s.elements.filter(e => this.index.has(e.a) && this.index.has(e.b));
      this.ia = Int32Array.from(this.els, e => this.index.get(e.a));
      this.ib = Int32Array.from(this.els, e => this.index.get(e.b));
      const L = 4 * N + 2;
      this.Y = new Float64Array(L);
      this.k1 = new Float64Array(L);
      this.k2 = new Float64Array(L);
      this.k3 = new Float64Array(L);
      this.k4 = new Float64Array(L);
      this.tmp = new Float64Array(L);
      this.F = new Float64Array(2 * N);
      this.sk = new Float64Array(N);
      this.sc = new Float64Array(N);
      this.version = s.version;
    }

    ensure() {
      if (this.version !== this.scene.version) this.compile();
    }

    pack() {
      const Y = this.Y, nodes = this.scene.nodes;
      for (let i = 0; i < this.N; i++) {
        const n = nodes[i], o = 4 * i;
        Y[o] = n.x; Y[o + 1] = n.y;
        Y[o + 2] = n.lockX ? 0 : n.vx;
        Y[o + 3] = n.lockY ? 0 : n.vy;
      }
      Y[4 * this.N] = this.Ediss;
      Y[4 * this.N + 1] = this.Win;
      this.kinematics(this.t, Y);
    }

    unpack() {
      const Y = this.Y, nodes = this.scene.nodes;
      for (let i = 0; i < this.N; i++) {
        const n = nodes[i], o = 4 * i;
        n.x = Y[o]; n.y = Y[o + 1]; n.vx = Y[o + 2]; n.vy = Y[o + 3];
      }
      this.Ediss = Y[4 * this.N];
      this.Win = Y[4 * this.N + 1];
    }

    /* Impõe posição/velocidade dos apoios (fixos ou com excitação de base). */
    kinematics(t, Y) {
      const nodes = this.scene.nodes, bm = this._bm;
      for (let i = 0; i < this.N; i++) {
        const n = nodes[i];
        if (!n.fixed) continue;
        const o = 4 * i;
        if (n.base && n.base.A) {
          baseMotion(n.base, t, bm);
          Y[o] = n.x0 + bm[0]; Y[o + 1] = n.y0 + bm[1]; Y[o + 2] = bm[2]; Y[o + 3] = bm[3];
        } else {
          Y[o] = n.x0; Y[o + 1] = n.y0; Y[o + 2] = 0; Y[o + 3] = 0;
        }
      }
    }

    deriv(t, Y, D) {
      const s = this.scene, nodes = s.nodes, N = this.N, F = this.F;
      const els = this.els, ia = this.ia, ib = this.ib;
      F.fill(0);
      this.kinematics(t, Y);
      let pd = 0, pin = 0;
      const g = s.gravity ? s.g : 0;

      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        if (n.fixed) continue;
        F[2 * i + 1] -= n.m * g;
        if (n.force && n.force.F0) {
          const v = forceValue(n.force, t), a = n.force.angle * DEG;
          const fx = v * Math.cos(a), fy = v * Math.sin(a);
          F[2 * i] += fx; F[2 * i + 1] += fy;
          pin += fx * Y[4 * i + 2] + fy * Y[4 * i + 3];
        }
      }

      for (let j = 0; j < els.length; j++) {
        const e = els[j], a = ia[j], b = ib[j];
        const oa = 4 * a, ob = 4 * b;
        const dx = Y[ob] - Y[oa], dy = Y[ob + 1] - Y[oa + 1];
        const L = Math.sqrt(dx * dx + dy * dy);
        if (L < 1e-12) continue;
        const nx = dx / L, ny = dy / L;
        let f;
        if (e.type === 'spring') {
          const dL = L - e.L0;
          f = e.k * dL + e.k3 * dL * dL * dL;      // tração > 0
        } else {
          const vrel = (Y[ob + 2] - Y[oa + 2]) * nx + (Y[ob + 3] - Y[oa + 3]) * ny;
          f = e.c * vrel;
          pd += e.c * vrel * vrel;
        }
        const fx = f * nx, fy = f * ny;
        F[2 * a] += fx; F[2 * a + 1] += fy;
        F[2 * b] -= fx; F[2 * b + 1] -= fy;
        // potência entregue pelos apoios móveis ao sistema
        if (nodes[a].fixed) pin -= fx * Y[oa + 2] + fy * Y[oa + 3];
        if (nodes[b].fixed) pin += fx * Y[ob + 2] + fy * Y[ob + 3];
      }

      const dr = this.drag;
      if (dr) {
        const i = this.index.get(dr.id);
        if (i !== undefined && !nodes[i].fixed) {
          const n = nodes[i], o = 4 * i, w = TAU * DRAG_HZ;
          const km = n.m * w * w, cm = 2 * DRAG_ZETA * n.m * w;
          const fx = km * (dr.tx - Y[o]) - cm * Y[o + 2];
          const fy = km * (dr.ty - Y[o + 1]) - cm * Y[o + 3];
          F[2 * i] += fx; F[2 * i + 1] += fy;
          pin += fx * Y[o + 2] + fy * Y[o + 3];
        }
      }

      for (let i = 0; i < N; i++) {
        const n = nodes[i], o = 4 * i;
        if (n.fixed) { D[o] = D[o + 1] = D[o + 2] = D[o + 3] = 0; continue; }
        const im = 1 / n.m;
        D[o] = n.lockX ? 0 : Y[o + 2];
        D[o + 1] = n.lockY ? 0 : Y[o + 3];
        D[o + 2] = n.lockX ? 0 : F[2 * i] * im;
        D[o + 3] = n.lockY ? 0 : F[2 * i + 1] * im;
      }
      D[4 * N] = pd;
      D[4 * N + 1] = pin;
    }

    rk4(h) {
      const Y = this.Y, n = Y.length, t = this.t;
      const k1 = this.k1, k2 = this.k2, k3 = this.k3, k4 = this.k4, tmp = this.tmp;
      this.deriv(t, Y, k1);
      for (let i = 0; i < n; i++) tmp[i] = Y[i] + 0.5 * h * k1[i];
      this.deriv(t + 0.5 * h, tmp, k2);
      for (let i = 0; i < n; i++) tmp[i] = Y[i] + 0.5 * h * k2[i];
      this.deriv(t + 0.5 * h, tmp, k3);
      for (let i = 0; i < n; i++) tmp[i] = Y[i] + h * k3[i];
      this.deriv(t + h, tmp, k4);
      const h6 = h / 6;
      for (let i = 0; i < n; i++) Y[i] += h6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      this.t = t + h;
      this.kinematics(this.t, Y);
    }

    /* Passo estável e preciso: ω_max·h ≤ 0,15 (limite de Gershgorin para M⁻¹K),
     * taxa de amortecimento·h ≤ 0,5 e ≥ 40 passos por período de excitação. */
    stableDt() {
      const nodes = this.scene.nodes, Y = this.Y, sk = this.sk, sc = this.sc;
      sk.fill(0); sc.fill(0);
      const inv = i => (nodes[i].fixed ? 0 : 1 / nodes[i].m);
      for (let j = 0; j < this.els.length; j++) {
        const e = this.els[j], a = this.ia[j], b = this.ib[j];
        const s = inv(a) + inv(b);
        if (e.type === 'spring') {
          const dx = Y[4 * b] - Y[4 * a], dy = Y[4 * b + 1] - Y[4 * a + 1];
          const L = Math.max(Math.hypot(dx, dy), 1e-9), dL = L - e.L0;
          const T = e.k * dL + e.k3 * dL * dL * dL;
          const keff = Math.abs(e.k + 3 * e.k3 * dL * dL) + Math.abs(T) / L;
          sk[a] += keff * s; sk[b] += keff * s;
        } else {
          sc[a] += e.c * s; sc[b] += e.c * s;
        }
      }
      let w2 = 0, cr = 0, fmax = 0;
      for (let i = 0; i < this.N; i++) {
        const n = nodes[i];
        if (n.fixed) {
          if (n.base && n.base.A) fmax = Math.max(fmax, n.base.f);
          continue;
        }
        w2 = Math.max(w2, sk[i]);
        cr = Math.max(cr, sc[i]);
        if (n.force && n.force.F0) fmax = Math.max(fmax, n.force.f, n.force.type === 'sweep' ? n.force.f1 : 0);
      }
      if (this.drag) {
        const w = TAU * DRAG_HZ;
        w2 = Math.max(w2, 2 * w * w);
        cr = Math.max(cr, 2 * 2 * DRAG_ZETA * w);
      }
      let h = 1 / 120;
      if (w2 > 0) h = Math.min(h, 0.15 / Math.sqrt(w2));
      if (cr > 0) h = Math.min(h, 0.5 / cr);
      if (fmax > 0) h = Math.min(h, 1 / (40 * fmax));
      return h;
    }

    energies(Y = this.Y) {
      const s = this.scene, nodes = s.nodes, g = s.gravity ? s.g : 0;
      let T = 0, Vel = 0, Vg = 0;
      for (let i = 0; i < this.N; i++) {
        const n = nodes[i];
        if (n.fixed) continue;
        const o = 4 * i;
        T += 0.5 * n.m * (Y[o + 2] * Y[o + 2] + Y[o + 3] * Y[o + 3]);
        Vg += n.m * g * Y[o + 1];
      }
      for (let j = 0; j < this.els.length; j++) {
        const e = this.els[j];
        if (e.type !== 'spring') continue;
        const a = 4 * this.ia[j], b = 4 * this.ib[j];
        const dL = Math.hypot(Y[b] - Y[a], Y[b + 1] - Y[a + 1]) - e.L0;
        Vel += 0.5 * e.k * dL * dL + 0.25 * e.k3 * dL * dL * dL * dL;
      }
      return { T, Vel, Vg, D: Y[4 * this.N], W: Y[4 * this.N + 1] };
    }

    /* Nova referência do balanço de energia (após edições feitas fora da integração). */
    rebase() {
      this.ensure();
      this.pack();
      const E = this.energies();
      this.E0 = E.T + E.Vel + E.Vg + E.D - E.W;
      this.Escale = Math.max(E.T + Math.abs(E.Vel), 1e-12);
      this.energyErr = 0;
      this.baseRev = this.scene.rev;
    }

    /* Avança simDt segundos de tempo simulado. Retorna false se divergir. */
    advance(simDt) {
      this.ensure();
      if (this.baseRev !== this.scene.rev) this.rebase();
      this.pack();
      const h0 = this.stableDt();
      const cost = 4 * (this.els.length + this.N) + 8;
      const maxSteps = Math.max(10, Math.min(6000, Math.floor(3e5 / cost)));
      let n = Math.max(1, Math.ceil(simDt / h0 - 1e-9));
      this.limited = n > maxSteps;
      if (this.limited) n = maxSteps;
      const h = this.limited ? h0 : simDt / n;
      const backupT = this.t;
      for (let k = 0; k < n; k++) {
        this.rk4(h);
        if (this.onSample) {
          while (this.t >= this.nextSample) {
            this.onSample(this);
            this.nextSample += this.sampleDt;
          }
        }
      }
      for (let i = 0; i < this.Y.length; i++) {
        if (!Number.isFinite(this.Y[i]) || Math.abs(this.Y[i]) > 1e9) {
          this.t = backupT;
          return false;
        }
      }
      this.lastH = h;
      this.lastSteps = n;
      this.advanced = n * h;
      this.unpack();
      const E = this.energies();
      this.Escale = Math.max(this.Escale, E.T + Math.abs(E.Vel));
      this.energyErr = Math.abs(E.T + E.Vel + E.Vg + E.D - E.W - this.E0) / this.Escale;
      return true;
    }

    /* Leitura do estado de um nó no vetor de integração (usada na amostragem). */
    nodeState(id) {
      const i = this.index.get(id);
      if (i === undefined) return null;
      const o = 4 * i, Y = this.Y;
      return [Y[o], Y[o + 1], Y[o + 2], Y[o + 3]];
    }
  }

  Vib.physics = { Engine, forceValue, forceFreq, baseMotion, TAU, DEG };
})(typeof window !== 'undefined' ? window : globalThis);
