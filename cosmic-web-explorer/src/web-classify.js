/**
 * 2D cosmic web classification (T-web), ported from the 3D reference
 * `compute_tweb` in webjax/cwc.py.
 *
 * Reference algorithm (kept 1:1 where the dimensionality allows):
 *   1. Evaluate the Hessian of a scalar field with central finite differences
 *      (the reference default `grad_findiff`).
 *   2. Compute its eigenvalues and sort them descending.
 *   3. Count eigenvalues above a threshold: 0 -> void, 1 -> sheet, 2 ->
 *      filament, 3 -> knot (the reference labels knot=1, filament=2, sheet=3,
 *      void=4 with the same counting rule).
 *   4. Optional ridge fix: eigenvalues within +-fixRidge of the threshold are
 *      treated as "above", which removes ties induced by numerical noise.
 *
 * 2D reduction: the Hessian is 2x2, so only three environments exist:
 *   0 eigenvalues above threshold -> void
 *   1 eigenvalue  above threshold -> filament (the 2D degenerate of a sheet)
 *   2 eigenvalues above threshold -> knot / cluster
 * The reference's sheet class has no 2D counterpart, so it is not emitted.
 *
 * Two input fields are supported, matching "either phi or delta":
 *   - 'phi'   : gravitational potential, obtained from the tracer overdensity
 *               via the Poisson equation phi_hat = -delta_hat / k^2.
 *   - 'delta' : the smoothed tracer overdensity itself, negated so that a
 *               positive Hessian eigenvalue still means "collapsing along that
 *               axis" (a density knot is a maximum of delta, i.e. a minimum of
 *               -delta). Without the sign flip the labels would be inverted.
 * In both cases a Gaussian smoothing of the overdensity (scale `smoothingMpc`)
 * is applied in Fourier space before the Hessian is evaluated, which is what
 * makes the classification meaningful at a chosen scale.
 *
 * Thresholds are expressed in units of the standard deviation of the largest
 * eigenvalue (as in the reference's `compute_tweb_soft`), so the default 0
 * reproduces exactly the reference hard classification while non-zero values
 * remain scale-free.
 *
 * Depends on fft2d() from src/pert2lpt.js.
 */

const WEB_CLASS = Object.freeze({ VOID: 0, FILAMENT: 1, KNOT: 2 });

const WEB_CLASS_KEYS = Object.freeze(['webVoid', 'webFilament', 'webKnot']);

/** RGB colours used for the overlay and for the on-canvas colorbar. */
const WEB_CLASS_COLORS = Object.freeze([
    [59, 130, 246],   // void     - blue
    [245, 158, 11],   // filament - amber
    [239, 68, 68]     // knot     - red
]);

const WEB_CLASS_ALPHA = Object.freeze([0.32, 0.38, 0.48]);

function webFFT2D(re, im, gridN, inverse) {
    if (typeof fft2d === 'function') {
        fft2d(re, im, gridN, inverse);
        return;
    }
    if (typeof require === 'function') {
        require('./pert2lpt').fft2d(re, im, gridN, inverse);
        return;
    }
    throw new Error('web-classify: fft2d is unavailable');
}

/** Nearest power of two inside [64, 512]. */
function webChooseGridN(N, requested) {
    let n = requested | 0;
    if (!n) {
        n = 1 << Math.round(Math.log2(Math.max(64, Math.min(512, Math.sqrt(N)))));
    }
    n = Math.max(32, Math.min(512, n));
    return 1 << Math.round(Math.log2(n));
}

/** CIC deposit of the tracers into a periodic grid, returned as overdensity. */
function webDepositOverdensity(physX, physY, N, gridN, simW, simH, out) {
    const grid = out || new Float64Array(gridN * gridN);
    grid.fill(0);
    const cellW = simW / gridN;
    const cellH = simH / gridN;
    for (let i = 0; i < N; i++) {
        const gx = physX[i] / cellW - 0.5;
        const gy = physY[i] / cellH - 0.5;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const dx = gx - ix;
        const dy = gy - iy;
        const ix0 = ((ix % gridN) + gridN) % gridN;
        const iy0 = ((iy % gridN) + gridN) % gridN;
        const ix1 = (ix0 + 1) % gridN;
        const iy1 = (iy0 + 1) % gridN;
        grid[iy0 * gridN + ix0] += (1 - dx) * (1 - dy);
        grid[iy0 * gridN + ix1] += dx * (1 - dy);
        grid[iy1 * gridN + ix0] += (1 - dx) * dy;
        grid[iy1 * gridN + ix1] += dx * dy;
    }
    const mean = N / (gridN * gridN);
    if (mean > 0) {
        for (let i = 0; i < grid.length; i++) grid[i] = grid[i] / mean - 1;
    }
    return grid;
}

