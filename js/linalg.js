/* Álgebra linear densa: autovalores simétricos e sistemas lineares.
 * symEig: tridiagonalização de Householder + QL implícito (adaptado do JAMA, domínio público). */
(function (root) {
  'use strict';
  const Vib = root.Vib = root.Vib || {};

  function tred2(V, d, e, n) {
    for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
    for (let i = n - 1; i > 0; i--) {
      let scale = 0, h = 0;
      for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
      if (scale === 0) {
        e[i] = d[i - 1];
        for (let j = 0; j < i; j++) {
          d[j] = V[i - 1][j];
          V[i][j] = 0;
          V[j][i] = 0;
        }
      } else {
        for (let k = 0; k < i; k++) {
          d[k] /= scale;
          h += d[k] * d[k];
        }
        let f = d[i - 1];
        let g = Math.sqrt(h);
        if (f > 0) g = -g;
        e[i] = scale * g;
        h -= f * g;
        d[i - 1] = f - g;
        for (let j = 0; j < i; j++) e[j] = 0;
        for (let j = 0; j < i; j++) {
          f = d[j];
          V[j][i] = f;
          g = e[j] + V[j][j] * f;
          for (let k = j + 1; k <= i - 1; k++) {
            g += V[k][j] * d[k];
            e[k] += V[k][j] * f;
          }
          e[j] = g;
        }
        f = 0;
        for (let j = 0; j < i; j++) {
          e[j] /= h;
          f += e[j] * d[j];
        }
        const hh = f / (h + h);
        for (let j = 0; j < i; j++) e[j] -= hh * d[j];
        for (let j = 0; j < i; j++) {
          f = d[j];
          g = e[j];
          for (let k = j; k <= i - 1; k++) V[k][j] -= (f * e[k] + g * d[k]);
          d[j] = V[i - 1][j];
          V[i][j] = 0;
        }
      }
      d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
      V[n - 1][i] = V[i][i];
      V[i][i] = 1;
      const h = d[i + 1];
      if (h !== 0) {
        for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
        for (let j = 0; j <= i; j++) {
          let g = 0;
          for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
          for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
        }
      }
      for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
    }
    for (let j = 0; j < n; j++) {
      d[j] = V[n - 1][j];
      V[n - 1][j] = 0;
    }
    V[n - 1][n - 1] = 1;
    e[0] = 0;
  }

  function tql2(V, d, e, n) {
    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    let f = 0, tst1 = 0;
    const eps = Math.pow(2, -52);
    for (let l = 0; l < n; l++) {
      tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
      let m = l;
      while (m < n) {
        if (Math.abs(e[m]) <= eps * tst1) break;
        m++;
      }
      if (m > l) {
        let iter = 0;
        do {
          if (++iter > 100) throw new Error('symEig: sem convergência');
          let g = d[l];
          let p = (d[l + 1] - g) / (2 * e[l]);
          let r = Math.hypot(p, 1);
          if (p < 0) r = -r;
          d[l] = e[l] / (p + r);
          d[l + 1] = e[l] * (p + r);
          const dl1 = d[l + 1];
          let h = g - d[l];
          for (let i = l + 2; i < n; i++) d[i] -= h;
          f += h;
          p = d[m];
          let c = 1, c2 = c, c3 = c;
          const el1 = e[l + 1];
          let s = 0, s2 = 0;
          for (let i = m - 1; i >= l; i--) {
            c3 = c2;
            c2 = c;
            s2 = s;
            g = c * e[i];
            h = c * p;
            r = Math.hypot(p, e[i]);
            e[i + 1] = s * r;
            s = e[i] / r;
            c = p / r;
            p = c * d[i] - s * g;
            d[i + 1] = h + s * (c * g + s * d[i]);
            for (let k = 0; k < n; k++) {
              h = V[k][i + 1];
              V[k][i + 1] = s * V[k][i] + c * h;
              V[k][i] = c * V[k][i] - s * h;
            }
          }
          p = -s * s2 * c3 * el1 * e[l] / dl1;
          e[l] = s * p;
          d[l] = c * p;
        } while (Math.abs(e[l]) > eps * tst1);
      }
      d[l] += f;
      e[l] = 0;
    }
    for (let i = 0; i < n - 1; i++) {
      let k = i, p = d[i];
      for (let j = i + 1; j < n; j++) if (d[j] < p) { k = j; p = d[j]; }
      if (k !== i) {
        d[k] = d[i];
        d[i] = p;
        for (let j = 0; j < n; j++) {
          p = V[j][i];
          V[j][i] = V[j][k];
          V[j][k] = p;
        }
      }
    }
  }

  /* A: matriz simétrica n×n (array de linhas). Retorna autovalores crescentes
   * e V com V[i][r] = componente i do autovetor r (ortonormais). */
  function symEig(A) {
    const n = A.length;
    if (n === 0) return { values: new Float64Array(0), vectors: [] };
    const V = A.map(r => Float64Array.from(r));
    const d = new Float64Array(n), e = new Float64Array(n);
    tred2(V, d, e, n);
    tql2(V, d, e, n);
    return { values: d, vectors: V };
  }

  /* Eliminação de Gauss com pivotamento parcial. A e b são destruídos.
   * Retorna x ou null se a matriz for singular. */
  function solve(A, b) {
    const n = b.length;
    let amax = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) amax = Math.max(amax, Math.abs(A[i][j]));
    const tol = 1e-14 * (amax || 1);
    for (let c = 0; c < n; c++) {
      let p = c, pv = Math.abs(A[c][c]);
      for (let r = c + 1; r < n; r++) {
        const v = Math.abs(A[r][c]);
        if (v > pv) { pv = v; p = r; }
      }
      if (pv <= tol) return null;
      if (p !== c) {
        const tr = A[p]; A[p] = A[c]; A[c] = tr;
        const tb = b[p]; b[p] = b[c]; b[c] = tb;
      }
      const rc = A[c], inv = 1 / rc[c];
      for (let r = c + 1; r < n; r++) {
        const rr = A[r], f = rr[c] * inv;
        if (f === 0) continue;
        for (let j = c; j < n; j++) rr[j] -= f * rc[j];
        b[r] -= f * b[c];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      const ri = A[i];
      for (let j = i + 1; j < n; j++) s -= ri[j] * x[j];
      x[i] = s / ri[i];
    }
    return x;
  }

  function matrix(n, m) {
    const M = new Array(n);
    for (let i = 0; i < n; i++) M[i] = new Float64Array(m === undefined ? n : m);
    return M;
  }

  /* FFT radix-2 in-place (re, im de comprimento potência de 2). */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  Vib.linalg = { symEig, solve, matrix, fft };
})(typeof window !== 'undefined' ? window : globalThis);
