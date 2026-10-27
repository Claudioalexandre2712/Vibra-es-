/* Sistemas prontos. Cada um monta a cena; o app coloca as massas no
 * equilíbrio estático e depois aplica a perturbação inicial (perturb). */
(function (root) {
  'use strict';
  const Vib = root.Vib = root.Vib || {};
  const S = () => new Vib.Scene();

  const presets = [
    {
      id: 'livre',
      title: 'Oscilador livre (1 GDL)',
      text: 'Massa sobre trilho ligada a uma parede por uma mola. Sem amortecimento, a energia troca entre cinética e potencial e o balanço de energia permanece constante.',
      theory: 'ωn = √(k/m) = √(100/1) = 10 rad/s → fn = 1,592 Hz, T = 0,628 s. Solução: x(t) = x₀·cos(ωn·t).',
      labels: true,
      build() {
        const s = S();
        s.gravity = true;
        const A = s.addNode(0, 0, { fixed: true });
        const m = s.addNode(0.6, 0, { m: 1, lockY: true });
        s.addElement('spring', A.id, m.id, { k: 100 });
        return s;
      },
      perturb(s) { s.nodes[1].x += 0.12; },
    },
    {
      id: 'amortecimento',
      title: 'Comparação de amortecimento',
      text: 'Quatro osciladores idênticos (m = 1 kg, k = 100 N/m) com fatores de amortecimento diferentes, liberados do mesmo deslocamento inicial.',
      theory: 'c = 2ζ·√(k·m). ζ = 0,05 e 0,2: subamortecido, oscila com ωd = ωn·√(1−ζ²). ζ = 1: crítico, retorno mais rápido sem oscilar. ζ = 2: superamortecido. Decremento logarítmico δ = 2πζ/√(1−ζ²).',
      labels: true,
      build() {
        const s = S();
        [0.05, 0.2, 1, 2].forEach((z, i) => {
          const y = -0.6 * i;
          const A = s.addNode(0, y, { fixed: true });
          const m = s.addNode(0.6, y, { m: 1, lockY: true });
          s.addElement('spring', A.id, m.id, { k: 100 });
          s.addElement('damper', A.id, m.id, { c: +(2 * z * 10).toFixed(3) });
        });
        return s;
      },
      perturb(s) { s.nodes.filter(n => !n.fixed).forEach(n => { n.x += 0.15; }); },
    },
    {
      id: 'vertical',
      title: 'Massa suspensa com gravidade',
      text: 'Mola e amortecedor pendurados no teto. A gravidade só desloca a posição de equilíbrio (deflexão estática); a frequência natural não muda.',
      theory: 'δst = m·g/k = 0,098 m. ωn = √(k/m) = √(g/δst) = 10 rad/s → fn = 1,592 Hz. ζ = c/(2√(km)) = 0,05.',
      labels: true,
      build() {
        const s = S();
        const A = s.addNode(0, 0, { fixed: true });
        const m = s.addNode(0, -0.7, { m: 1, lockX: true });
        s.addElement('spring', A.id, m.id, { k: 100, L0: 0.6 });
        s.addElement('damper', A.id, m.id, { c: 1, L0: 0.6 });
        return s;
      },
      perturb(s) { s.nodes[1].y -= 0.15; },
    },
    {
      id: 'forcado',
      title: 'Ressonância por varredura',
      text: 'Força harmônica cuja frequência sobe lentamente de 0,5 Hz a 3 Hz em 60 s. A amplitude cresce perto de fn e depois cai. Acompanhe no gráfico de tempo e no de resposta em frequência.',
      theory: 'Regime permanente: X/Xst = 1/√((1−r²)² + (2ζr)²), r = f/fn. Com ζ = 0,05 o pico vale ≈ 1/(2ζ) = 10 vezes a deflexão estática F₀/k = 10 mm.',
      labels: true,
      build() {
        const s = S();
        const A = s.addNode(0, 0, { fixed: true });
        const m = s.addNode(0.6, 0, { m: 1, lockY: true, force: { type: 'sweep', F0: 1, f: 0.5, f1: 3, T: 60, angle: 0, phase: 0 } });
        s.addElement('spring', A.id, m.id, { k: 100 });
        s.addElement('damper', A.id, m.id, { c: 1 });
        return s;
      },
    },
    {
      id: 'base',
      title: 'Excitação de base (suspensão)',
      text: 'O apoio inferior se move como uma estrada ondulada (A = 20 mm). Mude a frequência da base: abaixo de √2·fn a massa amplifica o movimento; acima, isola.',
      theory: 'Transmissibilidade TR = √((1+(2ζr)²)/((1−r²)²+(2ζr)²)). fn = 1,592 Hz, ζ = 0,1. Em 2 Hz (r = 1,26) TR ≈ 1,6; em 4 Hz (r = 2,5) TR ≈ 0,22.',
      labels: true,
      build() {
        const s = S();
        const B = s.addNode(0, 0, { fixed: true, base: { A: 0.02, f: 2, angle: 90, phase: 0 } });
        const m = s.addNode(0, 0.6, { m: 1, lockX: true });
        s.addElement('spring', B.id, m.id, { k: 100, L0: 0.698 });
        s.addElement('damper', B.id, m.id, { c: 2, L0: 0.6 });
        return s;
      },
    },
    {
      id: 'batimento',
      title: 'Osciladores acoplados (batimento)',
      text: 'Duas massas iguais presas às paredes e ligadas por uma mola fraca. Solte só a primeira: a energia passa de uma para a outra e volta.',
      theory: 'Modos: em fase ω₁ = √(k/m) = 10 rad/s (1,592 Hz); em oposição ω₂ = √((k+2kc)/m) = 10,77 rad/s (1,714 Hz). Período do batimento: 1/(f₂−f₁) ≈ 8,2 s.',
      labels: true,
      build() {
        const s = S();
        const A = s.addNode(0, 0, { fixed: true });
        const m1 = s.addNode(0.6, 0, { m: 1, lockY: true });
        const m2 = s.addNode(1.2, 0, { m: 1, lockY: true });
        const B = s.addNode(1.8, 0, { fixed: true });
        s.addElement('spring', A.id, m1.id, { k: 100 });
        s.addElement('spring', m1.id, m2.id, { k: 8 });
        s.addElement('spring', m2.id, B.id, { k: 100 });
        return s;
      },
      perturb(s) { s.nodes[1].x += 0.12; },
    },
    {
      id: 'absorvedor',
      title: 'Absorvedor dinâmico (2 GDL)',
      text: 'Máquina m₁ excitada na sua frequência natural, com um absorvedor m₂ sintonizado (k₂/m₂ = k₁/m₁). A máquina quase para e o absorvedor oscila. Na resposta em frequência aparece a antirressonância.',
      theory: 'fn,1 = √(200/2)/2π = 1,592 Hz = f da força. Sintonia ideal: k₂ = m₂·ω² = 20 N/m. Experimente o ótimo de Den Hartog para μ = 0,1: k₂ = 16,5 N/m e c₂ = 0,61 N·s/m.',
      labels: true,
      build() {
        const s = S();
        const A = s.addNode(0, 0, { fixed: true });
        const m1 = s.addNode(0.6, 0, { m: 2, lockY: true, force: { type: 'harmonic', F0: 2, f: 1.5915, angle: 0, phase: 0 } });
        const m2 = s.addNode(1.1, 0, { m: 0.2, lockY: true });
        s.addElement('spring', A.id, m1.id, { k: 200 });
        s.addElement('damper', A.id, m1.id, { c: 0.2 });
        s.addElement('spring', m1.id, m2.id, { k: 20 });
        s.addElement('damper', m1.id, m2.id, { c: 0.05 });
        return s;
      },
    },
    {
      id: 'pendulo',
      title: 'Pêndulo elástico',
      text: 'Massa presa a uma mola, livre no plano. Com ωmola = 2·ωpêndulo há ressonância interna: a oscilação vertical vira balanço lateral e volta. Sistema não linear de 2 GDL.',
      theory: 'Equilíbrio: L = L₀ + mg/k = 1 m. ωmola = √(k/m) = 6,26 rad/s; ωpêndulo = √(g/L) = 3,13 rad/s (razão 2:1). A análise modal linearizada mostra as duas frequências.',
      labels: true,
      build() {
        const s = S();
        const A = s.addNode(0, 0, { fixed: true });
        const m = s.addNode(0, -1, { m: 1 });
        s.addElement('spring', A.id, m.id, { k: 39.24, L0: 0.75 });
        return s;
      },
      perturb(s) { s.nodes[1].y -= 0.12; s.nodes[1].x += 0.01; },
    },
    {
      id: 'corda',
      title: 'Corda discreta (14 GDL)',
      text: 'Quatorze massas entre dois apoios, ligadas por molas pré-tracionadas. Só o movimento transversal é livre: é o modelo discreto de uma corda vibrante. Veja os modos em forma de senoide.',
      theory: 'Tração T = k(a−L₀) = 10 N, a = 0,2 m, m = 50 g. Modos discretos: ωj = 2√(T/(m·a))·sin(jπ/30). f₁ = 1,052 Hz (corda contínua: c/2L = 1,054 Hz).',
      labels: false,
      build() {
        const s = S();
        s.gravity = false;
        const N = 14, a = 0.2;
        let prev = s.addNode(0, 0, { fixed: true });
        for (let i = 1; i <= N; i++) {
          const n = s.addNode(i * a, 0, { m: 0.05, lockX: true });
          s.addElement('spring', prev.id, n.id, { k: 200, L0: 0.15 });
          prev = n;
        }
        const B = s.addNode((N + 1) * a, 0, { fixed: true });
        s.addElement('spring', prev.id, B.id, { k: 200, L0: 0.15 });
        return s;
      },
      perturb(s) {
        const free = s.nodes.filter(n => !n.fixed), N = free.length, p = 4;
        free.forEach((n, i) => { const j = i + 1; n.y = 0.12 * (j <= p ? j / p : (N + 1 - j) / (N + 1 - p)); });
      },
    },
    {
      id: 'predio',
      title: 'Pórtico treliçado sob sismo',
      text: 'Estrutura de três pavimentos com contraventamento em X. O solo se move horizontalmente (4 mm) na primeira frequência natural, ≈ 0,69 Hz. Desligue a excitação da base e use “Excitar” na análise modal para ver cada modo sozinho.',
      theory: 'Cada nó tem 2 GDL (12 no total). Os primeiros modos são de flexão lateral (1º: todos os andares no mesmo sentido); os modos altos são axiais das colunas e vigas.',
      labels: false,
      build() {
        const s = S();
        const w = 0.8, hgt = 0.6;
        const L0 = s.addNode(0, 0, { fixed: true, base: { A: 0.004, f: 0.69, angle: 0, phase: 0 } });
        const R0 = s.addNode(w, 0, { fixed: true, base: { A: 0.004, f: 0.69, angle: 0, phase: 0 } });
        let pl = L0, pr = R0;
        for (let j = 1; j <= 3; j++) {
          const l = s.addNode(0, j * hgt, { m: 2 });
          const r = s.addNode(w, j * hgt, { m: 2 });
          s.addElement('spring', pl.id, l.id, { k: 4000 });
          s.addElement('spring', pr.id, r.id, { k: 4000 });
          s.addElement('spring', l.id, r.id, { k: 4000 });
          s.addElement('spring', pl.id, r.id, { k: 600 });
          s.addElement('spring', pr.id, l.id, { k: 600 });
          s.addElement('damper', pl.id, r.id, { c: 8 });
          s.addElement('damper', pr.id, l.id, { c: 8 });
          pl = l; pr = r;
        }
        return s;
      },
    },
    {
      id: 'malha',
      title: 'Malha elástica 2D',
      text: 'Grade de 24 massas pendurada pela linha superior, com molas estruturais, diagonais e amortecedores verticais. Puxe e solte qualquer ponto com a ferramenta Interagir.',
      theory: 'São 48 GDL e o mesmo número de modos. Os mais baixos são balanços globais; os mais altos são vibrações locais entre massas vizinhas.',
      labels: false,
      build() {
        const s = S();
        const cols = 6, rows = 5, d = 0.25;
        const id = [];
        for (let r = 0; r < rows; r++) {
          id.push([]);
          for (let c = 0; c < cols; c++) {
            const n = s.addNode(c * d, -r * d, r === 0 ? { fixed: true } : { m: 0.1 });
            id[r].push(n.id);
          }
        }
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          if (c + 1 < cols && r > 0) s.addElement('spring', id[r][c], id[r][c + 1], { k: 150 });
          if (r + 1 < rows) {
            s.addElement('spring', id[r][c], id[r + 1][c], { k: 150 });
            s.addElement('damper', id[r][c], id[r + 1][c], { c: 0.06 });
            if (c + 1 < cols) {
              s.addElement('spring', id[r][c], id[r + 1][c + 1], { k: 60 });
              s.addElement('spring', id[r][c + 1], id[r + 1][c], { k: 60 });
            }
          }
        }
        return s;
      },
      perturb(s) { const n = s.nodes[s.nodes.length - 1]; n.x += 0.12; n.y -= 0.05; },
    },
    {
      id: 'vazio',
      title: 'Bancada vazia',
      text: 'Monte seu próprio sistema: crie apoios e massas, ligue-os com molas e amortecedores arrastando de um nó a outro, defina forças e excitações de base no painel à direita.',
      theory: 'Dica: com a ferramenta Mola, arrastar de um nó para o vazio cria uma nova massa já conectada.',
      labels: true,
      build() {
        const s = S();
        s.addNode(0, 0, { fixed: true });
        return s;
      },
    },
  ];

  Vib.presets = presets;
})(typeof window !== 'undefined' ? window : globalThis);
