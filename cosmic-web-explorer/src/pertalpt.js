/**
 * Cosmic Web Explorer
 * * A real-time cosmological visualization tool.
 * Copyright (c) 2026 Nico Schuster. Licensed under the GNU AGPLv3.
 * * ---
 * This tool is shared for educational and research purposes. It is provided
 * "as-is," without any warranty of any kind.
 * * For full license terms and citation instructions, please visit:
 * https://github.com/nicosmo/cosmic_web_explorer
 */

// ============================================================
// pertalpt.js -- Augmented Lagrangian Perturbation Theory (ALPT)
//               2D adaptation for the Cosmic Web Explorer
// ============================================================
// ALPT (Kitaura & Hess 2013, MNRAS 435, L78) splits the displacement
// into a long-range 2LPT part and a short-range spherical-collapse (SC)
// part, joined by a Gaussian filter K(q, rS):
//
//   Psi_ALPT = K * Psi_2LPT + (1 - K) * Psi_SC
//
// The paper's SC relation for the stretching parameter psi = div(Psi) is
//
//   psi_SC = 3 * [ (1 - (2/3) D1 delta)^(1/2) - 1 ]          (Eq. 6)
//
// which is a 3D relation.  This visualization is a 2D projected
// ("2.5D") simulation, so we use the d-dimensional continuation
//
//   psi_d = d * [ (1 - (2/d) delta)^(1/2) - 1 ]
//
// evaluated at d = 2:
//
//   psi_SC,2D = 2 * [ (1 - delta)^(1/2) - 1 ]
//
// This is NOT the published 3D equation.  It is the d = 2 continuation,
// chosen because it preserves the linear limit (psi ~ -delta) and the
// point-collapse limit (psi -> -2 at delta = 1), and because it is the
// exact dimension of this simulation's density field.  It should be
// described as a 2D adaptation, not as the original ALPT model.
//
// Geometry: this module works in *pixel* displacement units, matching
// pert2lpt.js.  At growth factor D the 2LPT base displacement is
//
//   d_2LPT = s1 * D * densityFactor + s2 * (-3/7) * D^2 * densityFactor
//
// so the linear density contrast is delta = -div(d_1) and the SC term is
// evaluated with D(t) delta_0 at every redshift.  That time dependence is
// an extension of the published z = 0 one-step model, required because
// this app continuously grows the LPT field with D(t).
//
// Because the SC transformation is nonlinear in D, the table is sampled
// at a set of growth factors and interpolated per particle at runtime.
// ============================================================

const ALPT_D_MAX = 1.05;
const ALPT_SAMPLE_COUNT = 13;
const ALPT_GRID_MIN = 64;
const ALPT_GRID_MAX = 256;
const ALPT_2D_DIM = 2;

// Local gradient step (after the ALPT build, following the DESI-mock
// construction referenced in the README). Every particle takes one small
// step of fixed length along the *unit* density gradient, gated by the
// smoothed overdensity and by the reliability of the gradient direction.
const ALPT_LOCAL_STEP_SPACINGS = 1.5; // eta in units of mean particle spacing
const ALPT_LOCAL_BLUR = 2;            // smoothing passes before differencing
const ALPT_LOCAL_DENS_LO = -0.5;      // no step below this smoothed overdensity
const ALPT_LOCAL_DENS_HI = 0.5;       // full step above this smoothed overdensity
const ALPT_LOCAL_SOFT = 0.6;          // fade where |grad| -> 0 (times its rms)
const ALPT_LOCAL_SIGN = 1;            // +1 toward knots, -1 outward

/**
 * 2D spherical-collapse stretching parameter.
 * d = 2 continuation of Kitaura & Hess (2013) Eq. (6).
 *
 * Linear limit: psi ~ -delta.
 * Collapse limit: psi -> -2 as delta -> 1 (and is clamped above).
 *
 * @param {number} delta - linear density contrast D1 * delta^(1)
 * @returns {number} divergence of the SC displacement field
 */
function alptPsiSC2D(delta) {
    const arg = 1 - delta;
    if (arg <= 0) return -ALPT_2D_DIM;
    return ALPT_2D_DIM * (Math.sqrt(arg) - 1);
}

