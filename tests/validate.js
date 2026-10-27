/* Validação do núcleo contra soluções analíticas.
 * Uso: node tests/validate.js */
'use strict';
for (const f of ['linalg', 'model', 'physics', 'analysis', 'presets']) require('../js/' + f + '.js');
const Vib = globalThis.Vib;
const TAU = 2 * Math.PI;

let fails = 0;
function check(name, got, want, relTol) {
  const err = Math.abs(got - want) / Math.max(Math.abs(want), 1e-12);
  const ok = err <= relTol;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}: obtido ${got.toPrecision(7)}, esperado ${want.toPrecision(7)} (erro rel. ${err.toExponential(2)})`);
}

function loadPreset(id) {
  const p = Vib.presets.find(q => q.id === id);
  const s = p.build();
  const eq = Vib.analysis.equilibrium(s);
  if (eq.ok) s.nodes.forEach((n, i) => { if (!n.fixed) { n.x = eq.P[2 * i]; n.y = eq.P[2 * i + 1]; } });
  return { s, eq, p };
}

function run(s, T, sample) {
  const e = new Vib.physics.Engine(s);
  e.rebase();
  const frame = 1 / 60;
  let maxErr = 0;
  while (e.t < T - 1e-12) {
    if (!e.advance(Math.min(frame, T - e.t))) throw new Error('divergiu');
    maxErr = Math.max(maxErr, e.energyErr);
    if (sample) sample(e);
  }
  return { e, maxErr };
}

// 1) Oscilador livre: x(t) = x0 cos(ωt)
{
  const { s } = loadPreset('livre');
  const m = s.nodes[1], x0 = 0.1;
  const xe = m.x;
  m.x += x0;
  const T = 10;
  const { maxErr } = run(s, T);
  check('1 GDL x(10 s)', m.x - xe, x0 * Math.cos(10 * T), 1e-4);
  check('1 GDL balanço de energia (erro ≈ 0)', maxErr + 1, 1, 1e-5);
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  check('1 GDL fn modal', an.modes[0].f, 10 / TAU, 1e-9);
}

// 2) Amortecido: decaimento x(t)=e^{-ζωt}(x0 cos ωd t + ζω x0/ωd sin ωd t)
{
  const s = new Vib.Scene();
  s.gravity = false;
  const A = s.addNode(0, 0, { fixed: true });
  const m = s.addNode(0.6, 0, { m: 2, lockY: true });
  s.addElement('spring', A.id, m.id, { k: 200 });
  s.addElement('damper', A.id, m.id, { c: 4 });   // ζ = 4/(2·√400) = 0,1
  const w = 10, z = 0.1, wd = w * Math.sqrt(1 - z * z), x0 = 0.1;
  m.x += x0;
  const T = 3;
  const { maxErr } = run(s, T);
  const exact = Math.exp(-z * w * T) * (x0 * Math.cos(wd * T) + z * w * x0 / wd * Math.sin(wd * T));
  check('amortecido x(3 s) (erro relativo a x0)', (m.x - 0.6 - exact) / x0 + 1, 1, 1e-5);
  check('amortecido balanço c/ dissipação', maxErr + 1, 1, 1e-5);
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  check('amortecido ζ modal', an.modes[0].zeta, 0.1, 1e-9);
}

// 3) Gravidade: deflexão estática
{
  const { s, eq } = loadPreset('vertical');
  check('deflexão estática (y_eq)', eq.P[3], -(0.6 + 9.81 / 100), 1e-9);
}

// 4) Acoplados: dois modos
{
  const { s } = loadPreset('batimento');
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  check('batimento f1', an.modes[0].f, 10 / TAU, 1e-9);
  check('batimento f2', an.modes[1].f, Math.sqrt(116) / TAU, 1e-9);
}

// 5) Pêndulo elástico: frequências linearizadas
{
  const { s } = loadPreset('pendulo');
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  const L = 0.75 + 9.81 / 39.24;
  check('pêndulo √(g/L)', an.modes[0].f, Math.sqrt(9.81 / L) / TAU, 1e-6);
  check('pêndulo √(k/m)', an.modes[1].f, Math.sqrt(39.24) / TAU, 1e-6);
  // não linear: energia conservada em grandes amplitudes
  s.nodes[1].y -= 0.12; s.nodes[1].x += 0.05;
  const { maxErr } = run(s, 20);
  check('pêndulo elástico 20 s: balanço de energia', maxErr + 1, 1, 1e-5);
}

// 6) Corda discreta: modos senoidais
{
  const { s } = loadPreset('corda');
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  for (const j of [1, 2, 5, 14]) {
    const w = 2 * Math.sqrt(10 / (0.05 * 0.2)) * Math.sin(j * Math.PI / 30);
    check(`corda modo ${j}`, an.modes[j - 1].f, w / TAU, 1e-6);
  }
}

// 7) Forçado: amplitude de regime ≈ previsão da FRF
{
  const s = new Vib.Scene();
  s.gravity = false;
  const A = s.addNode(0, 0, { fixed: true });
  const m = s.addNode(0.6, 0, { m: 1, lockY: true, force: { type: 'harmonic', F0: 1, f: 1.3, angle: 0, phase: 0 } });
  s.addElement('spring', A.id, m.id, { k: 100 });
  s.addElement('damper', A.id, m.id, { c: 2 });
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  const r = Vib.analysis.frf(s, an, m.id, { fmin: 1.3, fmax: 1.3, npts: 1 });
  const w = TAU * 1.3;
  const X = 1 / Math.hypot(100 - w * w, 2 * w);
  check('FRF direta |X|', r.ax[0], X, 1e-9);
  let amp = 0;
  run(s, 40, e => { if (e.t > 30) amp = Math.max(amp, Math.abs(m.x - 0.6)); });
  check('simulação: amplitude em regime', amp, X, 2e-3);
}

// 8) Excitação de base: transmissibilidade
{
  const { s } = loadPreset('base');
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  const r = Vib.analysis.frf(s, an, s.nodes[1].id, { fmin: 2, fmax: 2, npts: 1 });
  const wn = 10, z = 0.1, rr = TAU * 2 / wn;
  const TR = Math.sqrt((1 + (2 * z * rr) ** 2) / ((1 - rr * rr) ** 2 + (2 * z * rr) ** 2));
  check('transmissibilidade (FRF)', r.ay[0] / 0.02, TR, 1e-9);
  const yEq = s.nodes[1].y;
  let amp = 0;
  run(s, 40, e => { if (e.t > 30) amp = Math.max(amp, Math.abs(s.nodes[1].y - yEq)); });
  check('transmissibilidade (simulação)', amp / 0.02, TR, 3e-3);
}

// 9) FRF modal ≈ direta (amortecimento proporcional)
{
  const { s } = loadPreset('batimento');
  s.elements.filter(e => e.type === 'spring').forEach(e => s.addElement('damper', e.a, e.b, { c: e.k * 0.004 }));
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  const id = s.nodes[1].id;
  const a = Vib.analysis.frf(s, an, id, { fmin: 1.65, fmax: 1.65, npts: 1 });
  const b = Vib.analysis.frf(s, an, id, { fmin: 1.65, fmax: 1.65, npts: 1, method: 'modal' });
  check('FRF superposição modal = direta (C ∝ K)', b.ax[0], a.ax[0], 1e-9);
}

// 10) Pórtico: modal, ζ e simulação estáveis
{
  const { s, eq } = loadPreset('predio');
  if (!eq.ok) { fails++; console.log('FALHA equilíbrio pórtico'); }
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  console.log('     pórtico: f =', an.modes.slice(0, 4).map(m => m.f.toFixed(3) + ' Hz').join(', '));
  const { maxErr } = run(s, 5);
  check('pórtico balanço de energia c/ base móvel', maxErr + 1, 1, 1e-4);
}

// 11) Malha: equilíbrio e modal
{
  const { s, eq } = loadPreset('malha');
  const an = Vib.analysis.modal(s, Vib.analysis.positions(s));
  console.log(`     malha: equilíbrio ${eq.ok} em ${eq.iters} it., ${an.modes.length} modos, f1 = ${an.modes[0].f.toFixed(3)} Hz`);
  s.nodes[s.nodes.length - 1].x += 0.1;
  const t0 = Date.now();
  const { maxErr } = run(s, 3);
  console.log(`     malha: 3 s simulados em ${Date.now() - t0} ms`);
  check('malha balanço de energia', maxErr + 1, 1, 1e-4);
}

// 12) Mecanismo sem equilíbrio é detectado
{
  const s = new Vib.Scene();
  s.addNode(0, 0, { m: 1 });
  const eq = Vib.analysis.equilibrium(s);
  if (eq.ok) { fails++; console.log('FALHA massa livre deveria não ter equilíbrio'); }
  else console.log('ok   massa livre sob gravidade: sem equilíbrio (' + eq.reason + ')');
}

// 13) Serialização ida e volta
{
  const { s } = loadPreset('absorvedor');
  const s2 = Vib.Scene.deserialize(JSON.parse(JSON.stringify(s.serialize())));
  const a1 = Vib.analysis.modal(s, Vib.analysis.positions(s)), a2 = Vib.analysis.modal(s2, Vib.analysis.positions(s2));
  check('serialização preserva modos', a2.modes[1].f, a1.modes[1].f, 1e-12);
}

console.log(fails ? `\n${fails} verificação(ões) falharam.` : '\nTodas as verificações passaram.');
process.exit(fails ? 1 : 0);
