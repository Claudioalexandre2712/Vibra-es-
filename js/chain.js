/* Montador em cadeia: descreve um sistema "parede – k,c – m1 – k,c – m2 …"
 * por uma configuração simples, gera a cena e explica o sistema com as
 * fórmulas e os números do caso. */
(function (root) {
  'use strict';
  const Vib = root.Vib = root.Vib || {};
  const TAU = 2 * Math.PI;

  const link = (o = {}) => Object.assign({ spring: true, k: 100, damper: false, c: 1 }, o);

  function defaults() {
    return {
      orient: 'h',            // 'h' horizontal sobre trilho | 'hang' pendurado | 'stand' apoiado na base
      end: 'free',            // última massa 'free' ou presa a uma parede 'wall'
      masses: [{ m: 1 }],
      links: [link({ damper: true, c: 1 })],
      excite: { type: 'initial', mass: 0, amp: 0.1, f: 1.5, f1: 3, T: 60 },
    };
  }

  function clone(cfg) { return JSON.parse(JSON.stringify(cfg)); }

  /* Ajusta o número de ligações ao número de massas e à extremidade. */
  function normalize(cfg) {
    const c = clone(cfg);
    c.masses = c.masses.length ? c.masses : [{ m: 1 }];
    const need = c.masses.length + (c.end === 'wall' ? 1 : 0);
    while (c.links.length < need) c.links.push(link());
    c.links.length = need;
    c.excite = Object.assign({ type: 'none', mass: 0, amp: 0.1, f: 1.5, f1: 3, T: 60 }, c.excite || {});
    c.excite.mass = Math.min(Math.max(0, c.excite.mass | 0), c.masses.length - 1);
    return c;
  }

  /* O que muda a topologia (exige reconstruir a cena). */
  /* Comprimento natural de cada ligação: menor na vertical para caber no desenho. */
  const spacingOf = c => c.spacing || (c.orient === 'h' ? 0.6 : 0.4);

  function signature(cfg) {
    const c = normalize(cfg);
    return JSON.stringify([c.orient, c.end, c.masses.length, c.links.map(l => [!!l.spring, !!l.damper]),
      c.excite.type, c.excite.mass, c.excite.type === 'initial' ? c.excite.amp : 0, spacingOf(c)]);
  }

  const BASE_NAME = { h: 'parede', hang: 'teto', stand: 'base' };

  function position(c, i) {
    const L = spacingOf(c);
    if (c.orient === 'h') return [i * L, 0];
    if (c.orient === 'hang') return [0, -i * L];
    return [0, i * L];
  }

  /* Gera a cena. Retorna { scene, perturb } — perturb aplica o deslocamento
   * inicial depois que as massas forem colocadas no equilíbrio. */
  function build(cfg) {
    const c = normalize(cfg);
    const s = new Vib.Scene();
    const n = c.masses.length, horiz = c.orient === 'h';
    const ids = { base: null, end: null, masses: [], springs: [], dampers: [] };
    const base = s.addNode(...position(c, 0), { fixed: true, name: BASE_NAME[c.orient] });
    ids.base = base.id;
    const chain = [base];
    c.masses.forEach((q, i) => {
      const m = s.addNode(...position(c, i + 1), { m: q.m, lockY: horiz, lockX: !horiz, name: 'm' + (i + 1) });
      ids.masses.push(m.id);
      chain.push(m);
    });
    if (c.end === 'wall') {
      const w = s.addNode(...position(c, n + 1), { fixed: true, name: BASE_NAME[c.orient] + ' 2' });
      ids.end = w.id;
      chain.push(w);
    }
    c.links.forEach((l, j) => {
      const a = chain[j].id, b = chain[j + 1].id;
      ids.springs.push(l.spring ? s.addElement('spring', a, b, { k: l.k, L0: spacingOf(c), name: 'k' + (j + 1) }).id : null);
      ids.dampers.push(l.damper ? s.addElement('damper', a, b, { c: l.c, L0: spacingOf(c), name: 'c' + (j + 1) }).id : null);
    });
    s.seq = { m: n, A: 2, k: c.links.length, c: c.links.length };
    applyExcite(s, c, ids);
    s.chain = { cfg: c, ids, sig: signature(c) };
    const e = c.excite;
    const perturb = e.type === 'initial' ? (sc => {
      const m = sc.get(ids.masses[e.mass]);
      if (!m) return;
      if (horiz) m.x += e.amp; else m.y -= e.amp;
    }) : null;
    return { scene: s, perturb };
  }

  function applyExcite(s, c, ids) {
    const e = c.excite, horiz = c.orient === 'h', ang = horiz ? 0 : 90;
    ids.masses.forEach(id => { s.get(id).force = null; });
    s.get(ids.base).base = null;
    if (e.type === 'force') s.get(ids.masses[e.mass]).force = { type: 'harmonic', F0: e.amp, f: e.f, angle: ang, phase: 0 };
    if (e.type === 'sweep') s.get(ids.masses[e.mass]).force = { type: 'sweep', F0: e.amp, f: e.f, f1: e.f1, T: e.T, angle: ang, phase: 0 };
    if (e.type === 'base') s.get(ids.base).base = { A: e.amp, f: e.f, angle: ang, phase: 0 };
  }

  /* Atualiza valores sem reconstruir (a simulação continua rodando). */
  function update(s, cfg) {
    const c = normalize(cfg);
    if (!s.chain || s.chain.sig !== signature(c)) return false;
    const ids = s.chain.ids;
    c.masses.forEach((q, i) => { s.get(ids.masses[i]).m = q.m; });
    c.links.forEach((l, j) => {
      if (ids.springs[j]) s.get(ids.springs[j]).k = l.k;
      if (ids.dampers[j]) s.get(ids.dampers[j]).c = l.c;
    });
    applyExcite(s, c, ids);
    s.chain.cfg = c;
    return true;
  }

  /* Lê de volta os valores da cena (editados pela aba Peça, por exemplo). */
  function sync(s) {
    if (!s || !s.chain) return null;
    const c = s.chain.cfg, ids = s.chain.ids;
    c.masses.forEach((q, i) => { const n = s.get(ids.masses[i]); if (n) q.m = n.m; });
    c.links.forEach((l, j) => {
      const sp = ids.springs[j] && s.get(ids.springs[j]); if (sp) l.k = sp.k;
      const d = ids.dampers[j] && s.get(ids.dampers[j]); if (d) l.c = d.c;
    });
    const fi = ids.masses.findIndex(id => { const n = s.get(id); return n && n.force && n.force.F0; });
    const b = s.get(ids.base);
    const e = c.excite;
    if (fi >= 0) {
      const F = s.get(ids.masses[fi]).force;
      e.type = F.type === 'sweep' ? 'sweep' : 'force'; e.mass = fi; e.amp = F.F0; e.f = F.f;
      if (F.type === 'sweep') { e.f1 = F.f1; e.T = F.T; }
    } else if (b && b.base && b.base.A) { e.type = 'base'; e.amp = b.base.A; e.f = b.base.f; }
    else if (e.type !== 'initial') e.type = 'initial';
    s.chain.sig = signature(c);
    return c;
  }

  /* Matrizes da cadeia (GDL = deslocamento de cada massa ao longo do eixo). */
  function matrices(cfg) {
    const c = normalize(cfg), n = c.masses.length;
    const M = [], K = [], C = [];
    for (let i = 0; i < n; i++) { M.push(new Array(n).fill(0)); K.push(new Array(n).fill(0)); C.push(new Array(n).fill(0)); M[i][i] = c.masses[i].m; }
    c.links.forEach((l, j) => {
      const k = l.spring ? l.k : 0, d = l.damper ? l.c : 0;
      const a = j - 1, b = j;          // massa à esquerda (−1 = parede) e à direita
      for (const [A, X] of [[K, k], [C, d]]) {
        if (a >= 0) A[a][a] += X;
        if (b < n) A[b][b] += X;
        if (a >= 0 && b < n) { A[a][b] -= X; A[b][a] -= X; }
      }
    });
    return { M, K, C };
  }

  /* ---------- explicação ---------- */
  const nf = new Map();
  const f = (v, d = 3) => {
    if (Vib.fmt) return Vib.fmt(v, d);
    if (!nf.has(d)) nf.set(d, new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: d }));
    return Number.isFinite(v) ? nf.get(d).format(v) : '—';
  };

  function explain(cfg, scene) {
    const c = normalize(cfg), n = c.masses.length, g = scene && scene.gravity ? scene.g : 9.81;
    const out = { lines: [], notes: [], matrices: null };
    const L = (label, expr, value) => out.lines.push({ label, expr, value });
    const { M, K, C } = matrices(c);
    if (n === 1) {
      const m = c.masses[0].m, k = K[0][0], cc = C[0][0];
      const springs = c.links.filter(l => l.spring).length;
      if (springs > 1) L('Rigidez equivalente', 'k = k₁ + k₂ (molas em paralelo na massa)', `${f(k)} N/m`);
      if (k <= 0) {
        out.notes.push('Sem mola ligada à massa: não há força de retorno, então o sistema não oscila. Marque “mola” em alguma ligação.');
        return out;
      }
      const wn = Math.sqrt(k / m), fn = wn / TAU;
      L('Frequência natural', `ωn = √(k/m) = √(${f(k)} / ${f(m)})`, `${f(wn, 4)} rad/s`);
      L('', 'fn = ωn / 2π', `${f(fn, 4)} Hz`);
      L('Período', 'T = 1 / fn', `${f(1 / fn, 3)} s`);
      if (c.orient !== 'h') L('Deflexão estática', `δst = m·g / k = ${f(m)}·${f(g)} / ${f(k)}`, `${f(m * g / k * 1000, 3)} mm`);
      let z = 0;
      if (cc > 0) {
        z = cc / (2 * Math.sqrt(k * m));
        L('Fator de amortecimento', `ζ = c / (2√(k·m)) = ${f(cc)} / (2√(${f(k)}·${f(m)}))`, f(z, 3));
        if (z < 1) {
          L('Frequência amortecida', 'ωd = ωn·√(1 − ζ²)', `${f(wn * Math.sqrt(1 - z * z), 4)} rad/s`);
          out.notes.push(`ζ = ${f(z, 2)} < 1: subamortecido. A massa oscila e a amplitude cai a cada ciclo (decremento logarítmico δ = 2πζ/√(1−ζ²) = ${f(TAU * z / Math.sqrt(1 - z * z), 3)}).`);
        } else if (Math.abs(z - 1) < 1e-6) out.notes.push('ζ = 1: amortecimento crítico. Volta ao repouso o mais rápido possível, sem oscilar.');
        else out.notes.push(`ζ = ${f(z, 2)} > 1: superamortecido. Volta devagar, sem oscilar.`);
      } else out.notes.push('Sem amortecedor: a energia não se perde e a oscilação continua para sempre (sistema conservativo).');
      const e = c.excite;
      if (e.type === 'initial') out.notes.push(`Solta de x₀ = ${f(e.amp * 1000)} mm, sem força externa: vibração livre na frequência natural.`);
      if (e.type === 'force' || e.type === 'sweep') {
        const xst = e.amp / k;
        L('Deflexão estática da força', `Xst = F₀ / k = ${f(e.amp)} / ${f(k)}`, `${f(xst * 1000, 3)} mm`);
        if (e.type === 'force') {
          const r = e.f / fn, X = xst / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);
          L('Razão de frequências', `r = f / fn = ${f(e.f)} / ${f(fn, 4)}`, f(r, 3));
          L('Amplitude em regime', 'X = Xst / √((1 − r²)² + (2ζr)²)', Number.isFinite(X) ? `${f(X * 1000, 3)} mm` : '∞ (ressonância sem amortecimento)');
          out.notes.push(Math.abs(r - 1) < 0.1 ? 'r ≈ 1: ressonância. A amplitude é limitada só pelo amortecimento.'
            : r < 1 ? 'r < 1: a massa acompanha a força quase em fase.' : 'r > 1: acima da ressonância, a massa responde pouco e em oposição de fase.');
        } else out.notes.push(`A frequência da força sobe de ${f(e.f)} a ${f(e.f1)} Hz em ${f(e.T)} s. Observe a amplitude crescer ao passar por fn = ${f(fn, 4)} Hz.`);
      }
      if (e.type === 'base') {
        const r = e.f / fn;
        const TR = Math.sqrt((1 + (2 * z * r) ** 2) / ((1 - r * r) ** 2 + (2 * z * r) ** 2));
        L('Razão de frequências', `r = f / fn = ${f(e.f)} / ${f(fn, 4)}`, f(r, 3));
        L('Transmissibilidade', 'TR = √((1 + (2ζr)²) / ((1 − r²)² + (2ζr)²))', f(TR, 3));
        L('Amplitude da massa', `X = TR · A = ${f(TR, 3)} · ${f(e.amp * 1000)} mm`, `${f(TR * e.amp * 1000, 3)} mm`);
        out.notes.push(r < Math.SQRT2 ? 'r < √2: a massa se move mais que a base (amplificação).' : 'r > √2: a massa se move menos que a base (isolamento).');
      }
      return out;
    }
    out.notes.push(`${n} massas → ${n} graus de liberdade → ${n} modos de vibrar, cada um com sua frequência natural. Equação do movimento: M·ẍ + C·ẋ + K·x = F(t).`);
    if (n <= 5) out.matrices = { M, K, C: C.some(r => r.some(v => v)) ? C : null };
    const an = Vib.app && Vib.app.modal && Vib.app.modal.an;
    if (an) {
      an.modes.filter(m => m.kind === 'elastic').slice(0, 6).forEach((m, i) => L(i === 0 ? 'Frequências naturais' : '', `f${i + 1}`, `${f(m.f, 4)} Hz`));
    }
    const e = c.excite;
    if (e.type === 'force') out.notes.push(`Força em m${e.mass + 1} com f = ${f(e.f)} Hz. Há ressonância sempre que f se aproxima de uma das frequências naturais.`);
    if (e.type === 'initial') out.notes.push(`Só m${e.mass + 1} é deslocada no início: a resposta mistura os modos. Na aba Modos, “Excitar” solta o sistema num modo só.`);
    if (e.type === 'base') out.notes.push(`A base vibra com A = ${f(e.amp * 1000)} mm e f = ${f(e.f)} Hz e arrasta a cadeia pelas ligações.`);
    return out;
  }

  Vib.chain = { defaults, normalize, signature, build, update, sync, matrices, explain, link };
})(typeof window !== 'undefined' ? window : globalThis);