/**
 * FFT dispatch: the browser loads pert2lpt.js first, so fft2d is global.
 * Node tests load pert2lpt.js via require instead.
 */
function alptFFT2D(re, im, n, inverse) {
    if (typeof fft2d === 'function') {
        fft2d(re, im, n, inverse);
        return;
    }
    if (typeof require === 'function') {
        require('./pert2lpt').fft2d(re, im, n, inverse);
        return;
    }
    throw new Error('pertalpt: fft2d is unavailable');
}

/**
 * Grid side for the ALPT table. ALPT is smoother than the 2LPT field
 * (it is filtered on rS), so it does not need the 512^2 cap used by 2LPT.
 */
function alptChooseGridN(N) {
    const raw = Math.sqrt(Math.max(4, N));
    const pow2 = 1 << Math.round(Math.log2(Math.max(8, raw)));
    return Math.max(ALPT_GRID_MIN, Math.min(ALPT_GRID_MAX, pow2));
}

/**
 * One separable 3x3 binomial blur pass on a periodic grid. The vertical
 * pass writes back into `src`, so after the call the result is in `src`.
 */
function alptBlurPeriodic(src, tmp, n) {
    for (let y = 0; y < n; y++) {
        const row = y * n;
        for (let x = 0; x < n; x++) {
            const l = src[row + ((x - 1 + n) % n)];
            const r = src[row + ((x + 1) % n)];
            const c = src[row + x];
            tmp[row + x] = (l + 2 * c + r) * 0.25;
        }
    }
    for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
            const u = tmp[((y - 1 + n) % n) * n + x];
            const d = tmp[((y + 1) % n) * n + x];
            const c = tmp[y * n + x];
            src[y * n + x] = (u + 2 * c + d) * 0.25;
        }
    }
}

/**
 * Build a growth-factor table of ALPT displacement grids.
 *
 * The s1/s2 fields are deposited once; the divergence grids are linear in
 * s1/s2, so every D sample only needs pointwise scaling, two FFTs and one
 * inverse FFT. The k = 0 mode is explicitly zeroed, which also removes the
 * nonzero mean of the SC term (a global contraction would be unphysical in
 * a periodic box).
 *
 * @param {Object} opts
 * @param {Float32Array} opts.tracerForces   - 1LPT displacement [sx,sy] x N
 * @param {Float32Array} opts.tracerForces2  - 2LPT displacement [sx2,sy2] x N
 * @param {Array} opts.initialTracers        - particles with {qx,qy} in pixels
 * @param {number} opts.N                    - particle count
 * @param {number} opts.simW                 - panel width in pixels
 * @param {number} opts.simH                 - panel height in pixels
 * @param {number} opts.densityFactor        - (Omega_m / 0.3)^0.6
 * @param {number} [opts.dispNorm]           - full per-D amplitude
 *                                             (DISP_SCALE_FACTOR*rawScale*densityFactor);
 *                                             defaults to densityFactor
 * @param {number} opts.rSpx                 - Gaussian smoothing radius in pixels
 * @param {boolean} [opts.localStep]         - add the small-scale gradient step
 * @param {number} [opts.localStepLen]       - step length eta in pixels
 *                                             (default 1.5 mean particle spacings)
 * @param {number} [opts.dMax]               - max growth factor (default 1.05)
 * @param {number} [opts.samples]            - table samples (default 13)
 * @param {number} [opts.gridN]              - force grid side (testing)
 * @returns {Object} table usable by sampleALPTDisplacement
 */
