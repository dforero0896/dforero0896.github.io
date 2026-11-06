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
 * Hierarchical variant (`computeWebHierarchy`): the same machinery is run twice
 * on one shared overdensity deposit - a coarse potential web (level 0, large
 * scales) and a finer density web (level 1) - and the two labels are combined
 * into decoupled classes such as 'knots-in-voids' or 'voids-in-knots'.
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

/**
 * Hierarchical (two-level) classification palette.
 *
 * Row = level-0 (coarse, potential phi) environment, column = level-1 (fine,
 * overdensity delta) environment, so the colour at index `row * 3 + col` reads
 * as "<fine>-in-<coarse>" (e.g. index 2 = knots-in-voids, index 6 = voids-in-knots).
 * Each coarse row keeps its own hue while each fine column darkens and
 * saturates it, which makes the 3x3 matrix legible as a legend.
 */
const WEB_HIER_HUE = Object.freeze([
    [212, 0.70],  // level-0 void     - blue
    [36, 0.85],   // level-0 filament - amber
    [352, 0.75]   // level-0 knot     - red
]);

const WEB_HIER_SHADE = Object.freeze([
    [0.76, 0.55], // level-1 void     - pale
    [0.55, 0.95], // level-1 filament - mid
    [0.38, 1.00]  // level-1 knot     - deep
]);

/** HSL (h in degrees, s and l in [0,1]) to an [r,g,b] byte triple. */
function webHslToRgb(hue, sat, lum) {
    const h = ((hue % 360) + 360) % 360;
    const s = Math.max(0, Math.min(1, sat));
    const l = Math.max(0, Math.min(1, lum));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0; let g = 0; let b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    const m = l - c / 2;
    return [
        Math.round(255 * Math.max(0, Math.min(1, r + m))),
        Math.round(255 * Math.max(0, Math.min(1, g + m))),
        Math.round(255 * Math.max(0, Math.min(1, b + m)))
    ];
}

function webBuildHierPalette() {
    const colors = [];
    const alphas = [];
    for (let coarse = 0; coarse < 3; coarse++) {
        const [hue, sat] = WEB_HIER_HUE[coarse];
        for (let fine = 0; fine < 3; fine++) {
            const [lum, satScale] = WEB_HIER_SHADE[fine];
            colors.push(webHslToRgb(hue, sat * satScale, lum));
            // Coarser parents and finer-substructure markers both get a little
            // more weight, keeping the overlay readable under the tracers.
            alphas.push(Math.min(0.5, 0.27 + 0.03 * coarse + 0.05 * fine));
        }
    }
    return { colors, alphas };
}

const _webHierPalette = webBuildHierPalette();

/** RGB colours of the 9 hierarchical classes, index = coarse * 3 + fine. */
const WEB_HIER_COLORS = Object.freeze(_webHierPalette.colors);

/** Overlay alpha of the 9 hierarchical classes, index = coarse * 3 + fine. */
const WEB_HIER_ALPHA = Object.freeze(_webHierPalette.alphas);

function _webNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

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

/** Physical box size in Mpc/h (same convention as the P(k) analysis). */
function webBoxGeometry(simW, simH, pxPerMpc, gridN) {
    const h = typeof PLANCK_H === 'number' ? PLANCK_H : 0.674;
    const LxMpcH = (simW / pxPerMpc) * h;
    const LyMpcH = (simH / pxPerMpc) * h;
    return { LxMpcH, LyMpcH, dxMpcH: LxMpcH / gridN, dyMpcH: LyMpcH / gridN };
}

/**
 * Classify one already-deposited overdensity grid with a single field
 * definition (basis + smoothing scale + threshold).
 *
 * @param {Float64Array} delta - periodic overdensity grid, length gridN^2
 * @param {number} gridN - grid side
 * @param {object} geom - result of webBoxGeometry()
 * @param {object} [opts]
 * @param {'phi'|'delta'} [opts.basis='phi']
 * @param {number} [opts.smoothingMpc=2] - Gaussian smoothing in h^-1 Mpc
 * @param {number} [opts.thresholdSig=0] - threshold in sigma units
 * @param {number} [opts.fixRidgeSig=0.1] - ridge-fix half width in sigma units
 * @returns {{classes: Uint8Array, counts: number[], sigma1: number,
 *            threshold: number, fixRidge: number,
 *            basis: string, smoothingMpc: number}}
 */