/**
 * 2D eigenvalues of a symmetric Hessian, sorted descending.
 * lambda_pm = (fxx + fyy)/2 +- sqrt(((fxx - fyy)/2)^2 + fxy^2)
 */
function webEigenvalues2D(fxx, fyy, fxy) {
    const mean = 0.5 * (fxx + fyy);
    const d = 0.5 * (fxx - fyy);
    const r = Math.sqrt(d * d + fxy * fxy);
    return [mean + r, mean - r];
}

/**
 * Compute the 2D cosmic web classification of the tracer distribution.
 *
 * @param {Float32Array|Array} physX - tracer x positions (panel pixels)
 * @param {Float32Array|Array} physY - tracer y positions (panel pixels)
 * @param {number} N - number of tracers
 * @param {number} simW - panel width in pixels
 * @param {number} simH - panel height in pixels
 * @param {number} pxPerMpc - pixel-to-Mpc scale (Mpc, h = PLANCK_H)
 * @param {object} [opts]
 * @param {'phi'|'delta'} [opts.basis='phi']
 * @param {number} [opts.smoothingMpc=2] - Gaussian smoothing scale in h^-1 Mpc
 * @param {number} [opts.threshold=0] - eigenvalue threshold in sigma units
 * @param {number} [opts.fixRidge=0.1] - ridge-fix half width in sigma units (0 disables)
 * @param {number} [opts.gridN=0] - grid side (power of two, auto by default)
 * @returns {object} classification result
 */
