/* Modelo da cena: nós (massas e apoios) e elementos (molas e amortecedores).
 * Unidades SI: m, kg, s, N, N/m, N·s/m. Eixo y para cima. */
(function (root) {
  'use strict';
  const Vib = root.Vib = root.Vib || {};

  class Scene {
    constructor() {
      this.nodes = [];
      this.elements = [];
      this.gravity = true;
      this.g = 9.81;
      this.meta = null;          // { title, text, theory } da predefinição carregada
      this.version = 0;          // muda quando a topologia muda
      this.rev = 0;              // muda a cada alteração de parâmetro ou estado editado
      this.nextId = 1;
      this.seq = { m: 0, A: 0, k: 0, c: 0 };
      this.byId = new Map();
    }

    touch(structural) {
      if (structural) this.version++;
      this.rev++;
    }

    get(id) { return this.byId.get(id); }

    addNode(x, y, o = {}) {
      const fixed = !!o.fixed;
      const prefix = fixed ? 'A' : 'm';
      const n = {
        id: o.id || this.nextId++,
        name: o.name || prefix + (++this.seq[prefix]),
        x, y, vx: o.vx || 0, vy: o.vy || 0,
        x0: o.x0 !== undefined ? o.x0 : x,
        y0: o.y0 !== undefined ? o.y0 : y,
        m: o.m || 1,
        fixed,
        lockX: !!o.lockX,
        lockY: !!o.lockY,
        force: o.force ? Object.assign({}, o.force) : null,
        base: o.base ? Object.assign({}, o.base) : null,
      };
      if (n.id >= this.nextId) this.nextId = n.id + 1;
      this.nodes.push(n);
      this.byId.set(n.id, n);
      this.touch(true);
      return n;
    }

    addElement(type, a, b, o = {}) {
      if (a === b) return null;
      const na = this.get(a), nb = this.get(b);
      if (!na || !nb) return null;
      const prefix = type === 'spring' ? 'k' : 'c';
      const e = {
        id: o.id || this.nextId++,
        name: o.name || prefix + (++this.seq[prefix]),
        type, a, b,
        k: o.k !== undefined ? o.k : 100,
        k3: o.k3 || 0,
        c: o.c !== undefined ? o.c : 1,
        L0: o.L0 !== undefined ? o.L0 : Math.hypot(nb.x - na.x, nb.y - na.y),
      };
      if (e.id >= this.nextId) this.nextId = e.id + 1;
      this.elements.push(e);
      this.byId.set(e.id, e);
      this.touch(true);
      return e;
    }

    removeNode(id) {
      const n = this.get(id);
      if (!n) return;
      this.elements.filter(e => e.a === id || e.b === id).forEach(e => this.byId.delete(e.id));
      this.elements = this.elements.filter(e => e.a !== id && e.b !== id);
      this.nodes = this.nodes.filter(m => m.id !== id);
      this.byId.delete(id);
      this.touch(true);
    }

    removeElement(id) {
      this.elements = this.elements.filter(e => e.id !== id);
      this.byId.delete(id);
      this.touch(true);
    }

    setFixed(n, fixed) {
      if (n.fixed === fixed) return;
      n.fixed = fixed;
      n.vx = n.vy = 0;
      n.x0 = n.x; n.y0 = n.y;
      if (fixed) n.force = null; else n.base = null;
      this.touch(true);
    }

    elementLength(e) {
      const a = this.get(e.a), b = this.get(e.b);
      return Math.hypot(b.x - a.x, b.y - a.y);
    }

    attached(id) {
      return this.elements.filter(e => e.a === id || e.b === id);
    }

    freeDofCount() {
      let n = 0;
      for (const nd of this.nodes) if (!nd.fixed) n += (nd.lockX ? 0 : 1) + (nd.lockY ? 0 : 1);
      return n;
    }

    serialize() {
      return {
        format: 'bancada-vibracoes',
        version: 1,
        gravity: this.gravity,
        g: this.g,
        meta: this.meta,
        nodes: this.nodes.map(n => ({
          id: n.id, name: n.name, x: n.x, y: n.y, vx: n.vx, vy: n.vy, x0: n.x0, y0: n.y0,
          m: n.m, fixed: n.fixed, lockX: n.lockX, lockY: n.lockY, force: n.force, base: n.base,
        })),
        elements: this.elements.map(e => ({
          id: e.id, name: e.name, type: e.type, a: e.a, b: e.b, k: e.k, k3: e.k3, c: e.c, L0: e.L0,
        })),
      };
    }

    static deserialize(o) {
      if (!o || !Array.isArray(o.nodes) || !Array.isArray(o.elements)) throw new Error('Arquivo sem nós ou elementos.');
      const s = new Scene();
      s.gravity = o.gravity !== false;
      s.g = Number.isFinite(o.g) ? o.g : 9.81;
      s.meta = o.meta || null;
      for (const n of o.nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error('Nó com posição inválida.');
        s.addNode(n.x, n.y, n);
      }
      for (const e of o.elements) s.addElement(e.type === 'damper' ? 'damper' : 'spring', e.a, e.b, e);
      // mantém a numeração automática coerente com os nomes existentes
      for (const it of [...s.nodes, ...s.elements]) {
        const m = /^([mAkc])(\d+)$/.exec(it.name || '');
        if (m) s.seq[m[1]] = Math.max(s.seq[m[1]], +m[2]);
      }
      return s;
    }
  }

  Vib.Scene = Scene;
})(typeof window !== 'undefined' ? window : globalThis);