function buildALPTTable(opts) {
    const {
        tracerForces,
        tracerForces2,
        initialTracers,
        N,
        simW,
        simH,
        densityFactor = 1,
        dispNorm = null,
        rSpx = 0,
        localStep = false,
        localStepLen = null,
        dMax = ALPT_D_MAX,
        samples = ALPT_SAMPLE_COUNT,
        gridN: forcedGridN = null
    } = opts;

    if (!N || !tracerForces || !tracerForces2) {
        throw new Error('buildALPTTable: missing displacement fields');
    }

    const gridN = forcedGridN || alptChooseGridN(N);
    const gridN2 = gridN * gridN;
    const cellW = simW / gridN;
    const cellH = simH / gridN;
    // Physical displacement per unit D; must match the renderer's
    // scaleFactor = 120 * min(1, rawScale) * densityFactor.
    const baseAmp = typeof dispNorm === 'number' ? dispNorm : densityFactor;

    // --- Deposit s1 and s2 once (CIC) ---
    const s1x = new Float64Array(gridN2);
    const s1y = new Float64Array(gridN2);
    const s2x = new Float64Array(gridN2);
    const s2y = new Float64Array(gridN2);
    const weight = new Float64Array(gridN2);

    for (let i = 0; i < N; i++) {
        const g = initialTracers[i];
        const gx = g.qx / cellW - 0.5;
        const gy = g.qy / cellH - 0.5;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;

        const v1x = tracerForces[i * 2];
        const v1y = tracerForces[i * 2 + 1];
        const v2x = tracerForces2[i * 2];
        const v2y = tracerForces2[i * 2 + 1];

        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                const wx = dx === 0 ? (1 - fx) : fx;
                const wy = dy === 0 ? (1 - fy) : fy;
                const w = wx * wy;
                let cx = (ix + dx) % gridN; if (cx < 0) cx += gridN;
                let cy = (iy + dy) % gridN; if (cy < 0) cy += gridN;
                const idx = cy * gridN + cx;
                s1x[idx] += v1x * w;
                s1y[idx] += v1y * w;
                s2x[idx] += v2x * w;
                s2y[idx] += v2y * w;
                weight[idx] += w;
            }
        }
    }

    for (let i = 0; i < gridN2; i++) {
        if (weight[i] > 0) {
            const inv = 1 / weight[i];
            s1x[i] *= inv; s1y[i] *= inv;
            s2x[i] *= inv; s2y[i] *= inv;
        }
    }

    // --- Divergences (independent of D) via central differences ---
    const div1 = new Float64Array(gridN2);
    const div2 = new Float64Array(gridN2);
    for (let y = 0; y < gridN; y++) {
        for (let x = 0; x < gridN; x++) {
            const idx = y * gridN + x;
            const xp = y * gridN + ((x + 1) % gridN);
            const xm = y * gridN + ((x - 1 + gridN) % gridN);
            const yp = ((y + 1) % gridN) * gridN + x;
            const ym = ((y - 1 + gridN) % gridN) * gridN + x;
            div1[idx] = (s1x[xp] - s1x[xm]) / (2 * cellW)
                      + (s1y[yp] - s1y[ym]) / (2 * cellH);
            div2[idx] = (s2x[xp] - s2x[xm]) / (2 * cellW)
                      + (s2y[yp] - s2y[ym]) / (2 * cellH);
        }
    }

    const Ds = new Float64Array(samples);
    const fields = new Array(samples);
    const kxBase = 2 * Math.PI / simW;
    const kyBase = 2 * Math.PI / simH;
    const rS2 = rSpx * rSpx;

    // Scratch arrays reused across D samples.
    const re1 = new Float64Array(gridN2);
    const im1 = new Float64Array(gridN2);
    const re2 = new Float64Array(gridN2);
    const im2 = new Float64Array(gridN2);
    const phiRe = new Float64Array(gridN2);
    const phiIm = new Float64Array(gridN2);
    const disp = new Float32Array(gridN2 * 2);

    for (let s = 0; s < samples; s++) {
        const D = samples === 1 ? 0 : (s / (samples - 1)) * dMax;
        Ds[s] = D;

        // d1 = A * s1, d2 = B * s2, with A = D * baseAmp
        const A = D * baseAmp;
        const B = (-3 / 7) * D * A;

        for (let i = 0; i < gridN2; i++) {
            re1[i] = A * div1[i] + B * div2[i];      // div(d_2LPT)
            im1[i] = 0;
            const delta = -A * div1[i];              // linear density
            re2[i] = alptPsiSC2D(delta);             // SC stretching
            im2[i] = 0;
        }

        alptFFT2D(re1, im1, gridN, false);
        alptFFT2D(re2, im2, gridN, false);

        // psi_ALPT(k) = K * psi_2LPT + (1 - K) * psi_SC
        // phi(k) = -psi_ALPT(k) / k^2 ; d = grad(phi)
        for (let iy = 0; iy < gridN; iy++) {
            for (let ix = 0; ix < gridN; ix++) {
                const idx = iy * gridN + ix;
                const kx = (ix <= gridN / 2 ? ix : ix - gridN) * kxBase;
                const ky = (iy <= gridN / 2 ? iy : iy - gridN) * kyBase;
                const k2 = kx * kx + ky * ky;

                if (k2 < 1e-30) {
                    phiRe[idx] = 0;
                    phiIm[idx] = 0;
                    continue;
                }

                const K = rS2 > 0 ? Math.exp(-0.5 * rS2 * k2) : 1;
                const oneMinusK = 1 - K;
                const cRe = K * re1[idx] + oneMinusK * re2[idx];
                const cIm = K * im1[idx] + oneMinusK * im2[idx];

                phiRe[idx] = -cRe / k2;
                phiIm[idx] = -cIm / k2;
            }
        }

        alptFFT2D(phiRe, phiIm, gridN, true);

        // Central-difference gradient of the (real) displacement potential.
        for (let y = 0; y < gridN; y++) {
            for (let x = 0; x < gridN; x++) {
                const idx = y * gridN + x;
                const xp = y * gridN + ((x + 1) % gridN);
                const xm = y * gridN + ((x - 1 + gridN) % gridN);
                const yp = ((y + 1) % gridN) * gridN + x;
                const ym = ((y - 1 + gridN) % gridN) * gridN + x;
                disp[idx * 2] = (phiRe[xp] - phiRe[xm]) / (2 * cellW);
                disp[idx * 2 + 1] = (phiRe[yp] - phiRe[ym]) / (2 * cellH);
            }
        }

        fields[s] = disp.slice();
    }

    const table = {
        gridN,
        simW,
        simH,
        cellW,
        cellH,
        Ds,
        dMax,
        samples,
        densityFactor,
        rSpx,
        fields,
        localStep: null
    };

    // --- Optional small-scale gradient step ---
    // Displace every particle to the last sampled growth factor, measure the
    // smoothed overdensity there, and store one fixed-length nudge along the
    // unit gradient. The nudge is time-ramped as D^3 at sample time, so it
    // switches on as the field collapses (same construction as the reference
    // implementation's LOCAL_STEP).
    if (localStep) {
        const spacing = Math.sqrt((simW * simH) / Math.max(1, N));
        const eta = (typeof localStepLen === 'number' && localStepLen > 0)
            ? localStepLen
            : ALPT_LOCAL_STEP_SPACINGS * spacing;

        const maxDisp = sampleALPTDisplacement(table, initialTracers, N, dMax);

        const dens = new Float64Array(gridN2);
        for (let i = 0; i < N; i++) {
            const px = initialTracers[i].qx + maxDisp[i * 2];
            const py = initialTracers[i].qy + maxDisp[i * 2 + 1];
            const gx = px / cellW - 0.5;
            const gy = py / cellH - 0.5;
            const ix = Math.floor(gx);
            const iy = Math.floor(gy);
            const fx = gx - ix;
            const fy = gy - iy;
            for (let dy = 0; dy <= 1; dy++) {
                for (let dx = 0; dx <= 1; dx++) {
                    const w = (dx === 0 ? (1 - fx) : fx) * (dy === 0 ? (1 - fy) : fy);
                    let cx = (ix + dx) % gridN; if (cx < 0) cx += gridN;
                    let cy = (iy + dy) % gridN; if (cy < 0) cy += gridN;
                    dens[cy * gridN + cx] += w;
                }
            }
        }

        const densMean = N / gridN2;
        for (let i = 0; i < gridN2; i++) dens[i] = dens[i] / densMean - 1;

        const blurTmp = new Float64Array(gridN2);
        for (let p = 0; p < ALPT_LOCAL_BLUR; p++) alptBlurPeriodic(dens, blurTmp, gridN);

        // Unit gradient direction and gradient magnitude (periodic central diff).
        const gradX = new Float64Array(gridN2);
        const gradY = new Float64Array(gridN2);
        const gradMag = new Float64Array(gridN2);
        let gSum = 0;
        for (let y = 0; y < gridN; y++) {
            const yp = ((y + 1) % gridN) * gridN;
            const ym = ((y - 1 + gridN) % gridN) * gridN;
            for (let x = 0; x < gridN; x++) {
                const xp = (x + 1) % gridN;
                const xm = (x - 1 + gridN) % gridN;
                const idx = y * gridN + x;
                const dx = dens[y * gridN + xp] - dens[y * gridN + xm];
                const dy = dens[yp + x] - dens[ym + x];
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 1e-9) {
                    gradX[idx] = dx / len;
                    gradY[idx] = dy / len;
                }
                gradMag[idx] = len;
                gSum += len * len;
            }
        }
        const gRms = Math.sqrt(gSum / gridN2);
        const gSoft = ALPT_LOCAL_SOFT * gRms + 1e-9;
        const densSpan = ALPT_LOCAL_DENS_HI - ALPT_LOCAL_DENS_LO;

        const step = new Float32Array(N * 2);
        let sumAbs = 0;
        let maxAbs = 0;
        let active = 0;

        for (let i = 0; i < N; i++) {
            const px = initialTracers[i].qx + maxDisp[i * 2];
            const py = initialTracers[i].qy + maxDisp[i * 2 + 1];
            const gx = px / cellW - 0.5;
            const gy = py / cellH - 0.5;
            const ix = Math.floor(gx);
            const iy = Math.floor(gy);
            const fx = gx - ix;
            const fy = gy - iy;

            const cx0 = ((ix % gridN) + gridN) % gridN;
            const cx1 = (cx0 + 1) % gridN;
            const cy0 = ((iy % gridN) + gridN) % gridN;
            const cy1 = (cy0 + 1) % gridN;

            const w00 = (1 - fx) * (1 - fy);
            const w10 = fx * (1 - fy);
            const w01 = (1 - fx) * fy;
            const w11 = fx * fy;

            const i00 = cy0 * gridN + cx0;
            const i10 = cy0 * gridN + cx1;
            const i01 = cy1 * gridN + cx0;
            const i11 = cy1 * gridN + cx1;

            const dlt = dens[i00] * w00 + dens[i10] * w10
                      + dens[i01] * w01 + dens[i11] * w11;

            let ux = gradX[i00] * w00 + gradX[i10] * w10
                   + gradX[i01] * w01 + gradX[i11] * w11;
            let uy = gradY[i00] * w00 + gradY[i10] * w10
                   + gradY[i01] * w01 + gradY[i11] * w11;

            const ulen = Math.sqrt(ux * ux + uy * uy);
            if (ulen < 1e-6 || !(eta > 0)) continue;
            ux /= ulen;
            uy /= ulen;

            const gm = gradMag[i00] * w00 + gradMag[i10] * w10
                     + gradMag[i01] * w01 + gradMag[i11] * w11;

            // Density ramp: no step in voids, full step at knots.
            let ramp = (dlt - ALPT_LOCAL_DENS_LO) / densSpan;
            ramp = ramp < 0 ? 0 : (ramp > 1 ? 1 : ramp);
            ramp = ramp * ramp * (3 - 2 * ramp);
            // Direction reliability: fade out on plateaus / ridges.
            ramp *= gm / (gm + gSoft);

            const mag = ALPT_LOCAL_SIGN * eta * ramp;
            step[i * 2] = ux * mag;
            step[i * 2 + 1] = uy * mag;

            const a = Math.abs(mag);
            sumAbs += a;
            if (a > maxAbs) maxAbs = a;
            if (a > 0.05 * eta) active++;
        }

        table.localStep = {
            eta,
            d: dMax,
            spacing,
            gridN,
            step,
            meanAbs: sumAbs / N,
            maxAbs,
            activeFraction: active / N
        };
    }

    return table;
}