function computeWebClassification(physX, physY, N, simW, simH, pxPerMpc, opts) {
    const o = opts || {};
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    const basis = o.basis === 'delta' ? 'delta' : 'phi';
    const smoothingMpc = Math.max(0, o.smoothingMpc === undefined ? 2 : o.smoothingMpc);
    const thresholdSig = o.threshold === undefined ? 0 : o.threshold;
    const fixRidgeSig = o.fixRidge === undefined ? 0.1 : o.fixRidge;

    const gridN = webChooseGridN(N, o.gridN);
    const gridN2 = gridN * gridN;

    if (!(pxPerMpc > 0) || !(N > 0) || !(simW > 0) || !(simH > 0)) {
        return {
            gridN, simW, simH, basis, classes: new Uint8Array(gridN2),
            counts: [0, 0, 0], threshold: 0, fixRidge: 0, sigma1: 0,
            smoothingMpc, elapsedMs: 0
        };
    }

    // Physical box size in Mpc/h (same convention as the P(k) analysis).
    const h = typeof PLANCK_H === 'number' ? PLANCK_H : 0.674;
    const LxMpcH = (simW / pxPerMpc) * h;
    const LyMpcH = (simH / pxPerMpc) * h;
    const dxMpcH = LxMpcH / gridN;
    const dyMpcH = LyMpcH / gridN;

    // --- 1. Overdensity grid (CIC, periodic) ---
    // An externally supplied overdensity grid can be used instead of depositing
    // the tracers (handy for tests and for reusing an already smoothed field).
    const delta = (o.deltaGrid && o.deltaGrid.length === gridN2)
        ? Float64Array.from(o.deltaGrid)
        : webDepositOverdensity(physX, physY, N, gridN, simW, simH);

    // --- 2. FFT, Gaussian smoothing, and (for phi) Poisson solve ---
    const re = new Float64Array(gridN2);
    const im = new Float64Array(gridN2);
    re.set(delta);
    webFFT2D(re, im, gridN, false);

    const kx = new Float64Array(gridN);
    const ky = new Float64Array(gridN);
    const twoPi = 2 * Math.PI;
    for (let m = 0; m < gridN; m++) {
        const f = m <= gridN / 2 ? m : m - gridN;
        kx[m] = twoPi * f / LxMpcH;
        ky[m] = twoPi * f / LyMpcH;
    }

    const smooth2 = smoothingMpc * smoothingMpc;
    const fieldRe = new Float64Array(gridN2);
    const fieldIm = new Float64Array(gridN2);

    for (let y = 0; y < gridN; y++) {
        const kys = ky[y];
        const ky2 = kys * kys;
        const off = y * gridN;
        for (let x = 0; x < gridN; x++) {
            const kxs = kx[x];
            const k2 = kxs * kxs + ky2;
            const idx = off + x;
            if (k2 === 0) {
                // Remove the mean mode: no zero-mode collapse.
                fieldRe[idx] = 0;
                fieldIm[idx] = 0;
                continue;
            }
            const g = Math.exp(-0.5 * k2 * smooth2);
            const dr = re[idx] * g;
            const di = im[idx] * g;
            if (basis === 'phi') {
                // phi_hat = -delta_hat / k^2
                fieldRe[idx] = -dr / k2;
                fieldIm[idx] = -di / k2;
            } else {
                // delta field negated: a positive Hessian eigenvalue then still
                // marks a collapsing (overdense) direction.
                fieldRe[idx] = -dr;
                fieldIm[idx] = -di;
            }
        }
    }

    webFFT2D(fieldRe, fieldIm, gridN, true);

    // --- 3. Hessian by central finite differences (periodic) ---
    // Mirrors the reference's grad_findiff applied twice: fxx = grad(grad f).
    const lam1 = new Float64Array(gridN2);
    const lam2 = new Float64Array(gridN2);

    const invDx2 = 1 / (dxMpcH * dxMpcH);
    const invDy2 = 1 / (dyMpcH * dyMpcH);
    const inv4DxDy = 1 / (4 * dxMpcH * dyMpcH);

    for (let y = 0; y < gridN; y++) {
        const ym = ((y - 1) + gridN) % gridN;
        const yp = (y + 1) % gridN;
        const off = y * gridN;
        const offM = ym * gridN;
        const offP = yp * gridN;
        for (let x = 0; x < gridN; x++) {
            const xm = ((x - 1) + gridN) % gridN;
            const xp = (x + 1) % gridN;

            const f = fieldRe[off + x];
            const fxp = fieldRe[off + xp];
            const fxm = fieldRe[off + xm];
            const fyp = fieldRe[offP + x];
            const fym = fieldRe[offM + x];

            const fxx = (fxp - 2 * f + fxm) * invDx2;
            const fyy = (fyp - 2 * f + fym) * invDy2;
            const fxy = (fieldRe[offP + xp] - fieldRe[offP + xm]
                - fieldRe[offM + xp] + fieldRe[offM + xm]) * inv4DxDy;

            const ev = webEigenvalues2D(fxx, fyy, fxy);
            lam1[off + x] = ev[0];
            lam2[off + x] = ev[1];
        }
    }

    // --- 4. Classification (threshold in units of std(lambda_1)) ---
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < gridN2; i++) { sum += lam1[i]; sumSq += lam1[i] * lam1[i]; }
    const mean1 = sum / gridN2;
    const var1 = Math.max(0, sumSq / gridN2 - mean1 * mean1);
    const sigma1 = Math.sqrt(var1);

    const th = thresholdSig * sigma1;
    const fr = Math.max(0, fixRidgeSig) * sigma1;

    const classes = new Uint8Array(gridN2);
    const counts = [0, 0, 0];

    const lmin = th - fr;
    const lmax = th + fr;

    for (let i = 0; i < gridN2; i++) {
        const l1 = lam1[i];
        const l2 = lam2[i];
        let web;
        if (l1 >= th) {
            web = l2 >= th ? WEB_CLASS.KNOT : WEB_CLASS.FILAMENT;
        } else {
            web = WEB_CLASS.VOID;
        }

        // Ridge fix: eigenvalues inside the band around the threshold count as
        // "above", which suppresses noisy ties at the boundary.
        if (fr > 0) {
            const in2 = l2 > lmin && l2 < lmax;
            if (l1 > th && in2) web = WEB_CLASS.FILAMENT;
            if (l1 >= th && l2 > th) web = WEB_CLASS.KNOT;
            if (l1 < th && l2 <= th) web = WEB_CLASS.VOID;
        }

        classes[i] = web;
        counts[web]++;
    }

    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return {
        gridN, simW, simH, basis,
        smoothingMpc,
        thresholdSig,
        fixRidgeSig,
        sigma1,
        threshold: th,
        fixRidge: fr,
        classes,
        counts,
        elapsedMs: t1 - t0
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WEB_CLASS,
        WEB_CLASS_KEYS,
        WEB_CLASS_COLORS,
        WEB_CLASS_ALPHA,
        webChooseGridN,
        webDepositOverdensity,
        webEigenvalues2D,
        computeWebClassification
    };
}