function webClassifyGrid(delta, gridN, geom, opts) {
    const o = opts || {};
    const basis = o.basis === 'delta' ? 'delta' : 'phi';
    const smoothingMpc = Math.max(0, o.smoothingMpc === undefined ? 2 : o.smoothingMpc);
    const thresholdSig = o.thresholdSig === undefined ? 0 : o.thresholdSig;
    const fixRidgeSig = o.fixRidgeSig === undefined ? 0.1 : o.fixRidgeSig;

    const gridN2 = gridN * gridN;
    const { LxMpcH, LyMpcH, dxMpcH, dyMpcH } = geom;

    // --- 1. FFT, Gaussian smoothing, and (for phi) Poisson solve ---
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

    return {
        classes,
        counts,
        sigma1,
        threshold: th,
        fixRidge: fr,
        thresholdSig,
        fixRidgeSig,
        basis,
        smoothingMpc
    };
}

/** Empty single-level result, used for degenerate inputs. */
function _webEmptyResult(gridN, simW, simH, basis, smoothingMpc, thresholdSig, fixRidgeSig) {
    return {
        hierarchical: false,
        gridN, simW, simH, basis,
        smoothingMpc,
        thresholdSig,
        fixRidgeSig,
        sigma1: 0,
        threshold: 0,
        fixRidge: 0,
        classes: new Uint8Array(gridN * gridN),
        counts: [0, 0, 0],
        elapsedMs: 0
    };
}

