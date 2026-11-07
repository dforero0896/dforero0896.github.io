/**
 * Cosmic Web Explorer
 *
 * A real-time cosmological visualization tool.
 * Copyright (c) 2026 Nico Schuster. Licensed under the GNU AGPLv3.
 *
 * ---
 * This tool is shared for educational and research purposes. It is provided
 * "as-is," without any warranty of any kind.
 *
 * For full license terms and citation instructions, please visit:
 * https://github.com/nicosmo/cosmic_web_explorer
 */

// ============================================================
// galaxy-bias.js — Artificial local galaxy-bias model
// ============================================================
// Given the DM overdensity rho = 1 + delta_DM = rho_DM / <rho_DM>, the
// expected local galaxy number density is modelled as
//
//   N_loc(rho | alpha, beta_l, rho_l, beta_h, rho_h)
//       = rho^alpha * sigma(beta_l * (rho - rho_l))
//                   * sigma(-beta_h * (rho - rho_h))
//
// with sigma(x) = 1 / (1 + exp(-x)) the logistic sigmoid.  The first factor
// sets the power-law response to the DM field, the second suppresses low
// densities (below rho_l), and the third suppresses high densities (above
// rho_h).  The product is normalised to unit mean over the sampled volume,
// so the biased field behaves like a galaxy overdensity field:
//
//   rho_bias = N_loc(rho) / <N_loc(rho)>.
//
// The model is a display/analysis layer only: it never feeds back into the
// N-body evolution, void finding, or cosmic-web classification.
// ============================================================

const GalaxyBias = (() => {
    'use strict';

    // Default parameters.  They are deliberately moderate: alpha > 1 makes
    // dense regions louder, beta_l / beta_h carve out low- and high-density
    // wings, and the pivots sit inside the bulk of the rho distribution.
    const DEFAULTS = Object.freeze({
        alpha: 1.0,
        betaLow: 1.0,
        rhoLow: 0.5,
        betaHigh: 0.1,
        rhoHigh: 10.0
    });

    // Slider ranges.  alpha is the power-law exponent of the local galaxy
    // number density and is kept strictly positive (0 = flat, no density
    // response; larger values make dense regions progressively louder).
    // Physical rho is non-negative, so rho_l is clamped at 0.  The
    // high-density pivot is log-scaled: the interesting range spans a few
    // decades, and a linear slider would race through rho_h = 1..20 and stall.
    const RANGES = Object.freeze({
        alpha:    Object.freeze({ min: 0,  max: 4,   step: 0.05 }),
        betaLow:  Object.freeze({ min: 0,  max: 5,   step: 0.05 }),
        rhoLow:   Object.freeze({ min: 0,  max: 5,   step: 0.05 }),
        betaHigh: Object.freeze({ min: 0,  max: 5,   step: 0.05 }),
        rhoHigh:  Object.freeze({ min: 0.5, max: 100, log: true })
    });

    /** Map a parameter value onto its 0..1 slider position. */
    function toSlider(range, value) {
        if (range.log) {
            const lo = Math.log(range.min);
            const hi = Math.log(range.max);
            const v = Math.min(range.max, Math.max(range.min, value));
            return hi > lo ? (Math.log(v) - lo) / (hi - lo) : 0;
        }
        const span = range.max - range.min;
        return span > 0 ? (value - range.min) / span : 0;
    }

    /** Map a 0..1 slider position back onto a parameter value. */
    function fromSlider(range, t) {
        const c = Math.min(1, Math.max(0, t));
        if (range.log) {
            const lo = Math.log(range.min);
            const hi = Math.log(range.max);
            // Keep the readout tidy: three significant digits is plenty.
            return Number(Math.exp(lo + (hi - lo) * c).toPrecision(3));
        }
        const raw = range.min + (range.max - range.min) * c;
        if (range.step > 0) return Number((Math.round(raw / range.step) * range.step).toFixed(4));
        return raw;
    }

    /** Numerically stable logistic sigmoid. */
    function sigmoid(x) {
        if (x >= 0) return 1 / (1 + Math.exp(-x));
        const ex = Math.exp(x);
        return ex / (1 + ex);
    }

    /**
     * Unnormalised local galaxy number density N_loc(rho).
     * rho is clamped at 0 (physical density cannot be negative).  Using
     * Math.pow(0, 0) === 1 keeps alpha = 0 well behaved.
     */
    function weight(rho, params) {
        const r = rho > 0 ? rho : 0;
        const power = Math.pow(r, params.alpha);
        const lowCut = sigmoid(params.betaLow * (r - params.rhoLow));
        const highCut = sigmoid(-params.betaHigh * (r - params.rhoHigh));
        const w = power * lowCut * highCut;
        return isFinite(w) ? w : 0;
    }

    /**
     * Fill out[i] with the normalised biased field
     *   N_loc(rho_i) / mean(N_loc)
     * where rho_i = densities[i] / meanDensity.
     *
     * @param {Float32Array|Float64Array} densities - DM density per tracer
     * @param {number} meanDensity                  - mean DM density
     * @param {number} N                            - usable tracer count
     * @param {object} params                       - bias parameters
     * @param {Float32Array|Float64Array} out       - output buffer (length >= N)
     * @returns {number} unnormalised mean weight (0 on invalid input)
     */
    function normalizedWeights(densities, meanDensity, N, params, out) {
        if (!densities || !out || !(N > 0) || out.length < N) return 0;

        // No usable field: fall back to a uniform (unbiased) weighting.
        if (!(meanDensity > 0)) {
            for (let i = 0; i < N; i++) out[i] = 1;
            return 1;
        }

        let sum = 0;
        for (let i = 0; i < N; i++) {
            const w = weight(densities[i] / meanDensity, params);
            out[i] = w;
            sum += w;
        }

        const mean = sum / N;
        if (!(mean > 0) || !isFinite(mean)) {
            // Degenerate model (e.g. everything falls on a hard cutoff).
            for (let i = 0; i < N; i++) out[i] = 1;
            return 1;
        }

        const inv = 1 / mean;
        for (let i = 0; i < N; i++) out[i] *= inv;
        return mean;
    }

    /** Build a plain parameter object from loose values. */
    function makeParams(alpha, betaLow, rhoLow, betaHigh, rhoHigh) {
        return { alpha, betaLow, rhoLow, betaHigh, rhoHigh };
    }

    /** True when the parameter set leaves the field (nearly) unchanged. */
    function isNeutral(params) {
        return params.alpha === 0 &&
            params.betaLow === 0 && params.betaHigh === 0;
    }

    return {
        DEFAULTS,
        RANGES,
        toSlider,
        fromSlider,
        sigmoid,
        weight,
        normalizedWeights,
        makeParams,
        isNeutral
    };
})();