/**
 * Add the cached local gradient step to a sampled ALPT displacement buffer.
 * The step is ramped in time as (D / D_build)^3, clamped to 1, matching the
 * reference construction; it is not a velocity, so it does not inject energy.
 *
 * @param {Object} table - result of buildALPTTable
 * @param {number} growthD - current growth factor
 * @param {Float32Array} disp - interleaved displacement, modified in place
 * @param {number} N - particle count
 * @returns {Float32Array} disp
 */
function applyALPTLocalStep(table, growthD, disp, N) {
    if (!table || !table.localStep || !disp || !(growthD > 0)) return disp;
    const ls = table.localStep;
    if (!ls.step || !(ls.d > 0)) return disp;
    const ratio = Math.min(1, growthD / ls.d);
    const weight = ratio * ratio * ratio;
    if (weight <= 0) return disp;
    const limit = Math.min(N * 2, disp.length, ls.step.length);
    for (let i = 0; i < limit; i++) disp[i] += weight * ls.step[i];
    return disp;
}

/**
 * Interpolate the ALPT displacement table at the current growth factor.
 * Returns displacements in pixels, interleaved [dx,dy] x N.
 *
 * @param {Object} table - result of buildALPTTable
 * @param {Array} initialTracers - particles with {qx,qy}
 * @param {number} N
 * @param {number} growthD - physical growth factor D(t)
 * @param {Float32Array} [out] - optional reusable output buffer
 * @returns {Float32Array}
 */
