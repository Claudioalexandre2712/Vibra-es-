/* Painel direito: propriedades da seleção, ambiente e análise modal. */
(function () {
  'use strict';
  const V = window.Vib;
  const fmt = V.fmt;
  const $ = s => document.querySelector(s);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }

  const fmtIn = v => (Number.isFinite(v) ? String(+v.toPrecision(6)).replace('.', ',') : '');
  const parseNum = s => {
    const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  };
  const round3 = v => Number(v.toPrecision(3));

  /* Linha de parâmetro: campo numérico + controle deslizante (escala log ou linear). */
  function param(o) {
    const app = V.app;
    const id = 'prm-' + o.key;
    const min = o.min, max = o.max, log = o.log !== false;
    const toS = v => {
      v = Math.max(min, Math.min(max, v));
      return log ? 1000 * Math.log(v / min) / Math.log(max / min) : 1000 * (v - min) / (max - min);
    };
    const fromS = s => (log ? min * Math.pow(max / min, s / 1000) : min + (max - min) * s / 1000);
    const input = h('input', { type: 'text', inputmode: 'decimal', id, autocomplete: 'off', spellcheck: 'false' });
    input.value = fmtIn(o.get());
    const range = o.slider === false ? null : h('input', { type: 'range', min: 0, max: 1000, step: 1, id: id + '-r', 'aria-label': o.label });
    if (range) range.value = toS(o.get());
    const ok = v => v !== null && (!o.valid || o.valid(v));
    input.addEventListener('input', () => {
      const v = parseNum(input.value);
      if (!ok(v)) { input.setAttribute('aria-invalid', 'true'); return; }
      input.removeAttribute('aria-invalid');
      app.beginEdit();
      o.set(v);
      if (range) range.value = toS(v);
      app.changed(o.structural);
    });
    input.addEventListener('change', () => { input.value = fmtIn(o.get()); input.removeAttribute('aria-invalid'); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    if (range) {
      range.addEventListener('input', () => {
        let v = round3(fromS(+range.value));
        if (!log && Math.abs(v) < (max - min) * 1e-3) v = 0;
        app.beginEdit();
        o.set(v);
        input.value = fmtIn(v);
        app.changed(o.structural);
      });
    }
    return h('div', { class: 'param' },
      h('label', { for: id }, o.sym ? h('b', {}, o.sym) : null, o.label),
      h('span', { class: 'num' }, input, h('span', { class: 'unit' }, o.unit || '')),
      range);
  }

  function check(id, label, checked, onchange) {
    return h('label', { class: 'check', for: id },
      h('input', { type: 'checkbox', id, checked: checked || null, onchange: e => onchange(e.target.checked) }),
      label);
  }

  function seg(options, value, onpick) {
    return h('div', { class: 'seg', role: 'group' },
      options.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => onpick(v) }, label)));
  }

  function live(rows) {
    return h('div', { class: 'live' }, rows.map(([k, id]) => [h('span', { class: 'k' }, k), h('span', { class: 'v', id }, '—')]));
  }

  function suggestedFreq() {
    const an = V.app.modal.an;
    const m = an && an.modes.find(q => q.kind === 'elastic');
    return m ? round3(m.f) : 1;
  }
  /* ---------- blocos ---------- */
  const sec = (...kids) => h('div', { class: 'sec' }, ...kids);
  const head = (title, tag, sub) => h('div', { class: 'sec-head' },
    h('div', {}, h('h2', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
    tag ? h('span', { class: 'tag accent' }, tag) : null);
  const params = (...kids) => h('div', { class: 'params' }, ...kids);

  /* ---------- aba Seleção: nó ---------- */
  function renderNode(box, n) {
    const app = V.app, s = app.scene;
    const links = s.attached(n.id).length;
    box.append(sec(head(n.name, n.fixed ? 'apoio' : 'massa', `${links} ${links === 1 ? 'elemento ligado' : 'elementos ligados'}`)));

    if (!n.fixed) {
      box.append(sec(
        h('h3', {}, 'Inércia e graus de liberdade'),
        params(param({ key: 'm', sym: 'm', label: 'massa', unit: 'kg', min: 0.01, max: 100, get: () => n.m, set: v => { n.m = v; }, valid: v => v > 0 })),
        h('div', { class: 'checks' },
          check('dof-x', 'livre em x', !n.lockX, v => { app.pushHistory(); n.lockX = !v; if (n.lockX) n.vx = 0; app.changed(true); render(); }),
          check('dof-y', 'livre em y', !n.lockY, v => { app.pushHistory(); n.lockY = !v; if (n.lockY) n.vy = 0; app.changed(true); render(); }))));

      const type = n.force ? n.force.type : 'none';
      const fsec = sec(h('h3', {}, 'Força externa'),
        seg([['none', 'Nenhuma'], ['harmonic', 'Harmônica'], ['sweep', 'Varredura']], type, v => {
          app.pushHistory();
          if (v === 'none') n.force = null;
          else {
            const f = suggestedFreq();
            const old = n.force || {};
            n.force = {
              type: v, F0: old.F0 || 1, f: v === 'sweep' ? round3(f / 3) : (old.f || f),
              f1: old.f1 || round3(f * 2), T: old.T || 60,
              angle: old.angle !== undefined ? old.angle : (n.lockX && !n.lockY ? 90 : 0), phase: old.phase || 0,
            };
          }
          app.changed(false);
          render();
        }));
      if (n.force) {
        const F = n.force;
        const list = [param({ key: 'F0', sym: 'F₀', label: 'amplitude', unit: 'N', min: 0.01, max: 200, get: () => F.F0, set: v => { F.F0 = v; }, valid: v => v >= 0 })];
        if (F.type === 'sweep') {
          list.push(param({ key: 'f', sym: 'f₁', label: 'frequência inicial', unit: 'Hz', min: 0.02, max: 50, get: () => F.f, set: v => { F.f = v; }, valid: v => v >= 0 }));
          list.push(param({ key: 'f1', sym: 'f₂', label: 'frequência final', unit: 'Hz', min: 0.02, max: 50, get: () => F.f1, set: v => { F.f1 = v; }, valid: v => v >= 0 }));
          list.push(param({ key: 'T', sym: 'T', label: 'duração', unit: 's', min: 1, max: 600, get: () => F.T, set: v => { F.T = v; }, valid: v => v > 0 }));
        } else {
          list.push(param({ key: 'f', sym: 'f', label: 'frequência', unit: 'Hz', min: 0.02, max: 50, get: () => F.f, set: v => { F.f = v; }, valid: v => v >= 0 }));
        }
        list.push(param({ key: 'ang', sym: 'θ', label: 'direção', unit: '°', min: -180, max: 180, log: false, get: () => F.angle, set: v => { F.angle = v; } }));
        list.push(param({ key: 'ph', sym: 'φ', label: 'fase', unit: '°', min: -180, max: 180, log: false, get: () => F.phase, set: v => { F.phase = v; } }));
        fsec.append(params(list), h('p', { class: 'note' }, 'F(t) = F₀·sen(2πft + φ), na direção θ medida a partir de +x.'));
      }
      box.append(fsec);

      box.append(sec(h('h3', {}, 'Estado agora'),
        live([['posição x, y', 'lv-pos'], ['desloc. do equilíbrio', 'lv-u'], ['velocidade', 'lv-v']]),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { app.pushHistory(); n.vx = n.vy = 0; s.rev++; } }, 'Zerar velocidade'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { app.pushHistory(); s.setFixed(n, true); app.changed(true); render(); } }, 'Tornar apoio'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => app.deleteSelection() }, 'Excluir'))));
    } else {
      const on = !!(n.base && n.base.A);
      const bsec = sec(h('h3', {}, 'Excitação de base'),
        seg([['none', 'Fixo'], ['harmonic', 'Harmônica']], on ? 'harmonic' : 'none', v => {
          app.pushHistory();
          n.base = v === 'none' ? null : Object.assign({ A: 0.01, f: suggestedFreq(), angle: 0, phase: 0 }, n.base || {}, { A: (n.base && n.base.A) || 0.01 });
          if (!n.base) { n.x = n.x0; n.y = n.y0; }
          app.changed(false);
          render();
        }));
      if (on) {
        const B = n.base;
        bsec.append(params(
          param({ key: 'A', sym: 'A', label: 'amplitude', unit: 'm', min: 0.0005, max: 0.5, get: () => B.A, set: v => { B.A = v; }, valid: v => v >= 0 }),
          param({ key: 'bf', sym: 'f', label: 'frequência', unit: 'Hz', min: 0.02, max: 50, get: () => B.f, set: v => { B.f = v; }, valid: v => v >= 0 }),
          param({ key: 'bang', sym: 'θ', label: 'direção', unit: '°', min: -180, max: 180, log: false, get: () => B.angle, set: v => { B.angle = v; } }),
          param({ key: 'bph', sym: 'φ', label: 'fase', unit: '°', min: -180, max: 180, log: false, get: () => B.phase, set: v => { B.phase = v; } })),
        h('p', { class: 'note' }, 'u(t) = A·sen(2πft + φ) na direção θ. Para a resposta em frequência, todos os apoios excitados devem ter a mesma frequência.'));
      } else bsec.append(h('p', { class: 'note' }, 'Apoio imóvel. Escolha “Harmônica” para mover o apoio como uma base vibrante (estrada, sismo, máquina vizinha).'));
      box.append(bsec);
      box.append(sec(h('h3', {}, 'Estado agora'),
        live([['posição x, y', 'lv-pos']]),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { app.pushHistory(); s.setFixed(n, false); app.changed(true); render(); } }, 'Tornar massa'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => app.deleteSelection() }, 'Excluir'))));
    }
  }

  /* ---------- aba Seleção: elemento ---------- */
  function renderElement(box, e) {
    const app = V.app, s = app.scene;
    const a = s.get(e.a), b = s.get(e.b);
    box.append(sec(head(e.name, e.type === 'spring' ? 'mola' : 'amortecedor', `liga ${a.name} ↔ ${b.name}`)));
    if (e.type === 'spring') {
      const Lnow = s.elementLength(e);
      box.append(sec(h('h3', {}, 'Rigidez'),
        params(
          param({ key: 'k', sym: 'k', label: 'rigidez', unit: 'N/m', min: 0.1, max: 1e5, get: () => e.k, set: v => { e.k = v; }, valid: v => v >= 0 }),
          param({ key: 'L0', sym: 'L₀', label: 'comprimento natural', unit: 'm', min: 0, max: Math.max(1, +(2.2 * Math.max(Lnow, e.L0)).toFixed(2)), log: false, get: () => e.L0, set: v => { e.L0 = v; }, valid: v => v >= 0 })),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { app.pushHistory(); e.L0 = round3(s.elementLength(e)); app.changed(false); render(); } }, 'L₀ = comprimento atual'))));
      box.append(sec(h('h3', {}, 'Não linearidade'),
        params(param({ key: 'k3', sym: 'k₃', label: 'termo cúbico', unit: 'N/m³', min: -1e5, max: 1e5, slider: false, get: () => e.k3, set: v => { e.k3 = v; } })),
        h('p', { class: 'note' }, 'F = k·ΔL + k₃·ΔL³. Com k₃ ≠ 0 a mola é de Duffing; a análise modal usa a rigidez tangente no equilíbrio.')));
      box.append(sec(h('h3', {}, 'Estado agora'), live([['comprimento L', 'lv-L'], ['deformação ΔL', 'lv-dL'], ['força (tração +)', 'lv-F']])));
    } else {
      box.append(sec(h('h3', {}, 'Amortecimento viscoso'),
        params(param({ key: 'c', sym: 'c', label: 'coeficiente', unit: 'N·s/m', min: 0.001, max: 2000, get: () => e.c, set: v => { e.c = v; }, valid: v => v >= 0 })),
        h('p', { class: 'note' }, 'F = c·(v_b − v_a)·n: proporcional à velocidade relativa ao longo do eixo.')));
      box.append(sec(h('h3', {}, 'Estado agora'), live([['comprimento L', 'lv-L'], ['força (tração +)', 'lv-F'], ['potência dissipada', 'lv-P']])));
    }
    box.append(sec(h('div', { class: 'row-actions' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => app.deleteSelection() }, 'Excluir elemento'))));
  }

  function renderEmpty(box) {
    const ic = document.createElement('span');
    ic.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6 2-3 6z"/></svg>';
    box.append(h('div', { class: 'empty' }, ic,
      h('b', {}, 'Nada selecionado'),
      h('p', {}, 'Clique em uma massa, apoio, mola ou amortecedor no desenho para editar seus parâmetros aqui.')));
  }

  /* ---------- aba Sistema ---------- */
  let defaultsOpen = false;
  function renderScene(box) {
    const app = V.app, s = app.scene, meta = s.meta;
    const top = sec(head(meta ? meta.title : 'Sistema personalizado', null));
    if (meta && meta.text) top.append(h('p', { class: 'lead' }, meta.text));
    if (meta && meta.theory) top.append(h('p', { class: 'theory' }, meta.theory));
    if (!meta) top.append(h('p', { class: 'note' }, 'Sistema montado ou importado por você. Use as ferramentas à esquerda para acrescentar peças.'));
    box.append(top);

    const free = s.nodes.filter(n => !n.fixed);
    const cnt = t => s.elements.filter(e => e.type === t).length;
    box.append(sec(h('h3', {}, 'Resumo'), h('div', { class: 'stats' },
      [[free.length, 'massas'], [s.nodes.length - free.length, 'apoios'], [s.freeDofCount(), 'GDL'],
        [cnt('spring'), 'molas'], [cnt('damper'), 'amortecedores'], [fmt(free.reduce((a, n) => a + n.m, 0)), 'kg no total']]
        .map(([v, k]) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, k))))));

    const env = sec(h('h3', {}, 'Ambiente'),
      h('div', { class: 'checks' }, check('env-g', 'gravidade ligada', s.gravity, v => { app.pushHistory(); s.gravity = v; app.changed(false); render(); })));
    if (s.gravity) env.append(params(param({ key: 'g', sym: 'g', label: 'aceleração da gravidade', unit: 'm/s²', min: 0, max: 30, log: false, get: () => s.g, set: v => { s.g = v; }, valid: v => v >= 0 })));
    box.append(env);

    const d = app.defaults;
    box.append(sec(h('details', { class: 'defaults', open: defaultsOpen || null, ontoggle: e => { defaultsOpen = e.target.open; } },
      h('summary', {}, h('span', {}, 'Valores das novas peças: ', h('b', {}, `${fmt(d.m)} kg · ${fmt(d.k)} N/m · ${fmt(d.c)} N·s/m`))),
      param({ key: 'dm', sym: 'm', label: 'massa', unit: 'kg', min: 0.01, max: 100, get: () => d.m, set: v => { d.m = v; }, valid: v => v > 0 }),
      param({ key: 'dk', sym: 'k', label: 'rigidez', unit: 'N/m', min: 0.1, max: 1e5, get: () => d.k, set: v => { d.k = v; }, valid: v => v >= 0 }),
      param({ key: 'dc', sym: 'c', label: 'amortecimento', unit: 'N·s/m', min: 0.001, max: 2000, get: () => d.c, set: v => { d.c = v; }, valid: v => v >= 0 }))));
  }

  /* ---------- abas ---------- */
  let tab = 'sys';
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.itab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.itab === t)));
    $('#inspSys').hidden = t !== 'sys';
    $('#inspSel').hidden = t !== 'sel';
    $('#inspModal').hidden = t !== 'modes';
  }
  document.querySelectorAll('.itab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.itab)));

  function keepFocus(box, fn) {
    const id = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
    box.replaceChildren();
    fn();
    if (id) { const el = document.getElementById(id); if (el) el.focus(); }
  }

  /* Redesenha as abas Sistema e Seleção. `follow` muda para a aba da seleção. */
  function render(follow) {
    const app = V.app;
    const sel = app.selection && app.scene.get(app.selection.id);
    if (!sel) app.selection = null;
    keepFocus($('#inspSys'), () => renderScene($('#inspSys')));
    const sbox = $('#inspSel');
    keepFocus(sbox, () => {
      if (!sel) renderEmpty(sbox);
      else if (app.selection.kind === 'node') renderNode(sbox, sel);
      else renderElement(sbox, sel);
    });
    const badge = $('#selBadge');
    badge.hidden = !sel;
    if (sel) badge.textContent = sel.name;
    if (follow === true) setTab(sel ? 'sel' : (tab === 'sel' ? 'sys' : tab));
    liveUpdate(true);
  }

  /* ---------- aba Modos ---------- */
  const MAX_ROWS = 24;
  let showAll = false;
  function renderModal() {
    const app = V.app, box = $('#inspModal'), M = app.modal;
    box.replaceChildren();
    const nf = app.scene.freeDofCount();
    const an = M.an;
    const elastic = an ? an.modes.filter(m => m.kind === 'elastic') : [];
    const badge = $('#modesBadge');
    badge.hidden = !an || !an.modes.length;
    if (an && an.modes.length) badge.textContent = String(an.modes.length);

    const top = sec(head('Análise modal', `${nf} GDL`, elastic.length ? `1º modo: ${fmt(elastic[0].f, 4)} Hz` : null));
    if (M.msg) top.append(h('p', { class: 'status' + (M.bad ? ' bad' : '') }, M.msg));
    box.append(top);
    if (!an || !an.modes.length) {
      if (!M.msg) box.append(sec(h('p', { class: 'note' }, 'Sem graus de liberdade livres: crie massas e ligue-as a apoios.')));
      return;
    }
    const list = h('div', { class: 'modes' });
    const modes = showAll ? an.modes : an.modes.slice(0, MAX_ROWS);
    modes.forEach((m, r) => {
      let main, sub;
      if (m.kind === 'rigid') { main = '0 Hz'; sub = 'corpo rígido'; }
      else if (m.kind === 'unstable') { main = 'instável'; sub = `λ = ${fmt(m.lam)}`; }
      else {
        main = `${fmt(m.f, 4)} Hz`;
        sub = m.zeta >= 1 ? `ζ ${fmt(m.zeta, 3)} · não oscila` : (m.zeta > 1e-9 ? `ζ ${fmt(m.zeta * 100, 2)} % · T ${fmt(1 / m.f, 3)} s` : `sem amortecimento · T ${fmt(1 / m.f, 3)} s`);
      }
      const on = app.ghost && app.ghost.r === r;
      list.append(h('div', { class: 'mode-row' + (on ? ' on' : '') },
        h('span', { class: 'idx' }, String(r + 1)),
        h('span', { class: 'fr' }, h('b', {}, main), h('small', {}, sub)),
        h('span', { class: 'acts' },
          h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': String(!!on), title: 'Animar a forma do modo sobre o desenho', onclick: () => app.toggleGhost(r) }, on ? 'Parar' : 'Ver'),
          m.kind === 'elastic' ? h('button', { class: 'btn btn-sm', type: 'button', title: 'Soltar o sistema a partir da forma deste modo', onclick: () => app.exciteMode(r) }, 'Excitar') : null)));
    });
    const lsec = sec(h('h3', {}, 'Frequências naturais'), list);
    if (an.modes.length > MAX_ROWS) {
      lsec.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { showAll = !showAll; renderModal(); } },
        showAll ? 'Mostrar menos' : `Mostrar todos os ${an.modes.length} modos`));
    }
    box.append(lsec);
    box.append(sec(h('p', { class: 'note' }, 'fn = ωn/2π, sem amortecimento. ζ modal = φᵀCφ/(2ωn), exato para amortecimento proporcional. “Ver” anima a forma do modo; “Excitar” solta o sistema nessa forma.')));
  }

  /* ---------- leituras ao vivo ---------- */
  function set(id, txt) { const el = document.getElementById(id); if (el && el.textContent !== txt) el.textContent = txt; }
  let lastLive = 0;
  function liveUpdate(force) {
    const now = performance.now();
    if (!force && now - lastLive < 100) return;
    lastLive = now;
    const app = V.app, s = app.scene, sel = app.selection && s.get(app.selection.id);
    if (!sel) return;
    if (app.selection.kind === 'node') {
      set('lv-pos', `${V.fixed(sel.x, 3)}, ${V.fixed(sel.y, 3)} m`);
      if (!sel.fixed) {
        const eq = app.modal.eqMap && app.modal.eqMap.get(sel.id);
        set('lv-u', eq ? `${V.fixed((sel.x - eq.x) * 1000, 1)}, ${V.fixed((sel.y - eq.y) * 1000, 1)} mm` : '—');
        set('lv-v', `${V.fixed(Math.hypot(sel.vx, sel.vy), 3)} m/s`);
      }
    } else {
      const e = sel, L = s.elementLength(e);
      set('lv-L', `${V.fixed(L, 4)} m`);
      if (e.type === 'spring') {
        const dL = L - e.L0;
        set('lv-dL', `${V.fixed(dL * 1000, 2)} mm`);
        set('lv-F', `${fmt(e.k * dL + e.k3 * dL ** 3, 3)} N`);
      } else {
        const a = s.get(e.a), b = s.get(e.b);
        const nx = (b.x - a.x) / (L || 1), ny = (b.y - a.y) / (L || 1);
        const vr = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        set('lv-F', `${fmt(e.c * vr, 3)} N`);
        set('lv-P', `${fmt(e.c * vr * vr, 3)} W`);
      }
    }
  }

  V.inspector = { render, renderModal, liveUpdate, setTab, h };
})();