/** Empty two-level result, used for degenerate inputs. */
function _webEmptyHierResult(gridN, simW, simH, coarseMpc, fineMpc, thresholdSig, fixRidgeSig) {
    const gridN2 = gridN * gridN;
    const counts = new Array(9).fill(0);
    return {
        hierarchical: true,
        gridN, simW, simH,
        basis: 'hierarchy',
        smoothingMpc: fineMpc,
        smoothingMpcCoarse: coarseMpc,
        smoothingMpcFine: fineMpc,
        thresholdSig,
        fixRidgeSig,
        sigma1: 0,
        sigma1Coarse: 0,
        sigma1Fine: 0,
        threshold: 0,
        fixRidge: 0,
        classes: new Uint8Array(gridN2),
        hierLevel0: new Uint8Array(gridN2),
        hierLevel1: new Uint8Array(gridN2),
        counts,
        countsLevel0: [0, 0, 0],
        countsLevel1: [0, 0, 0],
        palette: WEB_HIER_COLORS,
        alphas: WEB_HIER_ALPHA,
        elapsedMs: 0
    };
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
 * @param {Float64Array} [opts.deltaGrid] - use this overdensity grid instead of depositing
 * @returns {object} classification result
 */
function computeWebClassification(physX, physY, N, simW, simH, pxPerMpc, opts) {
    const o = opts || {};
    const t0 = _webNow();

    const basis = o.basis === 'delta' ? 'delta' : 'phi';
    const smoothingMpc = Math.max(0, o.smoothingMpc === undefined ? 2 : o.smoothingMpc);
    const thresholdSig = o.threshold === undefined ? 0 : o.threshold;
    const fixRidgeSig = o.fixRidge === undefined ? 0.1 : o.fixRidge;

    const gridN = webChooseGridN(N, o.gridN);
    const gridN2 = gridN * gridN;

    if (!(pxPerMpc > 0) || !(N > 0) || !(simW > 0) || !(simH > 0)) {
        return _webEmptyResult(gridN, simW, simH, basis, smoothingMpc, thresholdSig, fixRidgeSig);
    }

    // --- 1. Overdensity grid (CIC, periodic) ---
    // An externally supplied overdensity grid can be used instead of depositing
    // the tracers (handy for tests and for reusing an already smoothed field).
    const delta = (o.deltaGrid && o.deltaGrid.length === gridN2)
        ? Float64Array.from(o.deltaGrid)
        : webDepositOverdensity(physX, physY, N, gridN, simW, simH);

    const geom = webBoxGeometry(simW, simH, pxPerMpc, gridN);
    const res = webClassifyGrid(delta, gridN, geom, { basis, smoothingMpc, thresholdSig, fixRidgeSig });

    return {
        hierarchical: false,
        gridN, simW, simH, basis,
        smoothingMpc,
        thresholdSig,
        fixRidgeSig,
        sigma1: res.sigma1,
        threshold: res.threshold,
        fixRidge: res.fixRidge,
        classes: res.classes,
        counts: res.counts,
        elapsedMs: _webNow() - t0
    };
}

/**
 * Hierarchical (two-level) cosmic web classification.
 *
 * Level 0 is the large-scale web built from the gravitational potential (phi),
 * which is the natural field for the coarse, large-scale environment. Level 1
 * is the finer web built from the smoothed overdensity (delta), which resolves
 * the substructure inside each level-0 region.
 *
 * The two levels are combined into decoupled classes: the returned `classes`
 * array holds `level0 * 3 + level1` per cell, which reads as
 * "<level-1 class>-in-<level-0 class>" - e.g. index 2 (= 0*3+2) is
 * 'knots-in-voids' (a delta-knot inside a large-scale phi-void) and index 6
 * (= 2*3+0) is 'voids-in-knots'. The single overdensity deposit is shared by both
 * levels, so a hierarchical pass costs about one deposit plus two Hessian
 * evaluations.
 *
 * @param {Float32Array|Array} physX
 * @param {Float32Array|Array} physY
 * @param {number} N
 * @param {number} simW
 * @param {number} simH
 * @param {number} pxPerMpc
 * @param {object} [opts]
 * @param {number} [opts.smoothingMpcCoarse=12] - level-0 (phi) smoothing in h^-1 Mpc
 * @param {number} [opts.smoothingMpcFine=3] - level-1 (delta) smoothing in h^-1 Mpc
 * @param {number} [opts.threshold=0] - threshold in sigma units, applied to both levels
 * @param {number} [opts.fixRidge=0.1] - ridge-fix half width in sigma units
 * @param {number} [opts.gridN=0] - grid side (power of two, auto by default)
 * @param {Float64Array} [opts.deltaGrid] - use this overdensity grid instead of depositing
 * @returns {object} hierarchical classification result
 */
function computeWebHierarchy(physX, physY, N, simW, simH, pxPerMpc, opts) {
    const o = opts || {};
    const t0 = _webNow();

    const coarseMpc = Math.max(0, o.smoothingMpcCoarse === undefined ? 12 : o.smoothingMpcCoarse);
    const fineMpc = Math.max(0, o.smoothingMpcFine === undefined ? 3 : o.smoothingMpcFine);
    const thresholdSig = o.threshold === undefined ? 0 : o.threshold;
    const fixRidgeSig = o.fixRidge === undefined ? 0.1 : o.fixRidge;

    const gridN = webChooseGridN(N, o.gridN);
    const gridN2 = gridN * gridN;

    if (!(pxPerMpc > 0) || !(N > 0) || !(simW > 0) || !(simH > 0)) {
        return _webEmptyHierResult(gridN, simW, simH, coarseMpc, fineMpc, thresholdSig, fixRidgeSig);
    }

    const delta = (o.deltaGrid && o.deltaGrid.length === gridN2)
        ? Float64Array.from(o.deltaGrid)
        : webDepositOverdensity(physX, physY, N, gridN, simW, simH);

    const geom = webBoxGeometry(simW, simH, pxPerMpc, gridN);

    // Level 0: large-scale potential web.
    const level0 = webClassifyGrid(delta, gridN, geom, {
        basis: 'phi', smoothingMpc: coarseMpc, thresholdSig, fixRidgeSig
    });
    // Level 1: finer density web, i.e. the substructure inside each level-0 cell.
    const level1 = webClassifyGrid(delta, gridN, geom, {
        basis: 'delta', smoothingMpc: fineMpc, thresholdSig, fixRidgeSig
    });

    const classes = new Uint8Array(gridN2);
    const counts = new Array(9).fill(0);
    for (let i = 0; i < gridN2; i++) {
        const combined = level0.classes[i] * 3 + level1.classes[i];
        classes[i] = combined;
        counts[combined]++;
    }

    return {
        hierarchical: true,
        gridN, simW, simH,
        basis: 'hierarchy',
        smoothingMpc: fineMpc,
        smoothingMpcCoarse: coarseMpc,
        smoothingMpcFine: fineMpc,
        thresholdSig,
        fixRidgeSig,
        sigma1: level1.sigma1,
        sigma1Coarse: level0.sigma1,
        sigma1Fine: level1.sigma1,
        threshold: level1.threshold,
        fixRidge: level1.fixRidge,
        classes,
        hierLevel0: level0.classes,
        hierLevel1: level1.classes,
        counts,
        countsLevel0: level0.counts,
        countsLevel1: level1.counts,
        palette: WEB_HIER_COLORS,
        alphas: WEB_HIER_ALPHA,
        elapsedMs: _webNow() - t0
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WEB_CLASS,
        WEB_CLASS_KEYS,
        WEB_CLASS_COLORS,
        WEB_CLASS_ALPHA,
        WEB_HIER_HUE,
        WEB_HIER_SHADE,
        WEB_HIER_COLORS,
        WEB_HIER_ALPHA,
        webChooseGridN,
        webDepositOverdensity,
        webEigenvalues2D,
        webHslToRgb,
        webBoxGeometry,
        webClassifyGrid,
        computeWebClassification,
        computeWebHierarchy
    };
}