function sampleALPTDisplacement(table, initialTracers, N, growthD, out = null) {
    const result = (out && out.length >= N * 2) ? out : new Float32Array(N * 2);

    if (!table || !table.fields || table.fields.length === 0 || !(growthD > 0)) {
        result.fill(0);
        return result;
    }

    const { gridN, cellW, cellH, dMax, samples, fields } = table;
    const step = dMax / (samples - 1);

    let i0 = 0, i1 = 0, frac = 0;
    const tRaw = growthD / step;
    if (tRaw >= samples - 1) {
        i0 = i1 = samples - 1;
    } else {
        i0 = Math.floor(tRaw);
        i1 = i0 + 1;
        frac = tRaw - i0;
    }

    const f0 = fields[i0];
    const f1 = fields[i1];

    for (let i = 0; i < N; i++) {
        const g = initialTracers[i];
        const gx = g.qx / cellW - 0.5;
        const gy = g.qy / cellH - 0.5;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;

        const cx0 = ((ix % gridN) + gridN) % gridN;
        const cx1 = (cx0 + 1) % gridN;
        const cy0 = ((iy % gridN) + gridN) % gridN;
        const cy1 = (cy0 + 1) % gridN;

        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const i00 = (cy0 * gridN + cx0) * 2;
        const i10 = (cy0 * gridN + cx1) * 2;
        const i01 = (cy1 * gridN + cx0) * 2;
        const i11 = (cy1 * gridN + cx1) * 2;

        const aX = f0[i00] * w00 + f0[i10] * w10 + f0[i01] * w01 + f0[i11] * w11;
        const aY = f0[i00 + 1] * w00 + f0[i10 + 1] * w10 + f0[i01 + 1] * w01 + f0[i11 + 1] * w11;
        const bX = f1[i00] * w00 + f1[i10] * w10 + f1[i01] * w01 + f1[i11] * w11;
        const bY = f1[i00 + 1] * w00 + f1[i10 + 1] * w10 + f1[i01 + 1] * w01 + f1[i11 + 1] * w11;

        result[i * 2] = aX + (bX - aX) * frac;
        result[i * 2 + 1] = aY + (bY - aY) * frac;
    }

    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ALPT_D_MAX,
        ALPT_SAMPLE_COUNT,
        ALPT_LOCAL_STEP_SPACINGS,
        alptPsiSC2D,
        alptChooseGridN,
        alptBlurPeriodic,
        buildALPTTable,
        sampleALPTDisplacement,
        applyALPTLocalStep
    };
}
