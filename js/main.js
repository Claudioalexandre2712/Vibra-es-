/* Aplicação: estado, ferramentas de montagem, interação por ponteiro,
 * laço de animação, histórico, arquivos e salvamento automático. */
(function () {
  'use strict';
  const V = window.Vib;
  const R = V.render;
  const $ = s => document.querySelector(s);
  const STORE = 'bancada-vibracoes:v1';

  const canvas = $('#scene');
  const ctx = canvas.getContext('2d');
  const view = new R.View();
  R.readTheme();

  const app = V.app = {
    scene: null,
    engine: null,
    view,
    tool: 'interact',
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
    toastTimer = setTimeout(() => { delete el.dataset.toast; updateHint(); }, ms);
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
  app.changed = function (structural) {
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
  }

  /* ---------- carga de sistemas ---------- */
  function loadScene(s, o = {}) {
    app.scene = s;
    if (!app.engine) app.engine = new V.physics.Engine(s); else app.engine.setScene(s);
    app.engine.onSample = V.dock.onSample;
    app.selection = null;
    app.hover = null;
    app.ghost = null;
    app.trail = [];
    app.snapshot = null;
    if (!o.keepRunning) setRunning(false);
    if (o.fit !== false) view.fit(s);
    runAnalysis();
    const first = s.nodes.find(n => !n.fixed && n.force) || s.nodes.find(n => !n.fixed);
    V.dock.observe(null);
    V.dock.observe(first ? first.id : null);
    V.inspector.render();
    V.inspector.setTab('sys');
    dirty = true;
  }

  function loadPreset(id, o = {}) {
    const p = V.presets.find(q => q.id === id);
    if (!p) return;
    if (app.scene && !o.initial) app.pushHistory();
    const s = p.build();
    s.meta = { id: p.id, title: p.title, text: p.text, theory: p.theory };
    const eq = V.analysis.equilibrium(s);
    if (eq.ok) s.nodes.forEach((n, i) => { if (!n.fixed) { n.x = eq.P[2 * i]; n.y = eq.P[2 * i + 1]; } });
    if (p.perturb) p.perturb(s);
    setToggle('labels', p.labels);
    loadScene(s);
    $('#selPreset').value = id;
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

  /* ---------- seleção e edição ---------- */
  app.select = function (sel) {
    app.selection = sel;
    app.trail = [];
    if (sel && sel.kind === 'node') {
      const n = app.scene.get(sel.id);
      if (n && !n.fixed) V.dock.observe(n.id);
    }
    V.inspector.render(true);
    dirty = true;
  };

  app.deleteSelection = function () {
    const sel = app.selection;
    if (!sel) return;
    app.pushHistory();
    if (sel.kind === 'node') removeNode(sel.id); else app.scene.removeElement(sel.id);
    app.selection = null;
    app.changed(true);
    V.inspector.render();
  };

  function removeNode(id) {
    app.scene.removeNode(id);
    if (app.snapshot) app.snapshot.delete(id);
    if (V.dock.rec.id === id) {
      const f = app.scene.nodes.find(n => !n.fixed);
      V.dock.observe(f ? f.id : null);
    }
  }

  function addNode(kind, x, y) {
    const n = app.scene.addNode(snapW(x), snapW(y), kind === 'anchor' ? { fixed: true } : { m: app.defaults.m });
    if (app.snapshot) app.snapshot.set(n.id, { x: n.x, y: n.y, vx: 0, vy: 0 });
    return n;
  }

  function connect(tool, a, b) {
    const s = app.scene, d = app.defaults;
    let last = null;
    if (tool === 'spring' || tool === 'kc') last = s.addElement('spring', a, b, { k: d.k });
    if (tool === 'damper' || tool === 'kc') { const e = s.addElement('damper', a, b, { c: d.c }); if (tool === 'damper') last = e; }
    return last;
  }

  /* ---------- ferramentas ---------- */
  const HINTS = {
    interact: 'Arraste uma massa para puxá-la e solte. Pausado, o arraste define o deslocamento inicial. Arraste o fundo para mover a vista.',
    edit: 'Arraste nós para mudar a geometria; o comprimento natural das molas ligadas é atualizado (sem tensão).',
    mass: () => `Clique para criar uma massa de ${V.fmt(app.defaults.m)} kg.`,
    anchor: 'Clique para criar um apoio fixo. Selecione-o para definir uma excitação de base.',
    spring: () => `Arraste de um nó a outro para ligar uma mola de ${V.fmt(app.defaults.k)} N/m. Soltar no vazio cria uma massa.`,
    damper: () => `Arraste de um nó a outro para ligar um amortecedor de ${V.fmt(app.defaults.c)} N·s/m.`,
    kc: 'Arraste de um nó a outro para ligar mola e amortecedor em paralelo.',
    delete: 'Clique em um nó ou elemento para excluí-lo.',
  };
  function updateHint() {
    const el = $('#hint');
    if (el.dataset.toast) return;
    const h = HINTS[app.tool];
    el.textContent = typeof h === 'function' ? h() : h;
  }
  function setTool(t) {
    app.tool = t;
    document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    canvas.style.cursor = t === 'interact' || t === 'edit' ? 'default' : 'crosshair';
    updateHint();
  }
  function setToggle(name, on) {
    const map = { snap: '#tgSnap', labels: '#tgLabels', trail: '#tgTrail' };
    if (name === 'snap') app.snap = on;
    if (name === 'labels') app.labels = on;
    if (name === 'trail') { app.trailOn = on; app.trail = []; }
    $(map[name]).setAttribute('aria-pressed', String(on));
    dirty = true;
  }

  /* ---------- ponteiro ---------- */
  const pointers = new Map();
  let ptr = null;
  let spaceHeld = false;

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      endPtr(true);
      const [a, b] = [...pointers.values()];
      ptr = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 1 || e.button === 2 || spaceHeld) { ptr = { mode: 'pan', x: p.x, y: p.y, x0: p.x, y0: p.y }; return; }

    const s = app.scene, tool = app.tool;
    const n = R.hitNode(s, view, p.x, p.y);
    const el = n ? null : R.hitElement(s, view, p.x, p.y, offsets());

    if (tool === 'delete') {
      if (n) { app.select({ kind: 'node', id: n.id }); app.deleteSelection(); }
      else if (el) { app.select({ kind: 'element', id: el.id }); app.deleteSelection(); }
      else ptr = { mode: 'pan', x: p.x, y: p.y, x0: p.x, y0: p.y };
      return;
    }

    if (tool === 'spring' || tool === 'damper' || tool === 'kc') {
      app.pushHistory();
      let start = n, created = false;
      if (!start) {
        start = addNode('mass', view.wx(p.x), view.wy(p.y));
        created = true;
        app.changed(true);
      }
      ptr = { mode: 'connect', start: start.id, created, x0: p.x, y0: p.y, x: p.x, y: p.y, target: null };
      return;
    }

    if (tool === 'mass' || tool === 'anchor') {
      if (n) { app.select({ kind: 'node', id: n.id }); ptr = { mode: 'pan', x: p.x, y: p.y, x0: p.x, y0: p.y }; }
      else ptr = { mode: 'pending', x: p.x, y: p.y, x0: p.x, y0: p.y };
      return;
    }

    // interagir / geometria
    if (n) {
      app.select({ kind: 'node', id: n.id });
      if (tool === 'edit') {
        app.pushHistory();
        ptr = { mode: 'edit', id: n.id, ox: n.x - view.wx(p.x), oy: n.y - view.wy(p.y) };
      } else if (!n.fixed) {
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

  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (!ptr) {
      const n = R.hitNode(app.scene, view, p.x, p.y);
      const el = n ? null : R.hitElement(app.scene, view, p.x, p.y, offsets());
      const h = n || el;
      if ((h && h.id) !== (app.hover && app.hover.id)) { app.hover = h; dirty = true; }
      if (app.tool === 'interact' || app.tool === 'edit') canvas.style.cursor = h ? (n && (!n.fixed || app.tool === 'edit') ? 'grab' : 'pointer') : 'default';
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
      case 'pending':
        if (Math.hypot(p.x - ptr.x0, p.y - ptr.y0) > 5) ptr.mode = 'pan';
      // falls through
      case 'pan':
        if (ptr.mode !== 'pan') break;
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
    const s = app.scene;
    const p = e ? local(e) : null;
    if (ptr.mode === 'drag') { app.engine.drag = null; }
    if (!cancel && ptr.mode === 'pending' && p) {
      app.pushHistory();
      const n = addNode(app.tool === 'anchor' ? 'anchor' : 'mass', view.wx(p.x), view.wy(p.y));
      app.changed(true);
      app.select({ kind: 'node', id: n.id });
    }
    if (ptr.mode === 'connect') {
      const moved = p && Math.hypot(p.x - ptr.x0, p.y - ptr.y0) > 6;
      if (cancel || !moved) {
        if (ptr.created) app.select({ kind: 'node', id: ptr.start });
        else { app.history.pop(); updateUndo(); app.select({ kind: 'node', id: ptr.start }); }
      } else {
        let target = ptr.target;
        if (!target) target = addNode('mass', view.wx(p.x), view.wy(p.y)).id;
        const el = connect(app.tool, ptr.start, target);
        app.changed(true);
        if (el) app.select({ kind: 'element', id: el.id });
      }
    }
    if (ptr.mode === 'edit') V.inspector.render();
    ptr = null;
    dirty = true;
  }

  canvas.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (ptr && ptr.mode === 'pinch') { if (pointers.size < 2) ptr = null; return; }
    endPtr(false, e);
  });
  canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); endPtr(true); });
  canvas.addEventListener('pointerleave', () => { if (!ptr && app.hover) { app.hover = null; dirty = true; } });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = local(e);
    view.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    dirty = true;
  }, { passive: false });

  /* A "mão" elástica só existe enquanto a simulação roda. */
  function syncDrag() {
    const e = app.engine;
    if (ptr && ptr.mode === 'drag' && app.running) e.drag = { id: ptr.id, tx: ptr.wx + ptr.ox, ty: ptr.wy + ptr.oy };
    else e.drag = null;
  }

  /* ---------- teclado ---------- */
  const TOOL_KEYS = { i: 'interact', e: 'edit', m: 'mass', a: 'anchor', k: 'spring', c: 'damper', p: 'kc', x: 'delete' };
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
      setRunning(!app.running);
      return;
    }
    if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
    if (k === 'r') reset();
    else if (k === '.') step();
    else if (k === 'f') { view.fit(app.scene); dirty = true; }
    else if (k === 'g') setToggle('snap', !app.snap);
    else if (k === 'l') setToggle('labels', !app.labels);
    else if (k === 't') setToggle('trail', !app.trailOn);
    else if (k === 'delete' || k === 'backspace') app.deleteSelection();
    else if (k === 'escape') { app.ghost = null; app.select(null); V.inspector.renderModal(); }
    else if (e.key === '?') openModal('#mdlHelp');
  });

  /* ---------- barra superior ---------- */
  function step() {
    setRunning(false);
    if (app.engine.t === 0) takeSnapshot();
    app.engine.advance(1 / 60);
    dirty = true;
  }

  const sel = $('#selPreset');
  for (const p of V.presets) sel.append(new Option(p.title, p.id));
  sel.addEventListener('change', () => loadPreset(sel.value));
  $('#btnPlay').addEventListener('click', () => setRunning(!app.running));
  $('#btnStep').addEventListener('click', step);
  $('#btnReset').addEventListener('click', reset);
  document.querySelectorAll('#speedSeg button').forEach(b => b.addEventListener('click', () => {
    app.timeScale = +b.dataset.speed;
    document.querySelectorAll('#speedSeg button').forEach(q => q.setAttribute('aria-pressed', String(q === b)));
  }));
  $('#btnEquil').addEventListener('click', toEquilibrium);
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnFit').addEventListener('click', () => { view.fit(app.scene); dirty = true; });
  $('#tgSnap').addEventListener('click', () => setToggle('snap', !app.snap));
  $('#tgLabels').addEventListener('click', () => setToggle('labels', !app.labels));
  $('#tgTrail').addEventListener('click', () => setToggle('trail', !app.trailOn));
  document.querySelectorAll('.tool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
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

    if (dirty) {
      draw(now);
      dirty = false;
    }
    hud();
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

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = app.scene;
    let connectInfo = null, hand = null;
    if (ptr && ptr.mode === 'connect') {
      const a = s.get(ptr.start);
      if (a) {
        const t = ptr.target && s.get(ptr.target);
        connectInfo = { x0: view.sx(a.x), y0: view.sy(a.y), x1: t ? view.sx(t.x) : ptr.x, y1: t ? view.sy(t.y) : ptr.y, target: !!t };
      }
    }
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
      connect: connectInfo,
      hand,
      t: app.engine.t,
    });
  }

  function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
  const hudTime = $('#hudTime'), hudRate = $('#hudRate'), chipE = $('#chipEnergy'), chipG = $('#chipGravity'), hudMode = $('#hudMode');
  function hud() {
    const e = app.engine, s = app.scene;
    setText(hudTime, V.fixed(e.t, 3));
    let rate = '';
    if (app.running && e.lastSteps) {
      rate = `${V.fmt(app.timeScale)}× · h = ${V.fmt(e.lastH * 1000, 2)} ms · ${e.lastSteps} passos/quadro`;
      if (e.limited) rate += ' · desacelerado para manter a precisão';
    } else if (!app.running) rate = e.t === 0 ? 'pronto · condição inicial' : 'pausado';
    if (hudRate.textContent !== rate) {
      hudRate.textContent = rate;
      hudRate.classList.toggle('warn', !!(app.running && e.limited));
    }
    const err = e.energyErr;
    const cls = !app.running && e.t === 0 ? '' : err < 1e-4 ? 'good' : err < 1e-2 ? 'warn' : 'bad';
    const txt = `balanço ${!app.running && e.t === 0 ? '—' : V.fmt(err, 2)}`;
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
  setTool('interact');
  updateUndo();
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
  if (!restored) loadPreset('absorvedor', { initial: true });
  resize();
  requestAnimationFrame(t => { last = t; frame(t); });
})();
