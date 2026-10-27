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
  /* ---------- aba Montar ---------- */
  function numField(id, value, unit, onval, o = {}) {
    const input = h('input', { type: 'text', inputmode: 'decimal', id, autocomplete: 'off', spellcheck: 'false', disabled: o.disabled || null, 'aria-label': o.label || unit });
    input.value = fmtIn(value);
    input.addEventListener('input', () => {
      const v = parseNum(input.value);
      if (v === null || (o.valid && !o.valid(v))) { input.setAttribute('aria-invalid', 'true'); return; }
      input.removeAttribute('aria-invalid');
      onval(v);
    });
    input.addEventListener('change', () => { input.removeAttribute('aria-invalid'); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    return h('span', { class: 'num num-sm' + (o.disabled ? ' off' : '') }, input, h('span', { class: 'unit' }, unit));
  }

  const ORIENT_ICON = {
    h: '<svg viewBox="0 0 48 24"><path d="M4 4v16M4 8l-2 2M4 13l-2 2M4 18l-2 2M4 12h4l2-5 3 10 3-10 3 10 2-5h3"/><rect x="24" y="6" width="12" height="12" rx="2"/><path d="M20 20h22"/></svg>',
    hang: '<svg viewBox="0 0 48 24"><path d="M14 2h20M18 2l-2-2M24 2l-2-2M30 2l-2-2M24 2v2l-4 2 8 2-8 2 8 2-4 2v1"/><rect x="18" y="15" width="12" height="8" rx="2"/></svg>',
    stand: '<svg viewBox="0 0 48 24"><path d="M14 23h20M24 23v-2l-4-2 8-2-8-2 8-2-4-2v-1"/><rect x="18" y="1" width="12" height="8" rx="2"/><path d="M8 18l3-3 3 3M34 18l3-3 3 3"/></svg>',
  };

  function renderBuilder(box) {
    const app = V.app, s = app.scene;
    const cfg = V.chain.sync(s) || V.chain.defaults();
    const edit = (fn, structural) => app.chainEdit(fn, structural);
    const n = cfg.masses.length, horiz = cfg.orient === 'h';
    const baseName = { h: 'parede', hang: 'teto', stand: 'base' }[cfg.orient];

    box.append(sec(
      h('div', { class: 'guide' },
        h('span', { class: 'gstep' }, h('b', {}, '1'), 'Monte'),
        h('span', { class: 'gstep' }, h('b', {}, '2'), 'Simule'),
        h('span', { class: 'gstep' }, h('b', {}, '3'), 'Observe')),
      s.meta && s.meta.title ? h('p', { class: 'note' }, h('b', {}, s.meta.title), s.meta.text ? ' — ' + s.meta.text : '') : null));

    // 1 · forma
    const orient = h('div', { class: 'orient' });
    [['h', 'Horizontal', 'massas sobre um trilho'], ['hang', 'Pendurado', 'preso no teto, com gravidade'], ['stand', 'Sobre a base', 'apoiado no chão, com gravidade']].forEach(([v, t, sub]) => {
      const b = h('button', { type: 'button', class: 'ocard', 'aria-pressed': String(cfg.orient === v), onclick: () => edit(c => { c.orient = v; }, true) });
      const ic = document.createElement('span'); ic.className = 'oicon'; ic.innerHTML = ORIENT_ICON[v];
      b.append(ic, h('b', {}, t), h('small', {}, sub));
      orient.append(b);
    });
    box.append(sec(h('h3', {}, '1 · Forma do sistema'), orient));

    // 2 · massas
    box.append(sec(h('h3', {}, '2 · Quantas massas'),
      h('div', { class: 'row2' },
        h('div', { class: 'stepper' },
          h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Menos uma massa', disabled: n <= 1 || null, onclick: () => edit(c => { c.masses.pop(); }, true) }, '−'),
          h('span', { class: 'stepv' }, h('b', {}, String(n)), n === 1 ? ' massa' : ' massas'),
          h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Mais uma massa', disabled: n >= 8 || null, onclick: () => edit(c => { c.masses.push({ m: c.masses[c.masses.length - 1].m }); }, true) }, '+')),
        seg([['free', 'Última massa livre'], ['wall', `Presa ${horiz ? 'à parede' : cfg.orient === 'hang' ? 'embaixo' : 'em cima'}`]], cfg.end, v => edit(c => { c.end = v; }, true))),
      h('p', { class: 'note' }, `${n} ${n === 1 ? 'massa' : 'massas'} = ${n} ${n === 1 ? 'grau' : 'graus'} de liberdade: cada massa só se move ${horiz ? 'na horizontal' : 'na vertical'}.`)));

    // 3 · cadeia
    const list = h('div', { class: 'chainlist' });
    const nodeRow = (label, cls) => h('div', { class: 'cl-node ' + cls }, h('span', { class: 'cl-dot' }), label);
    list.append(nodeRow(baseName, 'wall'));
    cfg.links.forEach((l, j) => {
      const id = 'cb-' + j;
      list.append(h('div', { class: 'cl-link' },
        h('span', { class: 'cl-tag' }, `ligação ${j + 1}`),
        h('div', { class: 'cl-parts' },
          h('label', { class: 'cl-part' + (l.spring ? ' on' : ''), for: id + '-s' },
            h('input', { type: 'checkbox', id: id + '-s', checked: l.spring || null, onchange: e => edit(c => { c.links[j].spring = e.target.checked; }, true) }),
            'mola', h('i', {}, 'k' + (j + 1))),
          numField(id + '-k', l.k, 'N/m', v => edit(c => { c.links[j].k = v; }), { disabled: !l.spring, valid: v => v >= 0, label: `rigidez k${j + 1}` })),
        h('div', { class: 'cl-parts' },
          h('label', { class: 'cl-part' + (l.damper ? ' on' : ''), for: id + '-d' },
            h('input', { type: 'checkbox', id: id + '-d', checked: l.damper || null, onchange: e => edit(c => { c.links[j].damper = e.target.checked; }, true) }),
            'amortecedor', h('i', {}, 'c' + (j + 1))),
          numField(id + '-c', l.c, 'N·s/m', v => edit(c => { c.links[j].c = v; }), { disabled: !l.damper, valid: v => v >= 0, label: `amortecimento c${j + 1}` }))));
      if (j < n) {
        list.append(h('div', { class: 'cl-node mass' }, h('span', { class: 'cl-dot' }), h('b', {}, 'm' + (j + 1)),
          numField('cb-m-' + j, cfg.masses[j].m, 'kg', v => edit(c => { c.masses[j].m = v; }), { valid: v => v > 0, label: `massa m${j + 1}` })));
      }
    });
    if (cfg.end === 'wall') list.append(nodeRow(baseName + ' 2', 'wall'));
    box.append(sec(h('h3', {}, '3 · Peças, na ordem da cadeia'), list));

    // 4 · excitação
    const e = cfg.excite;
    const ex = sec(h('h3', {}, '4 · O que faz o sistema vibrar'),
      seg([['initial', 'Soltar deslocada'], ['force', 'Força'], ['sweep', 'Varredura'], ['base', 'Base vibrando']], e.type, v => edit(c => {
        c.excite.type = v;
        if (v === 'initial') c.excite.amp = 0.1;
        if (v === 'force' || v === 'sweep') { c.excite.amp = 1; c.excite.f = v === 'sweep' ? 0.3 : suggestedFreq(); c.excite.f1 = round3(suggestedFreq() * 2.5); c.excite.T = 60; }
        if (v === 'base') { c.excite.amp = 0.02; c.excite.f = suggestedFreq(); }
      }, true)));
    const fields = h('div', { class: 'exfields' });
    if (e.type !== 'base' && n > 1) {
      fields.append(h('div', { class: 'exrow' }, h('span', {}, e.type === 'initial' ? 'Massa deslocada' : 'Força aplicada em'),
        seg(cfg.masses.map((q, i) => [i, 'm' + (i + 1)]), e.mass, v => edit(c => { c.excite.mass = v; }, true))));
    }
    if (e.type === 'initial') {
      fields.append(h('div', { class: 'exrow' }, h('span', {}, 'Deslocamento inicial x₀'),
        numField('cb-x0', e.amp * 1000, 'mm', v => edit(c => { c.excite.amp = v / 1000; }, true), { valid: v => Math.abs(v) <= 2000 })));
    } else if (e.type === 'force' || e.type === 'sweep') {
      fields.append(h('div', { class: 'exrow' }, h('span', {}, 'Amplitude F₀'), numField('cb-F0', e.amp, 'N', v => edit(c => { c.excite.amp = v; }), { valid: v => v >= 0 })));
      if (e.type === 'force') fields.append(h('div', { class: 'exrow' }, h('span', {}, 'Frequência f'), numField('cb-f', e.f, 'Hz', v => edit(c => { c.excite.f = v; }), { valid: v => v >= 0 })));
      else {
        fields.append(h('div', { class: 'exrow' }, h('span', {}, 'De f₁'), numField('cb-f', e.f, 'Hz', v => edit(c => { c.excite.f = v; }), { valid: v => v >= 0 })));
        fields.append(h('div', { class: 'exrow' }, h('span', {}, 'Até f₂'), numField('cb-f1', e.f1, 'Hz', v => edit(c => { c.excite.f1 = v; }), { valid: v => v >= 0 })));
        fields.append(h('div', { class: 'exrow' }, h('span', {}, 'Em'), numField('cb-T', e.T, 's', v => edit(c => { c.excite.T = v; }), { valid: v => v > 0 })));
      }
    } else if (e.type === 'base') {
      fields.append(h('div', { class: 'exrow' }, h('span', {}, 'Amplitude da base A'), numField('cb-A', e.amp * 1000, 'mm', v => edit(c => { c.excite.amp = v / 1000; }), { valid: v => v >= 0 })));
      fields.append(h('div', { class: 'exrow' }, h('span', {}, 'Frequência f'), numField('cb-bf', e.f, 'Hz', v => edit(c => { c.excite.f = v; }), { valid: v => v >= 0 })));
    }
    ex.append(fields);
    box.append(ex);

    box.append(sec(h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => app.simulateFromStart() },
      h('span', { class: 'play-ic' }), 'Simular desde o início')));

    const exp = h('div', { class: 'sec', id: 'cbExplain' });
    renderExplain(exp);
    box.append(exp);
  }

  function renderExplain(box) {
    const app = V.app, s = app.scene;
    if (!s.chain) return;
    box.replaceChildren();
    const x = V.chain.explain(s.chain.cfg, s);
    box.append(h('h3', {}, 'Entenda o sistema'));
    if (x.lines.length) {
      box.append(h('div', { class: 'formulas' }, x.lines.map(l => h('div', { class: 'fx' },
        l.label ? h('span', { class: 'fx-l' }, l.label) : null,
        h('span', { class: 'fx-e' }, l.expr),
        h('span', { class: 'fx-v' }, '= ' + l.value)))));
    }
    for (const t of x.notes) box.append(h('p', { class: 'note' }, t));
    if (x.matrices) {
      const mat = (name, A, unit) => h('div', { class: 'mat' }, h('span', { class: 'mat-n' }, name + ' ='),
        h('table', {}, A.map(r => h('tr', {}, r.map(v => h('td', {}, v === 0 ? '0' : fmt(v, 4)))))), h('span', { class: 'mat-u' }, unit));
      box.append(h('div', { class: 'mats' }, mat('M', x.matrices.M, 'kg'), mat('K', x.matrices.K, 'N/m'), x.matrices.C ? mat('C', x.matrices.C, 'N·s/m') : null));
    }
  }

  let defaultsOpen = false;
  function renderScene(box) {
    const app = V.app, s = app.scene, meta = s.meta;
    if (s.chain && app.mode !== 'build') renderBuilder(box);
    else {
      const top = sec(head(meta && meta.title ? meta.title : 'Sistema desenhado à mão', 'livre'));
      if (meta && meta.text) top.append(h('p', { class: 'lead' }, meta.text));
      if (meta && meta.theory) top.append(h('p', { class: 'theory' }, meta.theory));
      top.append(h('p', { class: 'note' }, 'Este sistema tem geometria livre em 2D, então o montador em cadeia não o representa. Edite clicando nas peças ou no desenho livre, ou comece um sistema novo pelo montador.'));
      top.append(h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => app.newChain() }, 'Novo sistema pelo montador'),
        app.mode === 'build'
          ? h('button', { type: 'button', class: 'btn', onclick: () => app.setMode('test') }, 'Concluir desenho livre')
          : h('button', { type: 'button', class: 'btn', onclick: () => app.setMode('build') }, 'Editar no desenho')));
      box.append(top);
    }

    const free = s.nodes.filter(n => !n.fixed);
    const cnt = t => s.elements.filter(e => e.type === t).length;
    const d = app.defaults;
    box.append(sec(h('details', { class: 'defaults', open: defaultsOpen || null, ontoggle: e => { defaultsOpen = e.target.open; } },
      h('summary', {}, h('span', {}, 'Mais opções: gravidade, desenho livre, resumo')),
      h('div', { class: 'more' },
        h('div', { class: 'checks' }, check('env-g', 'gravidade ligada', s.gravity, v => { app.pushHistory(); s.gravity = v; app.changed(false); render(); })),
        s.gravity ? param({ key: 'g', sym: 'g', label: 'aceleração da gravidade', unit: 'm/s²', min: 0, max: 30, log: false, get: () => s.g, set: v => { s.g = v; }, valid: v => v >= 0 }) : null,
        h('div', { class: 'stats' },
          [[free.length, 'massas'], [s.nodes.length - free.length, 'apoios'], [s.freeDofCount(), 'GDL'],
            [cnt('spring'), 'molas'], [cnt('damper'), 'amortecedores'], [fmt(free.reduce((a, n) => a + n.m, 0)), 'kg no total']]
            .map(([v, k]) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, k)))),
        h('h3', {}, 'Desenho livre (avançado)'),
        h('p', { class: 'note' }, 'Para sistemas em 2D (treliças, pêndulos, malhas): arraste peças de uma bandeja para o desenho e ligue nós puxando o ⊕. Ao entrar, o montador em cadeia deixa de controlar este sistema.'),
        app.mode === 'build'
          ? h('button', { type: 'button', class: 'btn', onclick: () => app.setMode('test') }, 'Concluir desenho livre')
          : h('button', { type: 'button', class: 'btn', onclick: () => app.setMode('build') }, 'Editar no desenho livre'),
        h('h3', {}, 'Valores das peças criadas no desenho livre'),
        param({ key: 'dm', sym: 'm', label: 'massa', unit: 'kg', min: 0.01, max: 100, get: () => d.m, set: v => { d.m = v; }, valid: v => v > 0 }),
        param({ key: 'dk', sym: 'k', label: 'rigidez', unit: 'N/m', min: 0.1, max: 1e5, get: () => d.k, set: v => { d.k = v; }, valid: v => v >= 0 }),
        param({ key: 'dc', sym: 'c', label: 'amortecimento', unit: 'N·s/m', min: 0.001, max: 2000, get: () => d.c, set: v => { d.c = v; }, valid: v => v >= 0 })))));
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

  function refreshExplain() {
    const el = document.getElementById('cbExplain');
    if (el) renderExplain(el);
  }

  V.inspector = { render, renderModal, liveUpdate, setTab, refreshExplain, h };
})();
