/* Aplicação: estado, modos Montar/Ensaiar, bandeja de peças, ligações pela
 * alça ⊕, barra de ações, animações, laço principal, histórico e arquivos. */
(function () {
  'use strict';
  const V = window.Vib;
  const R = V.render;
  const $ = s => document.querySelector(s);
  const STORE = 'bancada-vibracoes:v1';
  const LINK_NAME = { spring: 'mola', damper: 'amortecedor', kc: 'mola + amortecedor' };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = $('#scene');
  const ctx = canvas.getContext('2d');
  const stage = $('#stage');
  const view = new R.View();
  R.readTheme();

  const app = V.app = {
    scene: null,
    engine: null,
    view,
    mode: 'test',            // 'build' (prancheta) | 'test' (ensaio)
    linkType: 'spring',      // peça usada nas ligações pela alça ⊕
    placing: null,           // 'mass' | 'anchor' enquanto se colocam peças com cliques
    linkFrom: null,          // id do nó de origem ao ligar por cliques
    autoLink: true,
    selection: null,
    hover: null,
    running: false,
    timeScale: 1,
    snap: true,
    labels: true,
    trailOn: true,
    trail: [],
    defaults: { m: 1, k: 100, c: 2 },
    history: [],
    future: [],
    snapshot: null,
    modal: { an: null, eq: null, eqMap: null, Veq: null, msg: '', bad: false, stamp: 0 },
    ghost: null,
    appear: new Map(),       // id → instante de criação (animação de entrada)
    dying: [],               // peças excluídas em animação de saída
    ripples: [],             // ondas de confirmação
    cursor: null,            // posição do ponteiro sobre a prancheta (px)
  };

  /* ---------- utilidades ---------- */
  let offsetsCache = { version: -1, map: new Map() };
  function offsets() {
    if (offsetsCache.version !== app.scene.version) offsetsCache = { version: app.scene.version, map: R.elementOffsets(app.scene) };
    return offsetsCache.map;
  }
  const snapW = v => (app.snap ? Math.round(v / 0.05) * 0.05 : v);

  let toastTimer = null;
  function toast(msg, ms = 3800) {
    const el = $('#hint');
    el.textContent = msg;
    el.dataset.toast = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { delete el.dataset.toast; hintTxt = ''; updateHint(); }, ms);
  }

  /* ---------- histórico ---------- */
  app.pushHistory = function () {
    app.history.push(JSON.stringify(app.scene.serialize()));
    if (app.history.length > 100) app.history.shift();
    app.future.length = 0;
    updateUndo();
  };
  let lastEdit = 0;
  app.beginEdit = function () {
    const now = performance.now();
    if (now - lastEdit > 700) app.pushHistory();
    lastEdit = now;
  };
  function restore(json) {
    const s = V.Scene.deserialize(JSON.parse(json));
    const sel = app.selection;
    loadScene(s, { fit: false, keepRunning: true });
    if (sel && s.get(sel.id)) app.selection = sel;
    V.inspector.render();
  }
  function undo() {
    if (!app.history.length) return;
    app.future.push(JSON.stringify(app.scene.serialize()));
    restore(app.history.pop());
    updateUndo();
  }
  function redo() {
    if (!app.future.length) return;
    app.history.push(JSON.stringify(app.scene.serialize()));
    restore(app.future.pop());
    updateUndo();
  }
  function updateUndo() {
    $('#btnUndo').disabled = !app.history.length;
    $('#btnRedo').disabled = !app.future.length;
  }

  /* ---------- alterações e análise ---------- */
  let anTimer = null;
  let applyingChain = false;
  app.changed = function (structural) {
    if (structural && !applyingChain && app.scene.chain) dropChain();
    app.scene.touch(!!structural);
    clearTimeout(anTimer);
    anTimer = setTimeout(runAnalysis, 140);
    dirty = true;
  };

  function runAnalysis() {
    const s = app.scene, M = app.modal;
    const nf = s.freeDofCount();
    M.bad = false;
    M.stamp++;
    if (nf > 500) {
      M.an = null; M.eqMap = null; M.Veq = null;
      M.msg = `Sistema com ${nf} GDL: a análise automática é limitada a 500 GDL.`;
      V.inspector.renderModal();
      return;
    }
    try {
      const eq = V.analysis.equilibrium(s);
      const P = eq.ok ? eq.P : V.analysis.positions(s);
      const an = V.analysis.modal(s, P);
      M.eq = eq; M.an = an;
      M.eqMap = new Map(s.nodes.map((n, i) => [n.id, { x: P[2 * i], y: P[2 * i + 1] }]));
      M.Veq = eq.ok ? V.analysis.potential(s, P) : null;
      if (!nf) M.msg = '';
      else if (eq.ok) M.msg = `Linearizada no equilíbrio estático (Newton: ${eq.iters} ${eq.iters === 1 ? 'iteração' : 'iterações'}).`;
      else { M.msg = `Sem equilíbrio estático: ${eq.reason}. Linearizada na posição atual.`; M.bad = true; }
      if (an.modes.some(m => m.kind === 'unstable')) { M.msg += ' Há modos instáveis (rigidez negativa).'; M.bad = true; }
      if (app.ghost && !an.modes[app.ghost.r]) app.ghost = null;
    } catch (err) {
      M.an = null; M.eqMap = null; M.Veq = null; M.bad = true;
      M.msg = 'Falha na análise: ' + err.message;
    }
    V.inspector.renderModal();
    V.inspector.refreshExplain();
  }

  /* ---------- montador em cadeia ---------- */
  function dropChain() {
    const s = app.scene;
    s.chain = null;
    if (s.meta) { s.meta.chain = null; s.meta.chainIds = null; }
    setTimeout(() => V.inspector.render(), 0);
  }

  /* Monta a cena a partir da configuração do montador. */
  app.loadChain = function (cfg, o = {}) {
    const c = V.chain.normalize(cfg);
    const { scene: s, perturb } = V.chain.build(c);
    s.meta = Object.assign({}, o.meta || {}, { chain: c, chainIds: s.chain.ids });
    if (!o.meta) s.meta.title = null;
    const eq = V.analysis.equilibrium(s);
    if (eq.ok) s.nodes.forEach((n, i) => { if (!n.fixed) { n.x = eq.P[2 * i]; n.y = eq.P[2 * i + 1]; } });
    if (perturb) perturb(s);
    const wasRunning = app.running;
    loadScene(s, { instant: o.instant, keepTab: true });
    if (o.select !== undefined) $('#selPreset').value = o.select;
    setRunning(o.run !== undefined ? o.run : wasRunning);
  };

  /* Edição feita pelo formulário: muda valores no lugar ou reconstrói. */
  app.chainEdit = function (fn, structural) {
    const s = app.scene;
    if (!s.chain) return;
    const cfg = V.chain.normalize(V.chain.sync(s));
    app.beginEdit();
    fn(cfg);
    const c = V.chain.normalize(cfg);
    if (!structural && V.chain.update(s, c)) {
      s.meta.chain = c;
      applyingChain = true;
      app.changed(false);
      applyingChain = false;
      V.inspector.refreshExplain();
      return;
    }
    app.loadChain(c, { meta: s.meta && s.meta.title ? { title: s.meta.title, text: s.meta.text, theory: s.meta.theory, id: s.meta.id } : null });
    V.inspector.render();
  };

  app.newChain = function () {
    app.pushHistory();
    setMode('test');
    app.loadChain(V.chain.defaults(), { select: 'meu', run: true });
    V.inspector.setTab('sys');
  };

  app.simulateFromStart = function () {
    setMode('test');
    reset();
    setRunning(true);
  };

  /* ---------- carga de sistemas ---------- */
  function loadScene(s, o = {}) {
    if (!s.chain && s.meta && s.meta.chain && s.meta.chainIds && s.meta.chainIds.masses.every(id => s.get(id))) {
      const cfg = V.chain.normalize(s.meta.chain);
      s.chain = { cfg, ids: s.meta.chainIds, sig: V.chain.signature(cfg) };
    }
    app.scene = s;
    if (!app.engine) app.engine = new V.physics.Engine(s); else app.engine.setScene(s);
    app.engine.onSample = V.dock.onSample;
    app.selection = null;
    app.hover = null;
    app.ghost = null;
    app.trail = [];
    app.snapshot = null;
    app.linkFrom = null;
    app.placing = null;
    app.appear.clear();
    app.dying = [];
    knob = null;
    updateTray();
    if (!o.keepRunning) setRunning(false);
    if (o.fit !== false) fitView(view.W > 1 && !o.instant);
    runAnalysis();
    const first = s.nodes.find(n => !n.fixed && n.force) || s.nodes.find(n => !n.fixed);
    V.dock.observe(null);
    V.dock.observe(first ? first.id : null);
    V.inspector.render();
    if (!o.keepTab) V.inspector.setTab('sys');
    dirty = true;
  }

  function loadPreset(id, o = {}) {
    const p = V.presets.find(q => q.id === id);
    if (!p) return;
    if (app.scene && !o.initial) app.pushHistory();
    if (p.chain) {
      setMode('test');
      app.loadChain(p.chain, { meta: { id: p.id, title: p.title, text: p.text, theory: p.theory }, instant: o.initial, run: true });
      setToggle('labels', p.labels !== false);
      $('#selPreset').value = id;
      V.inspector.setTab('sys');
      return;
    }
    const s = p.build();
    s.meta = { id: p.id, title: p.title, text: p.text, theory: p.theory };
    const eq = V.analysis.equilibrium(s);
    if (eq.ok) s.nodes.forEach((n, i) => { if (!n.fixed) { n.x = eq.P[2 * i]; n.y = eq.P[2 * i + 1]; } });
    if (p.perturb) p.perturb(s);
    setToggle('labels', p.labels);
    loadScene(s, { instant: o.initial });
    $('#selPreset').value = id;
    setMode('test');
    setRunning(true);
  }

  /* ---------- simulação ---------- */
  function takeSnapshot() {
    app.snapshot = new Map(app.scene.nodes.map(n => [n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }]));
  }
  function setRunning(on) {
    if (on && app.engine && app.engine.t === 0) takeSnapshot();
    if (on && !app.snapshot) takeSnapshot();
    app.running = on;
    const b = $('#btnPlay');
    b.classList.toggle('running', on);
    $('#playLabel').textContent = on ? 'Pausar' : 'Executar';
    if (!on && app.engine) app.engine.drag = null;
  }
  function resetTime() {
    const e = app.engine;
    e.t = 0; e.Ediss = 0; e.Win = 0; e.nextSample = 0; e.drag = null;
    app.scene.rev++;
    app.trail = [];
    V.dock.clear();
  }
  function reset() {
    const s = app.scene;
    if (app.snapshot) {
      for (const n of s.nodes) {
        const q = app.snapshot.get(n.id);
        if (n.fixed) { n.x = n.x0; n.y = n.y0; n.vx = n.vy = 0; }
        else if (q) { n.x = q.x; n.y = q.y; n.vx = q.vx; n.vy = q.vy; }
      }
    }
    resetTime();
    setRunning(false);
    dirty = true;
  }
  function toEquilibrium() {
    const eq = V.analysis.equilibrium(app.scene);
    if (!eq.ok) { toast('Não há equilíbrio estático: ' + eq.reason + '.'); return; }
    app.pushHistory();
    app.scene.nodes.forEach((n, i) => {
      if (n.fixed) { n.x = n.x0; n.y = n.y0; }
      else { n.x = eq.P[2 * i]; n.y = eq.P[2 * i + 1]; }
      n.vx = n.vy = 0;
    });
    resetTime();
    setRunning(false);
    takeSnapshot();
    toast('Massas no equilíbrio estático, em repouso. Arraste uma massa para dar a condição inicial.');
  }

  app.toggleGhost = function (r) {
    app.ghost = app.ghost && app.ghost.r === r ? null : { r, t0: performance.now() };
    V.inspector.renderModal();
  };

  app.exciteMode = function (r) {
    const M = app.modal, m = M.an && M.an.modes[r];
    if (!m || !M.eqMap) return;
    app.pushHistory();
    let Lc = 0, c = 0;
    for (const e of app.scene.elements) { Lc += app.scene.elementLength(e); c++; }
    const amp = Math.min(0.12, 0.25 * (c ? Lc / c : 0.5));
    app.scene.nodes.forEach((n, i) => {
      const q = M.eqMap.get(n.id);
      if (n.fixed) { n.x = n.x0; n.y = n.y0; }
      else { n.x = q.x + amp * m.shape[2 * i]; n.y = q.y + amp * m.shape[2 * i + 1]; }
      n.vx = n.vy = 0;
    });
    app.ghost = null;
    resetTime();
    takeSnapshot();
    setRunning(true);
    V.inspector.renderModal();
    toast(`Sistema solto na forma do modo ${r + 1} (${V.fmt(m.f, 4)} Hz). Sem outras excitações, só esse modo responde.`);
  };
  /* ---------- modos ---------- */
  function setMode(m) {
    if (m === app.mode) return;
    if (m === 'build') {
      if (app.running) setRunning(false);
      if (app.engine.t > 0) reset();
      app.ghost = null;
      V.inspector.renderModal();
    } else {
      app.placing = null;
      app.linkFrom = null;
    }
    app.mode = m;
    stage.dataset.mode = m;
    $('#chipEdit').hidden = m !== 'build';
    if (m === 'build' && app.scene.chain) {
      dropChain();
      toast('Desenho livre: arraste peças da bandeja e ligue nós puxando o ⊕. O montador em cadeia não controla mais este sistema.', 6000);
    }
    updateTray();
    V.inspector.render();
    dirty = true;
  }
  app.setMode = m => setMode(m);

  function updateTray() {
    document.querySelectorAll('.part').forEach(b => {
      b.classList.toggle('armed', b.dataset.part === app.placing);
      b.classList.toggle('current', b.dataset.part === app.linkType);
    });
  }

  /* ---------- seleção ---------- */
  app.select = function (sel, o = {}) {
    app.selection = sel;
    app.trail = [];
    if (sel && sel.kind === 'node') {
      const n = app.scene.get(sel.id);
      if (n && !n.fixed) V.dock.observe(n.id);
    }
    V.inspector.render(o.follow !== false);
    pillKey = '';
    dirty = true;
  };

  app.deleteSelection = function () {
    const sel = app.selection;
    if (!sel) return;
    app.pushHistory();
    const s = app.scene, now = performance.now();
    if (sel.kind === 'node') {
      const n = s.get(sel.id);
      if (n) {
        for (const e of s.attached(n.id)) dyingElement(e, now);
        app.dying.push({ type: 'node', x: n.x, y: n.y, s: R.massSize(n, view), fixed: n.fixed, t0: now });
      }
      removeNode(sel.id);
    } else {
      const e = s.get(sel.id);
      if (e) dyingElement(e, now);
      s.removeElement(sel.id);
    }
    if (app.linkFrom === sel.id) app.linkFrom = null;
    app.selection = null;
    app.changed(true);
    V.inspector.render(true);
  };
  function dyingElement(e, now) {
    const a = app.scene.get(e.a), b = app.scene.get(e.b);
    if (a && b) app.dying.push({ type: 'element', ax: a.x, ay: a.y, bx: b.x, by: b.y, t0: now });
  }

  function removeNode(id) {
    app.scene.removeNode(id);
    if (app.snapshot) app.snapshot.delete(id);
    if (V.dock.rec.id === id) {
      const f = app.scene.nodes.find(n => !n.fixed);
      V.dock.observe(f ? f.id : null);
    }
  }

  /* ---------- construção ---------- */
  function spawnNode(kind, x, y) {
    const n = app.scene.addNode(snapW(x), snapW(y), kind === 'anchor' ? { fixed: true } : { m: app.defaults.m });
    if (app.snapshot) app.snapshot.set(n.id, { x: n.x, y: n.y, vx: 0, vy: 0 });
    app.appear.set(n.id, performance.now());
    app.ripples.push({ x: n.x, y: n.y, t0: performance.now() });
    return n;
  }

  function linkNodes(type, a, b) {
    const s = app.scene, d = app.defaults, now = performance.now();
    const made = [];
    if (type === 'spring' || type === 'kc') made.push(s.addElement('spring', a, b, { k: d.k }));
    if (type === 'damper' || type === 'kc') made.push(s.addElement('damper', a, b, { c: d.c }));
    made.forEach(e => e && app.appear.set(e.id, now));
    return type === 'damper' ? made[made.length - 1] : made[0];
  }

  function nearestNode(px, py, maxPx, exclude) {
    let best = null, bd = maxPx;
    for (const n of app.scene.nodes) {
      if (n.id === exclude) continue;
      const d = Math.hypot(view.sx(n.x) - px, view.sy(n.y) - py);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /* Par de nós cujo segmento passa perto do ponteiro: onde uma ligação solta "se encaixa". */
  function findGap(px, py) {
    const nodes = app.scene.nodes.slice().sort((p, q) =>
      Math.hypot(view.sx(p.x) - px, view.sy(p.y) - py) - Math.hypot(view.sx(q.x) - px, view.sy(q.y) - py)).slice(0, 14);
    let best = null, bd = 46;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const ax = view.sx(a.x), ay = view.sy(a.y), bx = view.sx(b.x), by = view.sy(b.y);
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (L2 < 900) continue;
      const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2;
      if (t < 0.12 || t > 0.88) continue;
      const d = Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
      const same = app.scene.elements.some(e => ((e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id)));
      const score = d + (same ? 14 : 0);
      if (score < bd) { bd = score; best = { a, b }; }
    }
    return best;
  }

  function finishLink(fromId, p) {
    const s = app.scene;
    const t = R.hitNode(s, view, p.x, p.y);
    let target = t && t.id !== fromId ? t : null;
    if (!target) target = spawnNode('mass', view.wx(p.x), view.wy(p.y));
    const el = linkNodes(app.linkType, fromId, target.id);
    app.ripples.push({ x: target.x, y: target.y, t0: performance.now() });
    app.changed(true);
    if (el) app.select({ kind: 'element', id: el.id });
    return el;
  }

  /* Soltar uma peça da bandeja na prancheta. */
  function dropPart(part, p) {
    const s = app.scene;
    app.pushHistory();
    if (part === 'mass' || part === 'anchor') {
      const near = app.autoLink ? nearestNode(p.x, p.y, 170) : null;
      const n = spawnNode(part, view.wx(p.x), view.wy(p.y));
      if (near) linkNodes(app.linkType, near.id, n.id);
      app.changed(true);
      app.select({ kind: 'node', id: n.id });
      return;
    }
    app.linkType = part;
    updateTray();
    const gap = findGap(p.x, p.y);
    if (gap) {
      const el = linkNodes(part, gap.a.id, gap.b.id);
      app.ripples.push({ x: (gap.a.x + gap.b.x) / 2, y: (gap.a.y + gap.b.y) / 2, t0: performance.now() });
      app.changed(true);
      if (el) app.select({ kind: 'element', id: el.id });
      return;
    }
    const near = nearestNode(p.x, p.y, 220);
    if (near) { finishLink(near.id, p); return; }
    app.history.pop();
    updateUndo();
    toast('Solte a ligação entre dois nós, ou perto de um nó para estender a cadeia.');
    void s;
  }

  /* ---------- dicas ---------- */
  let hintTxt = '';
  function updateHint() {
    const el = $('#hint');
    if (el.dataset.toast) return;
    const lt = LINK_NAME[app.linkType];
    let h;
    if (tray && tray.active) {
      h = tray.part === 'mass' || tray.part === 'anchor'
        ? `Solte para colocar ${tray.part === 'mass' ? 'a massa' : 'o apoio'}.${app.autoLink ? ` Perto de um nó, já entra ligado por ${lt}.` : ''}`
        : 'Solte <b>entre dois nós</b> para inserir a peça, ou perto de um nó para estender a cadeia.';
    } else if (ptr && ptr.mode === 'connect') h = `Solte sobre um nó para ligar com ${lt}, ou no vazio para criar uma massa nova.`;
    else if (app.linkFrom) h = `Clique no nó de destino da <b>${lt}</b>, ou no vazio para criar uma massa ligada. <b>Esc</b> cancela.`;
    else if (app.placing) h = `Clique para colocar ${app.placing === 'mass' ? 'massas' : 'apoios'}. <b>Esc</b> termina.`;
    else if (app.mode === 'build') h = `Desenho livre: arraste peças da bandeja · puxe o <b>⊕</b> de um nó para ligar (${lt}) · duplo clique cria massa.`;
    else if (app.running) h = 'Puxe uma massa com o mouse e solte para ver a vibração.';
    else if (app.engine.t === 0) h = 'Monte o sistema no painel <b>Montar</b> e clique em <b>Executar</b>.';
    else h = 'Pausado. <b>Executar</b> continua; <b>↺</b> volta ao início.';
    if (h !== hintTxt) { hintTxt = h; el.innerHTML = h; }
  }

  function setToggle(name, on) {
    const map = { snap: '#tgSnap', labels: '#tgLabels', trail: '#tgTrail' };
    if (name === 'snap') app.snap = on;
    if (name === 'labels') app.labels = on;
    if (name === 'trail') { app.trailOn = on; app.trail = []; }
    $(map[name]).setAttribute('aria-pressed', String(on));
    dirty = true;
  }

  /* ---------- ponteiro na prancheta ---------- */
  const pointers = new Map();
  let ptr = null;
  let knob = null;          // { id, hot }
  let spaceHeld = false;

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    app.cursor = p;
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      endPtr(true);
      const [a, b] = [...pointers.values()];
      ptr = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 1 || e.button === 2 || spaceHeld) { ptr = { mode: 'pan', x: p.x, y: p.y, x0: p.x, y0: p.y }; return; }
    viewAnim = null;

    const s = app.scene;
    const n = R.hitNode(s, view, p.x, p.y);
    const el = n ? null : R.hitElement(s, view, p.x, p.y, offsets());

    if (app.mode === 'build') {
      if (app.linkFrom) {
        const from = app.linkFrom;
        app.linkFrom = null;
        if (n && n.id === from) { dirty = true; return; }
        app.pushHistory();
        finishLink(from, p);
        return;
      }
      if (knob && knob.hot) {
        const kn = s.get(knob.id);
        if (kn) { ptr = { mode: 'connect', start: kn.id, x0: p.x, y0: p.y, x: p.x, y: p.y, target: null }; return; }
      }
      if (app.placing) {
        if (n) app.select({ kind: 'node', id: n.id });
        else {
          app.pushHistory();
          const nn = spawnNode(app.placing, view.wx(p.x), view.wy(p.y));
          app.changed(true);
          app.select({ kind: 'node', id: nn.id });
        }
        return;
      }
      if (n) {
        app.select({ kind: 'node', id: n.id });
        ptr = { mode: 'edit', id: n.id, ox: n.x - view.wx(p.x), oy: n.y - view.wy(p.y), x0: p.x, y0: p.y, moved: false };
      } else if (el) {
        app.select({ kind: 'element', id: el.id });
        ptr = { mode: 'pan', x: p.x, y: p.y, x0: p.x, y0: p.y };
      } else {
        if (app.selection) app.select(null);
        ptr = { mode: 'pan', x: p.x, y: p.y, x0: p.x, y0: p.y };
      }
      return;
    }

    // ensaio: puxar uma massa não tira o painel do montador
    if (n) {
      app.select({ kind: 'node', id: n.id }, { follow: false });
      if (!n.fixed) {
        if (!app.running) app.pushHistory();
        ptr = { mode: 'drag', id: n.id, wx: view.wx(p.x), wy: view.wy(p.y), ox: n.x - view.wx(p.x), oy: n.y - view.wy(p.y) };
        syncDrag();
      }
    } else if (el) {
      app.select({ kind: 'element', id: el.id });
      ptr = { mode: 'pan', x: p.x, y: p.y, x0: p.x, y0: p.y };
    } else {
      if (app.selection) app.select(null);
      ptr = { mode: 'pan', x: p.x, y: p.y, x0: p.x, y0: p.y };
    }
  });

  function updateHover(p) {
    const s = app.scene;
    const n = R.hitNode(s, view, p.x, p.y);
    const el = n ? null : R.hitElement(s, view, p.x, p.y, offsets());
    const h = n || el;
    if ((h && h.id) !== (app.hover && app.hover.id)) { app.hover = h; dirty = true; }
    // alça ⊕: segue o nó sob o ponteiro (ou o selecionado) e continua ativa enquanto o ponteiro vai até ela
    let k = null;
    if (app.mode === 'build' && !app.placing && !app.linkFrom) {
      const keep = knob && s.get(knob.id);
      if (keep && R.hitKnob(keep, view, p.x, p.y)) k = { id: keep.id, hot: true };
      else if (n) k = { id: n.id, hot: false };
      else if (keep && Math.hypot(R.knobPos(keep, view).x - p.x, R.knobPos(keep, view).y - p.y) < 34) k = { id: keep.id, hot: false };
      else if (app.selection && app.selection.kind === 'node' && s.get(app.selection.id)) {
        const sn = s.get(app.selection.id);
        k = { id: sn.id, hot: R.hitKnob(sn, view, p.x, p.y) };
      }
    }
    if (JSON.stringify(k) !== JSON.stringify(knob)) { knob = k; dirty = true; }
    let cur = 'default';
    if (knob && knob.hot) cur = 'crosshair';
    else if (app.placing || app.linkFrom) cur = 'copy';
    else if (n) cur = app.mode === 'build' || !n.fixed ? 'grab' : 'pointer';
    else if (el) cur = 'pointer';
    if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
  }

  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    app.cursor = p;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (!ptr) {
      updateHover(p);
      if (app.placing || app.linkFrom) dirty = true;
      return;
    }
    dirty = true;
    const s = app.scene;
    switch (ptr.mode) {
      case 'pinch': {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        view.cx -= (mx - ptr.mx) / view.scale;
        view.cy += (my - ptr.my) / view.scale;
        view.zoomAt(mx, my, d / (ptr.d || d));
        ptr.d = d; ptr.mx = mx; ptr.my = my;
        break;
      }
      case 'pan':
        view.cx -= (p.x - ptr.x) / view.scale;
        view.cy += (p.y - ptr.y) / view.scale;
        ptr.x = p.x; ptr.y = p.y;
        break;
      case 'drag': {
        ptr.wx = view.wx(p.x); ptr.wy = view.wy(p.y);
        const n = s.get(ptr.id);
        if (!n) { ptr = null; break; }
        if (app.running) syncDrag();
        else {
          if (!n.lockX) n.x = ptr.wx + ptr.ox;
          if (!n.lockY) n.y = ptr.wy + ptr.oy;
          n.vx = n.vy = 0;
          s.rev++;
        }
        break;
      }
      case 'edit': {
        const n = s.get(ptr.id);
        if (!n) { ptr = null; break; }
        if (!ptr.moved) {
          if (Math.hypot(p.x - ptr.x0, p.y - ptr.y0) < 4) break;
          ptr.moved = true;
          app.pushHistory();
        }
        const x = snapW(view.wx(p.x) + ptr.ox), y = snapW(view.wy(p.y) + ptr.oy);
        n.x = x; n.y = y; n.vx = n.vy = 0;
        if (n.fixed) { n.x0 = x; n.y0 = y; }
        for (const el of s.attached(n.id)) el.L0 = s.elementLength(el);
        if (app.snapshot) app.snapshot.set(n.id, { x, y, vx: 0, vy: 0 });
        app.changed(false);
        break;
      }
      case 'connect': {
        ptr.x = p.x; ptr.y = p.y;
        const t = R.hitNode(s, view, p.x, p.y);
        ptr.target = t && t.id !== ptr.start ? t.id : null;
        break;
      }
    }
  });

  function endPtr(cancel, e) {
    if (!ptr) return;
    const p = e ? local(e) : null;
    if (ptr.mode === 'drag') app.engine.drag = null;
    if (ptr.mode === 'connect') {
      const moved = p && Math.hypot(p.x - ptr.x0, p.y - ptr.y0) > 6;
      if (!cancel && moved) {
        app.pushHistory();
        finishLink(ptr.start, p);
      } else if (!cancel) {
        // clique simples na alça: liga por cliques
        app.linkFrom = ptr.start;
        knob = null;
      }
    }
    if (ptr.mode === 'edit' && ptr.moved) V.inspector.render();
    ptr = null;
    pillKey = '';
    dirty = true;
  }

  canvas.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (ptr && ptr.mode === 'pinch') { if (pointers.size < 2) ptr = null; return; }
    endPtr(false, e);
  });
  canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); endPtr(true); });
  canvas.addEventListener('pointerleave', () => {
    if (ptr) return;
    app.cursor = null;
    if (app.hover || knob) { app.hover = null; knob = app.selection && app.mode === 'build' && app.selection.kind === 'node' ? { id: app.selection.id, hot: false } : null; dirty = true; }
  });

  canvas.addEventListener('dblclick', e => {
    if (app.mode !== 'build' || app.placing || app.linkFrom) return;
    const p = local(e);
    if (R.hitNode(app.scene, view, p.x, p.y) || R.hitElement(app.scene, view, p.x, p.y, offsets())) return;
    app.pushHistory();
    const n = spawnNode(e.shiftKey ? 'anchor' : 'mass', view.wx(p.x), view.wy(p.y));
    app.changed(true);
    app.select({ kind: 'node', id: n.id });
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    viewAnim = null;
    const p = local(e);
    view.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    pillKey = '';
    dirty = true;
  }, { passive: false });

  /* A "mão" elástica só existe enquanto a simulação roda. */
  function syncDrag() {
    const e = app.engine;
    if (ptr && ptr.mode === 'drag' && app.running) e.drag = { id: ptr.id, tx: ptr.wx + ptr.ox, ty: ptr.wy + ptr.oy };
    else e.drag = null;
  }

  /* ---------- bandeja: clicar escolhe, arrastar solta na prancheta ---------- */
  let tray = null;          // { part, x0, y0, active, ghost, p }
  document.querySelectorAll('.part').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      tray = { part: btn.dataset.part, btn, x0: e.clientX, y0: e.clientY, active: false, ghost: null, p: null };
    });
    btn.addEventListener('pointermove', e => {
      if (!tray || tray.btn !== btn) return;
      if (!tray.active) {
        if (Math.hypot(e.clientX - tray.x0, e.clientY - tray.y0) < 6) return;
        tray.active = true;
        btn.classList.add('dragging');
        app.placing = null;
        app.linkFrom = null;
        if (btn.dataset.part !== 'mass' && btn.dataset.part !== 'anchor') app.linkType = btn.dataset.part;
        updateTray();
        const g = document.createElement('div');
        g.className = 'drag-ghost';
        g.innerHTML = btn.innerHTML;
        document.body.append(g);
        tray.ghost = g;
      }
      tray.ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
      const r = canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      tray.p = inside ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
      tray.ghost.style.opacity = inside ? '0' : '1';
      dirty = true;
    });
    const end = e => {
      if (!tray || tray.btn !== btn) return;
      const t = tray;
      tray = null;
      btn.classList.remove('dragging');
      if (t.ghost) t.ghost.remove();
      if (e.type === 'pointercancel') { dirty = true; return; }
      if (t.active) { if (t.p) dropPart(t.part, t.p); }
      else clickPart(t.part);
      dirty = true;
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickPart(btn.dataset.part); } });
  });

  function clickPart(part) {
    setMode('build');
    if (part === 'mass' || part === 'anchor') {
      app.placing = app.placing === part ? null : part;
      app.linkFrom = null;
    } else {
      app.linkType = part;
      app.placing = null;
      const sel = app.selection && app.selection.kind === 'node' ? app.selection.id : null;
      if (sel) app.linkFrom = sel;
      else toast(`${LINK_NAME[part][0].toUpperCase() + LINK_NAME[part].slice(1)} escolhida. Puxe o ⊕ de um nó ou arraste a peça para entre dois nós.`);
    }
    updateTray();
    dirty = true;
  }

  /* ---------- barra de ações junto da peça selecionada ---------- */
  const pill = $('#selPill');
  let pillKey = '';
  const ICON = {
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 3v11M7 14h10M8 18l-2 3M12 18l-2 3M16 18l-2 3M5 18h14"/></svg>',
    free: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
    lx: '<svg viewBox="0 0 24 24"><path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>',
    ly: '<svg viewBox="0 0 24 24"><path d="M12 3v18M9 6l3-3 3 3M9 18l3 3 3-3"/></svg>',
    swap: '<svg viewBox="0 0 24 24"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/></svg>',
  };
  function pillButtons(item, kind) {
    const s = app.scene;
    if (kind === 'node' && !item.fixed) {
      return [
        ['link', 'Ligar', 'Ligar a outro nó (clique no destino)', false],
        ['pin', 'Fixar', 'Transformar em apoio fixo', false],
        '|',
        ['lx', 'x', item.lockX ? 'Liberar o movimento em x' : 'Travar o movimento em x', !item.lockX, 'livre em x'],
        ['ly', 'y', item.lockY ? 'Liberar o movimento em y' : 'Travar o movimento em y', !item.lockY, 'livre em y'],
        '|',
        ['del', '', 'Excluir (Del)', false],
      ];
    }
    if (kind === 'node') return [['link', 'Ligar', 'Ligar a outro nó', false], ['free', 'Soltar', 'Transformar em massa livre', false], '|', ['del', '', 'Excluir (Del)', false]];
    const other = item.type === 'spring' ? 'amortecedor' : 'mola';
    const hasPar = s.elements.some(e => e !== item && e.type !== item.type && ((e.a === item.a && e.b === item.b) || (e.a === item.b && e.b === item.a)));
    const list = [['swap', `→ ${other}`, `Trocar por ${other}`, false]];
    if (!hasPar) list.push(['plus', other, `Acrescentar ${other} em paralelo`, false]);
    list.push('|', ['del', '', 'Excluir (Del)', false]);
    return list;
  }
  function pillAction(act) {
    const s = app.scene, sel = app.selection;
    if (!sel) return;
    const item = s.get(sel.id);
    if (!item) return;
    if (act === 'del') { app.deleteSelection(); return; }
    if (act === 'link') { setMode('build'); app.linkFrom = item.id; app.placing = null; updateTray(); dirty = true; return; }
    app.pushHistory();
    if (act === 'pin' || act === 'free') { s.setFixed(item, act === 'pin'); app.changed(true); }
    else if (act === 'lx') { item.lockX = !item.lockX; if (item.lockX) item.vx = 0; app.changed(true); }
    else if (act === 'ly') { item.lockY = !item.lockY; if (item.lockY) item.vy = 0; app.changed(true); }
    else if (act === 'swap') {
      const type = item.type === 'spring' ? 'damper' : 'spring';
      s.removeElement(item.id);
      const e = s.addElement(type, item.a, item.b, type === 'spring' ? { k: app.defaults.k, L0: item.L0 } : { c: app.defaults.c, L0: item.L0 });
      app.appear.set(e.id, performance.now());
      app.changed(true);
      app.select({ kind: 'element', id: e.id });
    } else if (act === 'plus') {
      const type = item.type === 'spring' ? 'damper' : 'spring';
      const e = s.addElement(type, item.a, item.b, type === 'spring' ? { k: app.defaults.k, L0: item.L0 } : { c: app.defaults.c, L0: item.L0 });
      app.appear.set(e.id, performance.now());
      app.changed(true);
    }
    V.inspector.render();
    pillKey = '';
  }
  pill.addEventListener('pointerdown', e => e.stopPropagation());
  pill.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b) pillAction(b.dataset.act);
  });

  function updatePill() {
    const sel = app.selection, s = app.scene;
    const item = sel && s.get(sel.id);
    const hide = app.mode !== 'build' || !item || (ptr && ptr.mode !== 'pan') || (tray && tray.active) || app.linkFrom;
    if (hide) { if (!pill.hidden) pill.hidden = true; pillKey = ''; return; }
    const key = sel.id + ':' + (item.fixed ? 1 : 0) + (item.lockX ? 1 : 0) + (item.lockY ? 1 : 0) + ':' + (item.type || '') + ':' + s.version;
    if (key !== pillKey) {
      pillKey = key;
      pill.innerHTML = `<span class="pname">${item.name}</span>` + pillButtons(item, sel.kind).map(b => (b === '|'
        ? '<span class="psep"></span>'
        : `<button type="button" data-act="${b[0]}" title="${b[2]}" aria-label="${b[4] || b[2]}"${b[0] === 'lx' || b[0] === 'ly' ? ` aria-pressed="${b[3]}"` : ''}${b[0] === 'del' ? ' class="danger"' : ''}>${ICON[b[0]]}${b[1] ? `<span>${b[1]}</span>` : ''}</button>`)).join('');
      pill.hidden = false;
    }
    // posição: acima da peça; sem espaço, abaixo
    // posição: primeira candidata que não cobre massas, apoios nem a peça selecionada
    const w = pill.offsetWidth, hgt = pill.offsetHeight;
    const W = view.W, H = view.H;
    const boxes = s.nodes.map(n => {
      const r = n.fixed ? 16 : R.massSize(n, view) / 2 + 20;   // inclui rótulo e alça
      return [view.sx(n.x) - r, view.sy(n.y) - r - 8, 2 * r, 2 * r + 8];
    });
    let cx, cy, rx, ry;
    if (sel.kind === 'node') {
      const r = item.fixed ? 16 : R.massSize(item, view) / 2 + 20;
      cx = view.sx(item.x); cy = view.sy(item.y); rx = r; ry = r + 8;
    } else {
      const a = s.get(item.a), b = s.get(item.b);
      cx = view.sx((a.x + b.x) / 2); cy = view.sy((a.y + b.y) / 2);
      const dx = Math.abs(view.sx(b.x) - view.sx(a.x)), dy = Math.abs(view.sy(b.y) - view.sy(a.y));
      rx = dy > dx ? 22 : 0; ry = dy > dx ? 0 : 22;
    }
    const cands = [
      [cx - w / 2, cy - ry - 10 - hgt], [cx - w / 2, cy + ry + 10],
      [cx + rx + 12, cy - hgt / 2], [cx - rx - 12 - w, cy - hgt / 2],
      [cx - w / 2, cy - ry - 60 - hgt], [cx - w / 2, cy + ry + 60],
    ];
    const hit = (q, o) => q[0] < o[0] + o[2] && o[0] < q[0] + q[2] && q[1] < o[1] + o[3] && o[1] < q[1] + q[3];
    let best = null;
    for (const [x0, y0] of cands) {
      const q = [Math.max(6, Math.min(W - w - 6, x0)), Math.max(6, Math.min(H - hgt - 6, y0)), w, hgt];
      if (!boxes.some(o => hit(q, o))) { best = q; break; }
    }
    if (!best) best = [Math.max(6, Math.min(W - w - 6, cands[0][0])), Math.max(6, Math.min(H - hgt - 6, cands[0][1]))];
    const left = best[0], y = best[1];
    pill.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)`;
  }

  /* ---------- teclado ---------- */
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (!$('#mdlFile').hidden || !$('#mdlHelp').hidden) {
      if (e.key === 'Escape') closeModals();
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (e.repeat) return;
      if (tag === 'BUTTON') e.target.blur();
      play();
      return;
    }
    if (k === 'b') setMode(app.mode === 'build' ? 'test' : 'build');
    else if (app.mode === 'build' && (k === 'm' || k === 'a')) clickPart(k === 'm' ? 'mass' : 'anchor');
    else if (app.mode === 'build' && (k === 'k' || k === 'c' || k === 'p')) { app.linkType = { k: 'spring', c: 'damper', p: 'kc' }[k]; updateTray(); dirty = true; }
    else if (k === 'r') reset();
    else if (k === '.') step();
    else if (k === 'f') fitView(true);
    else if (k === 'g') setToggle('snap', !app.snap);
    else if (k === 'l') setToggle('labels', !app.labels);
    else if (k === 't') setToggle('trail', !app.trailOn);
    else if (k === 'delete' || k === 'backspace') app.deleteSelection();
    else if (k === 'escape') {
      if (app.linkFrom) app.linkFrom = null;
      else if (app.placing) { app.placing = null; updateTray(); }
      else { app.ghost = null; app.select(null); V.inspector.renderModal(); }
      dirty = true;
    } else if (e.key === '?') openModal('#mdlHelp');
  });

  /* ---------- controles ---------- */
  function play() {
    if (app.mode === 'build') { setMode('test'); setRunning(true); return; }
    setRunning(!app.running);
  }
  function step() {
    setMode('test');
    setRunning(false);
    if (app.engine.t === 0) takeSnapshot();
    app.engine.advance(1 / 60);
    dirty = true;
  }

  let viewAnim = null;
  function fitView(animate) {
    const to = view.target(app.scene);
    if (!animate || reduceMotion) { Object.assign(view, to); dirty = true; return; }
    viewAnim = { from: { cx: view.cx, cy: view.cy, scale: view.scale }, to, t0: performance.now(), dur: 480 };
  }

  const sel = $('#selPreset');
  sel.append(new Option('Meu sistema (montador)', 'meu'));
  for (const p of V.presets) sel.append(new Option(p.title, p.id));
  sel.addEventListener('change', () => { if (sel.value === 'meu') app.newChain(); else loadPreset(sel.value); });
  $('#btnPlay').addEventListener('click', play);
  $('#btnGo').addEventListener('click', play);
  $('#btnStep').addEventListener('click', step);
  $('#btnReset').addEventListener('click', reset);
  document.querySelectorAll('#speedSeg button').forEach(b => b.addEventListener('click', () => {
    app.timeScale = +b.dataset.speed;
    document.querySelectorAll('#speedSeg button').forEach(q => q.setAttribute('aria-pressed', String(q === b)));
  }));
  $('#tgAutoLink').addEventListener('change', e => { app.autoLink = e.target.checked; });
  $('#btnEquil').addEventListener('click', toEquilibrium);
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnFit').addEventListener('click', () => fitView(true));
  $('#tgSnap').addEventListener('click', () => setToggle('snap', !app.snap));
  $('#tgLabels').addEventListener('click', () => setToggle('labels', !app.labels));
  $('#tgTrail').addEventListener('click', () => setToggle('trail', !app.trailOn));
  $('#chipGravity').addEventListener('click', () => {
    app.pushHistory();
    app.scene.gravity = !app.scene.gravity;
    app.changed(false);
    V.inspector.render();
  });

  /* ---------- modais ---------- */
  function openModal(id) {
    $(id).hidden = false;
    const f = $(id).querySelector('textarea, button');
    if (f) f.focus();
  }
  function closeModals() { $('#mdlFile').hidden = true; $('#mdlHelp').hidden = true; }
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); });
  });
  $('#btnHelp').addEventListener('click', () => openModal('#mdlHelp'));
  const fileMsg = (txt, cls) => { const m = $('#fileMsg'); m.textContent = txt; m.className = 'msg ' + (cls || ''); };
  $('#btnFile').addEventListener('click', () => {
    $('#fileText').value = JSON.stringify(app.scene.serialize(), null, 1);
    fileMsg('');
    openModal('#mdlFile');
  });
  $('#btnCopyJson').addEventListener('click', () => {
    const ta = $('#fileText');
    const fallback = () => { ta.focus(); ta.select(); fileMsg('Texto selecionado. Use Ctrl+C para copiar.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(() => fileMsg('Copiado para a área de transferência.', 'good'), fallback);
    } else fallback();
  });
  $('#btnDownload').addEventListener('click', () => {
    try {
      const blob = new Blob([$('#fileText').value], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sistema-vibracoes.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      fileMsg('Download iniciado. Se nada acontecer, use Copiar.');
    } catch (err) { fileMsg('Este navegador bloqueou o download. Use Copiar.', 'bad'); }
  });
  $('#fileInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { $('#fileText').value = String(r.result); loadJson(); };
    r.readAsText(f);
    e.target.value = '';
  });
  function loadJson() {
    try {
      const s = V.Scene.deserialize(JSON.parse($('#fileText').value));
      app.pushHistory();
      loadScene(s);
      sel.value = s.meta && s.meta.id ? s.meta.id : sel.value;
      fileMsg(`Carregado: ${s.nodes.length} nós e ${s.elements.length} elementos.`, 'good');
      setTimeout(closeModals, 700);
    } catch (err) {
      fileMsg('Não foi possível carregar: ' + err.message + ' Verifique se o texto é um JSON exportado por esta bancada.', 'bad');
    }
  }
  $('#btnLoadJson').addEventListener('click', loadJson);

  /* ---------- tema ---------- */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => { R.readTheme(); dirty = true; V.dock.draw(true); };
  if (mq.addEventListener) mq.addEventListener('change', onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- tamanho do canvas ---------- */
  let dpr = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const first = view.W <= 1;
    view.W = Math.max(1, r.width);
    view.H = Math.max(1, r.height);
    canvas.width = Math.round(view.W * dpr);
    canvas.height = Math.round(view.H * dpr);
    if (first && app.scene) view.fit(app.scene);
    dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);

  /* ---------- laço principal ---------- */
  let dirty = true, last = performance.now(), lastSave = 0, savedRev = -1;
  const hlv = new Map();       // destaque suave por id (0..1)

  function animate(now) {
    let busy = false;
    if (viewAnim) {
      const k = Math.min(1, (now - viewAnim.t0) / viewAnim.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      const { from, to } = viewAnim;
      view.cx = from.cx + (to.cx - from.cx) * e;
      view.cy = from.cy + (to.cy - from.cy) * e;
      view.scale = from.scale * Math.pow(to.scale / from.scale, e);
      if (k >= 1) viewAnim = null;
      busy = true;
    }
    for (const [id, t0] of app.appear) { if (now - t0 > 420) app.appear.delete(id); else busy = true; }
    app.dying = app.dying.filter(d => now - d.t0 < 240);
    app.ripples = app.ripples.filter(r => now - r.t0 < 520);
    if (app.dying.length || app.ripples.length) busy = true;
    // alvos do destaque
    const target = new Map();
    if (app.hover) target.set(app.hover.id, 0.55);
    if (app.selection) target.set(app.selection.id, 1);
    if (app.linkFrom) target.set(app.linkFrom, 1);
    if (ptr && ptr.mode === 'connect') { target.set(ptr.start, 1); if (ptr.target) target.set(ptr.target, 1); }
    for (const id of new Set([...hlv.keys(), ...target.keys()])) {
      const t = target.get(id) || 0, v = hlv.get(id) || 0;
      const nv = reduceMotion ? t : v + (t - v) * 0.28;
      if (Math.abs(nv - t) < 0.01) { if (t === 0) hlv.delete(id); else hlv.set(id, t); }
      else { hlv.set(id, nv); busy = true; }
    }
    if (knob || app.linkFrom || (tray && tray.active)) busy = true;
    return busy;
  }

  function frame(now) {
    const dtReal = Math.min(0.05, (now - last) / 1000);
    last = now;
    const s = app.scene, e = app.engine;
    syncDrag();
    if (app.running) {
      if (!e.advance(dtReal * app.timeScale)) {
        setRunning(false);
        toast('A integração divergiu e foi interrompida; o último estado válido foi mantido. Reduza rigidezes extremas ou aumente as massas.', 6000);
      }
      if (app.trailOn && app.selection && app.selection.kind === 'node') {
        const n = s.get(app.selection.id);
        if (n && !n.fixed) {
          app.trail.push([n.x, n.y]);
          if (app.trail.length > 150) app.trail.shift();
        }
      }
      dirty = true;
    } else if (s.nodes.some(n => n.fixed && n.base && n.base.A)) {
      // apoios com excitação: ficam na posição do instante atual
      e.ensure(); e.pack(); e.unpack();
    }
    if (app.ghost) dirty = true;
    if (animate(now)) dirty = true;

    if (dirty) {
      draw(now);
      dirty = false;
    }
    hud();
    updateHint();
    updatePill();
    V.dock.draw();
    V.inspector.liveUpdate();
    if (now - lastSave > 2000 && savedRev !== s.rev && !app.running) {
      lastSave = now;
      savedRev = s.rev;
      try { localStorage.setItem(STORE, JSON.stringify({ scene: s.serialize(), view: { cx: view.cx, cy: view.cy, scale: view.scale } })); } catch (err) { /* armazenamento indisponível */ }
    }
    requestAnimationFrame(frame);
  }

  function ghostPositions(now) {
    const M = app.modal, g = app.ghost;
    if (!g || !M.an || !M.eqMap) return null;
    const m = M.an.modes[g.r];
    if (!m) return null;
    const amp = 46 / view.scale;
    const ph = Math.sin(2 * Math.PI * 0.7 * (now - g.t0) / 1000);
    const out = new Map();
    app.scene.nodes.forEach((n, i) => {
      const q = M.eqMap.get(n.id) || { x: n.x, y: n.y };
      out.set(n.id, { x: q.x + amp * ph * m.shape[2 * i], y: q.y + amp * ph * m.shape[2 * i + 1] });
    });
    return out;
  }

  /* Pré-visualizações do que vai ser criado. */
  function preview() {
    const s = app.scene, out = {};
    const nodeAt = n => ({ x: view.sx(n.x), y: view.sy(n.y) });
    const end = (fromId, p) => {
      const a = s.get(fromId);
      if (!a) return null;
      const A = nodeAt(a);
      const t = R.hitNode(s, view, p.x, p.y);
      const target = t && t.id !== fromId ? t : null;
      const B = target ? nodeAt(target) : p;
      return { ax: A.x, ay: A.y, bx: B.x, by: B.y, type: app.linkType, target: !!target, newMass: !target };
    };
    if (ptr && ptr.mode === 'connect') out.link = end(ptr.start, { x: ptr.x, y: ptr.y });
    else if (app.linkFrom && app.cursor) out.link = end(app.linkFrom, app.cursor);
    else if (tray && tray.active && tray.p) {
      const p = tray.p;
      if (tray.part === 'mass' || tray.part === 'anchor') {
        const x = view.sx(snapW(view.wx(p.x))), y = view.sy(snapW(view.wy(p.y)));
        out.node = { type: tray.part, x, y, s: R.massSize({ m: app.defaults.m }, view) };
        const near = app.autoLink ? nearestNode(p.x, p.y, 170) : null;
        if (near) { const A = nodeAt(near); out.link = { ax: A.x, ay: A.y, bx: x, by: y, type: app.linkType, target: false }; }
      } else {
        const gap = findGap(p.x, p.y);
        if (gap) { const A = nodeAt(gap.a), B = nodeAt(gap.b); out.link = { ax: A.x, ay: A.y, bx: B.x, by: B.y, type: tray.part, target: true, targetA: true }; }
        else {
          const near = nearestNode(p.x, p.y, 220);
          if (near) { const A = nodeAt(near); out.link = { ax: A.x, ay: A.y, bx: p.x, by: p.y, type: tray.part, target: false, newMass: true }; }
        }
      }
    } else if (app.placing && app.cursor && !R.hitNode(s, view, app.cursor.x, app.cursor.y)) {
      const p = app.cursor;
      out.node = { type: app.placing, x: view.sx(snapW(view.wx(p.x))), y: view.sy(snapW(view.wy(p.y))), s: R.massSize({ m: app.defaults.m }, view) };
    }
    return out.link || out.node ? out : null;
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = app.scene;
    let hand = null;
    if (ptr && ptr.mode === 'drag' && app.running) {
      const n = s.get(ptr.id);
      if (n) hand = { x0: view.sx(n.x), y0: view.sy(n.y), x1: view.sx(ptr.wx + ptr.ox), y1: view.sy(ptr.wy + ptr.oy) };
    }
    R.drawScene(ctx, s, view, {
      offsets: offsets(),
      selection: app.selection,
      hover: app.hover,
      labels: app.labels,
      trail: app.trailOn ? app.trail : null,
      ghost: ghostPositions(now),
      hand,
      t: app.engine.t,
      now,
      appear: id => { const t0 = app.appear.get(id); return t0 === undefined || reduceMotion ? 1 : Math.min(1, (now - t0) / 380); },
      hl: id => hlv.get(id) || 0,
      dying: app.dying.map(d => Object.assign({}, d, { f: 1 - (now - d.t0) / 240 })),
      ripples: reduceMotion ? [] : app.ripples.map(r => ({ x: r.x, y: r.y, f: (now - r.t0) / 520 })),
      knob: ptr || (tray && tray.active) ? null : knob,
      preview: preview(),
    });
  }

  function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
  const hudTime = $('#hudTime'), hudRate = $('#hudRate'), chipE = $('#chipEnergy'), chipG = $('#chipGravity'), hudMode = $('#hudMode');
  function hud() {
    const e = app.engine, s = app.scene;
    setText(hudTime, V.fixed(e.t, 3));
    let rate = '';
    if (app.running && e.lastSteps) {
      rate = `h = ${V.fmt(e.lastH * 1000, 2)} ms · ${e.lastSteps} passos/quadro`;
      if (e.limited) rate += ' · desacelerado para manter a precisão';
    } else if (!app.running) rate = e.t === 0 ? 'condição inicial' : 'pausado';
    if (hudRate.textContent !== rate) {
      hudRate.textContent = rate;
      hudRate.classList.toggle('warn', !!(app.running && e.limited));
    }
    const err = e.energyErr;
    const idle = !app.running && e.t === 0;
    const cls = idle ? '' : err < 1e-4 ? 'good' : err < 1e-2 ? 'warn' : 'bad';
    const txt = `balanço ${idle ? '—' : V.fmt(err, 2)}`;
    if (chipE.dataset.txt !== txt) {
      chipE.dataset.txt = txt;
      chipE.className = 'chip ' + cls;
      chipE.innerHTML = '<span class="dot"></span>' + txt;
    }
    setText(chipG, s.gravity ? `g = ${V.fmt(s.g, 3)} m/s²` : 'g desligada');
    chipG.classList.toggle('off', !s.gravity);
    if (app.ghost && app.modal.an && app.modal.an.modes[app.ghost.r]) {
      const m = app.modal.an.modes[app.ghost.r];
      hudMode.hidden = false;
      setText(hudMode, `modo ${app.ghost.r + 1} · ${m.kind === 'elastic' ? V.fmt(m.f, 4) + ' Hz' : 'corpo rígido'}`);
    } else hudMode.hidden = true;
  }

  /* ---------- início ---------- */
  V.dock.init();
  updateUndo();
  updateTray();
  let restored = false;
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const o = JSON.parse(raw);
      const s = V.Scene.deserialize(o.scene);
      if (s.nodes.length) {
        loadScene(s, { fit: !o.view });
        if (o.view) Object.assign(view, o.view);
        if (s.meta && s.meta.id) sel.value = s.meta.id;
        setToggle('labels', s.elements.length <= 14);
        restored = true;
        toast('Sistema da última sessão restaurado. Escolha outro em “Sistema” para recomeçar.');
      }
    }
  } catch (err) { restored = false; }
  if (!restored) app.loadChain(V.chain.defaults(), { instant: true, run: true, select: 'meu' });
  resize();
  requestAnimationFrame(t => { last = t; frame(t); });
})();
