/*
 * Animated cosmic web background.
 *
 * This is a small, dependency-free Zel'dovich-approximation simulation of
 * large-scale structure formation, rendered live on a canvas and used as the
 * page background.
 *
 *   1. A Gaussian random overdensity field delta(x) is drawn in Fourier space
 *      with a cold-dark-matter-like cutoff spectrum: P(k) ~ exp(-(k/k_c)^2).
 *   2. The linear Zel'dovich displacement is psi_k = i k / |k|^2 * delta_k.
 *      Particles start on a jittered, uniform ("glass-like") lattice and move
 *      along straight lines, x(q, D) = q + D * psi(q), where D is the linear
 *      growth factor. Caustics where neighbouring trajectories cross form the
 *      sheets, filaments and knots of the cosmic web.
 *   3. Each frame the particles are deposited into a small density texture,
 *      blurred, and tone-mapped so voids stay black while filaments and nodes
 *      glow white. D ramps from 0 (uniform) to today's value, so the web
 *      visibly condenses while the page loads.
 *
 * Once the web has formed the particle pass stops; the finished texture is
 * only panned slowly (plus a touch of pointer parallax) so the animation stays
 * essentially free. With prefers-reduced-motion the fully-formed web is drawn
 * once and never animated.
 *
 * The script also tags the document and reveals sections on scroll.
 */
(function () {
    "use strict";

    var canvas = document.getElementById("cosmic-web");
    if (!canvas) {
        return;
    }
    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
        return;
    }

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ------------------------------------------------------------------ *
     * Simulation constants
     * ------------------------------------------------------------------ */

    var L = 256;            // periodic simulation box side, world units
    var FIELD_N = 256;      // FFT grid resolution
    var K_CUT = 0.09;      // spectral cutoff, fraction of the Nyquist wavenumber
    var RMS_DISP = 7.6;     // Zel'dovich displacement RMS, world units
    var D_MAX = 1.15;       // growth factor reached "today"
    var GROW_SECONDS = 4.4; // time to grow from a uniform field to today
    var TONE_REF = 7.0;     // overdensity that maps to full brightness
    var DRIFT_SPEED = 5.0;  // painter's drift once formed, css px / second

    /* Structure formation model: "za" (Zel'dovich) or "alpt" (2LPT on large
       scales + spherical collapse on small scales). Both builds fill the same
       per-particle displacement arrays, so switching is a one-line change. */
    var MODEL = "alpt";

    var SECOND_RMS = 1.6;   // rms of the 2LPT displacement, world units
    var SECOND_SIGN = -1;   // sign that makes the second order enhance collapse
    var SC_RADIUS = 4.0;    // Lagrangian radius of the collapse patch, world units
    var SC_THRESHOLD = 0.4; // smoothed overdensity where collapse starts to act
    var SC_FULL = 2.5;      // smoothed overdensity where it is fully applied
    var SC_GRID = 192;      // grid the collapse field is sampled on
    var SC_BLUR = 2;        // smoothing passes over that grid

    /* Local step along the density gradient: the subgrid displacement of the
       DESI mock pipeline (see DESI_Mocks.pdf, the psi_loc step of the
       hierarchical fit). Every particle takes one small step
           x -> x + eta * sigmoid((delta - delta_lo) / (delta_hi - delta_lo))
                     * grad(delta) / |grad(delta)|
       The step is along the *unit* gradient, so its length is eta everywhere
       by construction and cannot grow with the local slope; that is what
       keeps the large scales untouched. Set LOCAL_STEP = false to disable (or
       MODEL = "za" to go all the way back to Zel'dovich). */
    var LOCAL_STEP = true;
    var LOCAL_STEP_LEN = 0.75; // eta: step length, world units (spacing ~0.5)
    var LOCAL_SIGN = 1;        // +1 uphill toward knots, -1 outward
    var LOCAL_GRID = 256;      // grid the gradient is measured on
    var LOCAL_BLUR = 2;        // smoothing passes before differencing
    var LOCAL_DENS_LO = -0.5;  // no step below this smoothed overdensity
    var LOCAL_DENS_HI = 0.5;   // full step above this smoothed overdensity
    var LOCAL_SOFT = 0.6;      // step fades out where |grad| is this * rms

    var K_DEPTH = 0.055;    // cut-off of the line-of-sight depth field
    var DEPTH_RMS = 0.28;   // how far the depth coordinate ranges about 0.5

    /* Colour: density picks the position on the ramp, depth tints it. */
    var LUT_NX = 192;       // density tone resolution
    var LUT_NZ = 24;        // depth buckets

    /* ------------------------------------------------------------------ *
     * FFT machinery (in-place iterative radix-2, complex)
     * ------------------------------------------------------------------ */

    var rev;
    var revBits;

    function initFFT(n) {
        revBits = Math.round(Math.log(n) / Math.LN2);
        rev = new Uint32Array(n);
        for (var i = 0; i < n; i++) {
            var r = 0;
            for (var b = 0; b < revBits; b++) {
                r = (r << 1) | ((i >>> b) & 1);
            }
            rev[i] = r;
        }
    }

    /* 1-D transform over a strided slice. */
    function fft1d(re, im, off, stride, n, inverse) {
        var i, j, k, m, half, jj;
        for (i = 0; i < n; i++) {
            j = rev[i];
            if (j > i) {
                var ai = off + i * stride;
                var aj = off + j * stride;
                var tr = re[ai];
                re[ai] = re[aj];
                re[aj] = tr;
                tr = im[ai];
                im[ai] = im[aj];
                im[aj] = tr;
            }
        }
        var sign = inverse ? 1 : -1;
        for (m = 2; m <= n; m <<= 1) {
            half = m >> 1;
            var ang = (sign * 2 * Math.PI) / m;
            var wr0 = Math.cos(ang);
            var wi0 = Math.sin(ang);
            for (k = 0; k < n; k += m) {
                var wr = 1;
                var wi = 0;
                for (jj = 0; jj < half; jj++) {
                    var i0 = off + (k + jj) * stride;
                    var i1 = off + (k + jj + half) * stride;
                    var xr = re[i1] * wr - im[i1] * wi;
                    var xi = re[i1] * wi + im[i1] * wr;
                    re[i1] = re[i0] - xr;
                    im[i1] = im[i0] - xi;
                    re[i0] += xr;
                    im[i0] += xi;
                    var nwr = wr * wr0 - wi * wi0;
                    wi = wr * wi0 + wi * wr0;
                    wr = nwr;
                }
            }
        }
    }

    /* 2-D transform of a row-major n x n array. */
    function fft2(re, im, n, inverse) {
        for (var r = 0; r < n; r++) {
            fft1d(re, im, r * n, 1, n, inverse);
        }
        for (var c = 0; c < n; c++) {
            fft1d(re, im, c, n, n, inverse);
        }
    }

    /* ------------------------------------------------------------------ *
     * Zel'dovich field construction
     * ------------------------------------------------------------------ */

    var psiX;
    var psiY;
    var qx;
    var qy;
    var ddx;
    var ddy;
    var dd2x;       // 2LPT displacement (zero-sized unless MODEL === "alpt")
    var dd2y;
    var scx;        // spherical-collapse correction, also ALPT only
    var scy;
    var secondOrder = false;
    var gdx;        // unit density-gradient direction, LOCAL_STEP only
    var gdy;
    var gradientStep = false;
    var depth;      // per-particle position along the line of sight, 0..1
    var particleCount;
    var PART_N = 0;

    /* A smooth isotropic Gaussian random field, unit variance. Used for the
       line-of-sight coordinate: a thin box has no resolved z, so we tag each
       particle with a smooth depth field instead. */
    function gaussField(cut) {
        var n = FIELD_N;
        var n2 = n * n;
        var kx = new Float64Array(n);
        for (var i = 0; i < n; i++) {
            var m = i <= n / 2 ? i : i - n;
            kx[i] = (2 * Math.PI * m) / n;
        }
        var kc = cut * Math.PI;
        var re = new Float64Array(n2);
        var im = new Float64Array(n2);
        var idx = 0;
        for (var j = 0; j < n; j++) {
            var kyv = kx[j];
            for (var i2 = 0; i2 < n; i2++, idx++) {
                var kxv = kx[i2];
                var k2 = kxv * kxv + kyv * kyv;
                if (k2 === 0) {
                    continue;
                }
                var q = Math.sqrt(k2) / kc;
                var amp = Math.exp(-0.5 * q * q);
                var phase = Math.random() * 2 * Math.PI;
                re[idx] = amp * Math.cos(phase);
                im[idx] = amp * Math.sin(phase);
            }
        }
        fft2(re, im, n, true);
        var s2 = 0;
        for (var t = 0; t < n2; t++) {
            s2 += re[t] * re[t];
        }
        var nz = 1 / Math.sqrt(s2 / n2);
        for (t = 0; t < n2; t++) {
            re[t] *= nz;
        }
        return re;
    }

    function buildField() {
        initFFT(FIELD_N);
        var n = FIELD_N;
        var n2 = n * n;

        var kx = new Float64Array(n);
        for (var i = 0; i < n; i++) {
            var m = i <= n / 2 ? i : i - n;
            kx[i] = (2 * Math.PI * m) / n;
        }

        var kc = K_CUT * Math.PI;

        /* delta_k: Gaussian field with a smooth large-scale cutoff. */
        var re = new Float64Array(n2);
        var im = new Float64Array(n2);
        var xr = new Float64Array(n2);
        var xi = new Float64Array(n2);
        var yr = new Float64Array(n2);
        var yi = new Float64Array(n2);

        var idx = 0;
        for (var j = 0; j < n; j++) {
            var kyv = kx[j];
            for (var i2 = 0; i2 < n; i2++, idx++) {
                var kxv = kx[i2];
                var k2 = kxv * kxv + kyv * kyv;
                if (k2 === 0) {
                    continue;
                }
                var kk = Math.sqrt(k2);
                var q = kk / kc;
                var amp = Math.exp(-0.5 * q * q);
                var phase = Math.random() * 2 * Math.PI;
                var cr = amp * Math.cos(phase);
                var ci = amp * Math.sin(phase);
                re[idx] = cr;
                im[idx] = ci;

                /* psi_x,k = i kx / |k|^2 delta_k  (and likewise for y) */
                var f = kxv / k2;
                xr[idx] = -f * ci;
                xi[idx] = f * cr;
                f = kyv / k2;
                yr[idx] = -f * ci;
                yi[idx] = f * cr;
            }
        }

        fft2(xr, xi, n, true);
        fft2(yr, yi, n, true);

        var sum = 0;
        for (var t = 0; t < n2; t++) {
            sum += xr[t] * xr[t] + yr[t] * yr[t];
        }
        var norm = RMS_DISP * Math.sqrt(n2 / sum);

        psiX = new Float32Array(n2);
        psiY = new Float32Array(n2);
        for (var s = 0; s < n2; s++) {
            psiX[s] = xr[s] * norm;
            psiY[s] = yr[s] * norm;
        }

        var depthField = gaussField(K_DEPTH);

        particleCount = PART_N * PART_N;
        qx = new Float32Array(particleCount);
        qy = new Float32Array(particleCount);
        ddx = new Float32Array(particleCount);
        ddy = new Float32Array(particleCount);
        depth = new Float32Array(particleCount);

        var spacing = L / PART_N;
        var inv = n / L;
        var k = 0;
        for (var b = 0; b < PART_N; b++) {
            for (var a = 0; a < PART_N; a++, k++) {
                var px = (a + 0.5) * spacing + (Math.random() - 0.5) * 2 * spacing;
                var py = (b + 0.5) * spacing + (Math.random() - 0.5) * 2 * spacing;
                if (px < 0) {
                    px += L;
                } else if (px >= L) {
                    px -= L;
                }
                if (py < 0) {
                    py += L;
                } else if (py >= L) {
                    py -= L;
                }
                qx[k] = px;
                qy[k] = py;

                /* bilinear sample of the displacement field at (px, py) */
                var u = px * inv;
                var v = py * inv;
                var i0 = Math.floor(u);
                var j0 = Math.floor(v);
                var fu = u - i0;
                var fv = v - j0;
                i0 = ((i0 % n) + n) % n;
                j0 = ((j0 % n) + n) % n;
                var i1 = (i0 + 1) % n;
                var j1 = (j0 + 1) % n;
                var w00 = (1 - fu) * (1 - fv);
                var w10 = fu * (1 - fv);
                var w01 = (1 - fu) * fv;
                var w11 = fu * fv;
                var r0 = j0 * n;
                var r1 = j1 * n;
                ddx[k] =
                    psiX[r0 + i0] * w00 + psiX[r0 + i1] * w10 +
                    psiX[r1 + i0] * w01 + psiX[r1 + i1] * w11;
                ddy[k] =
                    psiY[r0 + i0] * w00 + psiY[r0 + i1] * w10 +
                    psiY[r1 + i0] * w01 + psiY[r1 + i1] * w11;

                var zz =
                    depthField[r0 + i0] * w00 + depthField[r0 + i1] * w10 +
                    depthField[r1 + i0] * w01 + depthField[r1 + i1] * w11;
                zz = 0.5 + DEPTH_RMS * zz;
                if (zz < 0.03) {
                    zz = 0.03;
                } else if (zz > 0.97) {
                    zz = 0.97;
                }
                depth[k] = zz;
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * ALPT: 2LPT on large scales + spherical collapse on small scales
     *
     * buildField() above stays untouched and still supplies psi1, the
     * particle lattice and the depth field. This build adds the two extra
     * displacement terms the renderer combines per particle:
     *
     *     x(q, D) = q + D psi1(q) + D^2 [ psi2(q) + sc(q) ]
     *
     * psi2 is the second-order Lagrangian displacement, obtained from the
     * second-order density
     *     delta2 = 2 ( phi1,xx phi1,yy - phi1,xy^2 )          (2-D analogue)
     * solved through the same FFT Poisson steps as psi1. The spherical
     * collapse term pulls particles that sit in a small-scale overdensity
     * toward the local density maximum by the mass-conservation factor
     *     (1 + delta_R)^(-1/3) - 1
     * over the Lagrangian radius SC_RADIUS. Large scales keep the 2LPT
     * displacement (good filament placement), small scales collapse
     * spherically (sharp knots instead of Zel'dovich pancakes).
     * ------------------------------------------------------------------ */

    function buildFieldALPT() {
        buildField();

        var n = FIELD_N;
        var n2 = n * n;
        var kx = new Float64Array(n);
        for (var i = 0; i < n; i++) {
            var m = i <= n / 2 ? i : i - n;
            kx[i] = (2 * Math.PI * m) / n;
        }

        /* phi1_k = i (k . psi1_k) / k^2 : recover the potential from psi1. */
        var pxr = new Float64Array(psiX);
        var pxi = new Float64Array(n2);
        var pyr = new Float64Array(psiY);
        var pyi = new Float64Array(n2);
        fft2(pxr, pxi, n, false);
        fft2(pyr, pyi, n, false);

        /* phi1,ij in Fourier space, then back to real space. */
        var ax = new Float64Array(n2);
        var ai = new Float64Array(n2);
        var bx = new Float64Array(n2);
        var bi = new Float64Array(n2);
        var cx = new Float64Array(n2);
        var ci = new Float64Array(n2);
        var idx = 0;
        for (var j = 0; j < n; j++) {
            var ky = kx[j];
            for (var i2 = 0; i2 < n; i2++, idx++) {
                var kxv = kx[i2];
                var k2 = kxv * kxv + ky * ky;
                if (k2 === 0) {
                    continue;
                }
                var pr = kxv * pxr[idx] + ky * pyr[idx];
                var pi = kxv * pxi[idx] + ky * pyi[idx];
                var phr = -pi / k2;
                var phi = pr / k2;
                var fxx = -kxv * kxv;
                var fyy = -ky * ky;
                var fxy = -kxv * ky;
                ax[idx] = fxx * phr;
                ai[idx] = fxx * phi;
                bx[idx] = fyy * phr;
                bi[idx] = fyy * phi;
                cx[idx] = fxy * phr;
                ci[idx] = fxy * phi;
            }
        }
        fft2(ax, ai, n, true);
        fft2(bx, bi, n, true);
        fft2(cx, ci, n, true);

        /* Second-order density, zero mean, then psi2 through Poisson. */
        var d2r = new Float64Array(n2);
        var d2i = new Float64Array(n2);
        var mean = 0;
        for (i = 0; i < n2; i++) {
            d2r[i] = 2 * (ax[i] * bx[i] - cx[i] * cx[i]);
            mean += d2r[i];
        }
        mean /= n2;
        for (i = 0; i < n2; i++) {
            d2r[i] -= mean;
        }
        fft2(d2r, d2i, n, false);

        var sxr = new Float64Array(n2);
        var sxi = new Float64Array(n2);
        var syr = new Float64Array(n2);
        var syi = new Float64Array(n2);
        idx = 0;
        for (j = 0; j < n; j++) {
            ky = kx[j];
            for (i2 = 0; i2 < n; i2++, idx++) {
                var kx2 = kx[i2];
                var k22 = kx2 * kx2 + ky * ky;
                if (k22 === 0) {
                    continue;
                }
                var f = kx2 / k22;
                sxr[idx] = -f * d2i[idx];
                sxi[idx] = f * d2r[idx];
                f = ky / k22;
                syr[idx] = -f * d2i[idx];
                syi[idx] = f * d2r[idx];
            }
        }
        fft2(sxr, sxi, n, true);
        fft2(syr, syi, n, true);

        /* Normalise psi2 to a controlled amplitude (its physical rms is not
           simply proportional to the linear one, so we set it explicitly). */
        var amp2 = 0;
        for (i = 0; i < n2; i++) {
            amp2 += sxr[i] * sxr[i] + syr[i] * syr[i];
        }
        var nrm = amp2 > 0 ? (SECOND_SIGN * SECOND_RMS * Math.sqrt(n2 / amp2)) : 0;

        dd2x = new Float32Array(particleCount);
        dd2y = new Float32Array(particleCount);
        var inv = n / L;

        /* Sample psi2 on the particle lattice (same bilinear scheme). */
        for (var k = 0; k < particleCount; k++) {
            var u = qx[k] * inv;
            var v = qy[k] * inv;
            var i0 = Math.floor(u);
            var j0 = Math.floor(v);
            var fu = u - i0;
            var fv = v - j0;
            i0 = ((i0 % n) + n) % n;
            j0 = ((j0 % n) + n) % n;
            var i1 = (i0 + 1) % n;
            var j1 = (j0 + 1) % n;
            var w00 = (1 - fu) * (1 - fv);
            var w10 = fu * (1 - fv);
            var w01 = (1 - fu) * fv;
            var w11 = fu * fv;
            var r0 = j0 * n;
            var r1 = j1 * n;
            dd2x[k] = nrm * (
                sxr[r0 + i0] * w00 + sxr[r0 + i1] * w10 +
                sxr[r1 + i0] * w01 + sxr[r1 + i1] * w11);
            dd2y[k] = nrm * (
                syr[r0 + i0] * w00 + syr[r0 + i1] * w10 +
                syr[r1 + i0] * w01 + syr[r1 + i1] * w11);
        }

        /* ---- spherical collapse term, evaluated at the 2LPT positions ---- */
        var GN = SC_GRID;
        var gs = GN / L;
        var gd = new Float32Array(GN * GN);
        var gt = new Float32Array(GN * GN);
        var step = D_MAX;
        var step2 = step * step;

        for (k = 0; k < particleCount; k++) {
            var ux = qx[k] + step * ddx[k] + step2 * dd2x[k];
            var uy = qy[k] + step * ddy[k] + step2 * dd2y[k];
            ux = ((ux % L) + L) % L;
            uy = ((uy % L) + L) % L;
            var x = ux * gs;
            var y = uy * gs;
            var ix = x | 0;
            var iy = y | 0;
            var fx = x - ix;
            var fy = y - iy;
            ix = ((ix % GN) + GN) % GN;
            iy = ((iy % GN) + GN) % GN;
            var ix1 = (ix + 1) % GN;
            var iy1 = (iy + 1) % GN;
            gd[iy * GN + ix] += (1 - fx) * (1 - fy);
            gd[iy * GN + ix1] += fx * (1 - fy);
            gd[iy1 * GN + ix] += (1 - fx) * fy;
            gd[iy1 * GN + ix1] += fx * fy;
        }

        /* Overdensity on the coarse grid, then smooth to the collapse scale. */
        var gm = particleCount / (GN * GN);
        for (i = 0; i < GN * GN; i++) {
            gd[i] = gd[i] / gm - 1;
        }
        for (var pass = 0; pass < SC_BLUR; pass++) {
            blurPass(gd, gt, GN, GN);
        }

        /* Unit vector pointing uphill in the smoothed density. */
        var gx = new Float32Array(GN * GN);
        var gy = new Float32Array(GN * GN);
        for (var jy = 0; jy < GN; jy++) {
            var jp = ((jy + 1) % GN) * GN;
            var jm = ((jy + GN - 1) % GN) * GN;
            for (var ixx = 0; ixx < GN; ixx++) {
                var ip = (ixx + 1) % GN;
                var im = (ixx + GN - 1) % GN;
                var dx = gd[jy * GN + ip] - gd[jy * GN + im];
                var dy = gd[jp + ixx] - gd[jm + ixx];
                var len = Math.sqrt(dx * dx + dy * dy);
                var gk = jy * GN + ixx;
                if (len > 1e-9) {
                    gx[gk] = dx / len;
                    gy[gk] = dy / len;
                }
            }
        }

        scx = new Float32Array(particleCount);
        scy = new Float32Array(particleCount);
        var invGN = GN / L;

        for (k = 0; k < particleCount; k++) {
            var pu = qx[k] + step * ddx[k] + step2 * dd2x[k];
            var pv = qy[k] + step * ddy[k] + step2 * dd2y[k];
            pu = ((pu % L) + L) % L;
            pv = ((pv % L) + L) % L;
            var su = pu * invGN;
            var sv = pv * invGN;
            var si = Math.floor(su);
            var sj = Math.floor(sv);
            var sfu = su - si;
            var sfv = sv - sj;
            si = ((si % GN) + GN) % GN;
            sj = ((sj % GN) + GN) % GN;
            var si1 = (si + 1) % GN;
            var sj1 = (sj + 1) % GN;
            var sw00 = (1 - sfu) * (1 - sfv);
            var sw10 = sfu * (1 - sfv);
            var sw01 = (1 - sfu) * sfv;
            var sw11 = sfu * sfv;
            var sr0 = sj * GN;
            var sr1 = sj1 * GN;
            var dlt =
                gd[sr0 + si] * sw00 + gd[sr0 + si1] * sw10 +
                gd[sr1 + si] * sw01 + gd[sr1 + si1] * sw11;
            var gu =
                gx[sr0 + si] * sw00 + gx[sr0 + si1] * sw10 +
                gx[sr1 + si] * sw01 + gx[sr1 + si1] * sw11;
            var gv =
                gy[sr0 + si] * sw00 + gy[sr0 + si1] * sw10 +
                gy[sr1 + si] * sw01 + gy[sr1 + si1] * sw11;

            var fSC = dlt > -0.9 ? Math.pow(1 + dlt, -1 / 3) - 1 : -0.9;
            var w = (dlt - SC_THRESHOLD) / (SC_FULL - SC_THRESHOLD);
            if (w < 0) {
                w = 0;
            } else if (w > 1) {
                w = 1;
            }
            w = w * w * (3 - 2 * w);
            var mag = -SC_RADIUS * fSC * w; /* inward: along +grad(delta) */
            if (mag > SC_RADIUS * 0.85) {
                mag = SC_RADIUS * 0.85;
            }
            scx[k] = gu * mag;
            scy[k] = gv * mag;
        }

        secondOrder = true;
    }

    /* ------------------------------------------------------------------ *
     * LOCAL_STEP: one small step along the unit density gradient
     *
     * The subgrid displacement used to build the DESI mocks: measure the
     * smoothed density on a grid, take its gradient, normalise that gradient
     * to a pure direction, and move every particle a fixed, small eta along
     * it. Because the direction is normalised *before* the step is taken, the
     * displacement can never exceed eta however steep the field becomes,
     * which is what leaves the large-scale clustering of the 2LPT + collapse
     * build untouched. Runs after buildFieldALPT() and fills only its own
     * arrays, so it can be switched off with LOCAL_STEP = false.
     * ------------------------------------------------------------------ */
    function buildLocalStep() {
        var GN = LOCAL_GRID;
        var n = GN * GN;
        var locDens = new Float32Array(n);
        var locTmp = new Float32Array(n);
        var locGX = new Float32Array(n);
        var locGY = new Float32Array(n);
        var locGMag = new Float32Array(n);
        var step = D_MAX;
        var step2 = step * step;
        var gs = GN / L;
        var k, i;

        /* 1. deposit the fully displaced particles (2LPT + collapse). */
        for (k = 0; k < particleCount; k++) {
            var ux = qx[k] + step * ddx[k] + step2 * (dd2x[k] + scx[k]);
            var uy = qy[k] + step * ddy[k] + step2 * (dd2y[k] + scy[k]);
            ux = ((ux % L) + L) % L;
            uy = ((uy % L) + L) % L;
            var x = ux * gs;
            var y = uy * gs;
            var ix = x | 0;
            var iy = y | 0;
            var fx = x - ix;
            var fy = y - iy;
            ix = ((ix % GN) + GN) % GN;
            iy = ((iy % GN) + GN) % GN;
            var ix1 = (ix + 1) % GN;
            var iy1 = (iy + 1) % GN;
            locDens[iy * GN + ix] += (1 - fx) * (1 - fy);
            locDens[iy * GN + ix1] += fx * (1 - fy);
            locDens[iy1 * GN + ix] += (1 - fx) * fy;
            locDens[iy1 * GN + ix1] += fx * fy;
        }

        /* 2. overdensity, smoothed to the scale the step is measured on. */
        var mean = particleCount / n;
        for (i = 0; i < n; i++) {
            locDens[i] = locDens[i] / mean - 1;
        }
        for (var pass = 0; pass < LOCAL_BLUR; pass++) {
            blurPass(locDens, locTmp, GN, GN);
        }

        /* 3. central-difference gradient, periodic, then drop its length. */
        for (var j = 0; j < GN; j++) {
            var jm = (j + GN - 1) % GN;
            var jp = (j + 1) % GN;
            var row = j * GN;
            var rowm = jm * GN;
            var rowp = jp * GN;
            for (var col = 0; col < GN; col++) {
                var cm = (col + GN - 1) % GN;
                var cp = (col + 1) % GN;
                var dgx = locDens[row + cp] - locDens[row + cm];
                var dgy = locDens[rowp + col] - locDens[rowm + col];
                var len = Math.sqrt(dgx * dgx + dgy * dgy);
                var cell = row + col;
                if (len > 1e-9) {
                    locGX[cell] = dgx / len;
                    locGY[cell] = dgy / len;
                }
                locGMag[cell] = len;
            }
        }

        /* 4. sample density and direction at each particle, take the step.
           The step is gated by |grad|: where the field is flat (the crest of a
           filament, the middle of a knot) the *direction* is pure noise, and
           most particles live exactly there. Pushing them along noise would
           diffuse structure instead of sharpening it, so the step fades to
           zero as |grad| -> 0, with the turn-on scale set by the rms gradient. */
        gdx = new Float32Array(particleCount);
        gdy = new Float32Array(particleCount);
        var span = LOCAL_DENS_HI - LOCAL_DENS_LO;
        var gSum = 0;
        for (i = 0; i < n; i++) {
            gSum += locGMag[i] * locGMag[i];
        }
        var gRms = Math.sqrt(gSum / n);
        var gSoft = LOCAL_SOFT * gRms + 1e-9;

        for (k = 0; k < particleCount; k++) {
            var pu = qx[k] + step * ddx[k] + step2 * (dd2x[k] + scx[k]);
            var pv = qy[k] + step * ddy[k] + step2 * (dd2y[k] + scy[k]);
            pu = ((pu % L) + L) % L;
            pv = ((pv % L) + L) % L;
            var su = pu * gs;
            var sv = pv * gs;
            var si = su | 0;
            var sj = sv | 0;
            var sfu = su - si;
            var sfv = sv - sj;
            si = ((si % GN) + GN) % GN;
            sj = ((sj % GN) + GN) % GN;
            var si1 = (si + 1) % GN;
            var sj1 = (sj + 1) % GN;
            var w00 = (1 - sfu) * (1 - sfv);
            var w10 = sfu * (1 - sfv);
            var w01 = (1 - sfu) * sfv;
            var w11 = sfu * sfv;
            var r0 = sj * GN;
            var r1 = sj1 * GN;

            var dlt =
                locDens[r0 + si] * w00 + locDens[r0 + si1] * w10 +
                locDens[r1 + si] * w01 + locDens[r1 + si1] * w11;
            var ux2 =
                locGX[r0 + si] * w00 + locGX[r0 + si1] * w10 +
                locGX[r1 + si] * w01 + locGX[r1 + si1] * w11;
            var uy2 =
                locGY[r0 + si] * w00 + locGY[r0 + si1] * w10 +
                locGY[r1 + si] * w01 + locGY[r1 + si1] * w11;
            var gmag =
                locGMag[r0 + si] * w00 + locGMag[r0 + si1] * w10 +
                locGMag[r1 + si] * w01 + locGMag[r1 + si1] * w11;

            /* interpolating unit vectors shortens them slightly: renormalise
               so the step length is exactly LOCAL_STEP_LEN. */
            var ulen = Math.sqrt(ux2 * ux2 + uy2 * uy2);
            if (ulen < 1e-6) {
                continue;
            }
            ux2 /= ulen;
            uy2 /= ulen;

            /* density ramp: no step in the emptiest cells (gradient is noise
               there), full step above LOCAL_DENS_HI. */
            var ramp = (dlt - LOCAL_DENS_LO) / span;
            if (ramp < 0) {
                ramp = 0;
            } else if (ramp > 1) {
                ramp = 1;
            }
            ramp = ramp * ramp * (3 - 2 * ramp);

            /* reliability of the direction: ~1 on a slope, ~0 on a flat crest */
            ramp *= gmag / (gmag + gSoft);

            var mag = LOCAL_SIGN * LOCAL_STEP_LEN * ramp;
            gdx[k] = ux2 * mag;
            gdy[k] = uy2 * mag;
        }

        gradientStep = true;
    }

    /* ------------------------------------------------------------------ *
     * Viewport / texture state
     * ------------------------------------------------------------------ */

    var cssW = 0;
    var cssH = 0;
    var texW = 1;
    var texH = 1;
    var tex = document.createElement("canvas");
    var texCtx = tex.getContext("2d");
    var imageData = null;
    var pixels = null;
    var colourLUT = new Uint8Array(1);
    var dens = new Float32Array(1);
    var scratch = new Float32Array(1);
    var depthBuf = new Float32Array(1);
    var depthTmp = new Float32Array(1);
    var glowBuf = new Float32Array(1);
    var glowTmp = new Float32Array(1);
    var viewW = L;          // world units visible horizontally
    var viewH = L;          // world units visible vertically
    var cropX = 0;
    var cropY = 0;
    var periodAxis = "x";   // axis that spans a full simulation period
    var drift = 0;          // settled-mode pan, css px
    var pointerX = 0;
    var pointerY = 0;
    var pointerTX = 0;
    var pointerTY = 0;

    function resize() {
        cssW = canvas.clientWidth || window.innerWidth;
        cssH = canvas.clientHeight || window.innerHeight;
        if (!cssW || !cssH) {
            return;
        }

        var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var aspect = cssW / cssH;
        if (aspect >= 1) {
            viewW = L;
            viewH = L / aspect;
            periodAxis = "x";
        } else {
            viewH = L;
            viewW = L * aspect;
            periodAxis = "y";
        }
        cropX = (L - viewW) / 2;
        cropY = (L - viewH) / 2;

        /* Size the density texture from the number of particles in view. */
        var frac = (viewW * viewH) / (L * L);
        var inView = particleCount * frac;
        var texels = Math.max(20000, Math.min(90000, inView / 3.2));
        texW = Math.round(Math.sqrt(texels * aspect));
        texH = Math.round(texW / aspect);
        texW = Math.max(96, Math.min(720, texW));
        texH = Math.max(96, Math.min(900, texH));

        tex.width = texW;
        tex.height = texH;
        imageData = texCtx.createImageData(texW, texH);
        pixels = imageData.data;
        var size = texW * texH;
        dens = new Float32Array(size);
        scratch = new Float32Array(size);
        depthBuf = new Float32Array(size);
        depthTmp = new Float32Array(size);
        glowBuf = new Float32Array(size);
        glowTmp = new Float32Array(size);
    }

    /* ------------------------------------------------------------------ *
     * Rendering
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * Colour map
     *
     * Density selects a position on a cool-to-hot ramp; the line-of-sight
     * depth then cools and dims the far side of the box, and warms the
     * brightest knots near the front. Baked once into a 2-D LUT.
     * ------------------------------------------------------------------ */

    /* [tone, r, g, b]: void -> steel -> violet -> ember -> gold.
       Cool tones dominate the filaments, gold is kept for the knots. */
    var RAMP = [
        [0.00, 3, 5, 14],
        [0.10, 10, 18, 52],
        [0.22, 20, 40, 104],
        [0.34, 30, 74, 158],
        [0.46, 52, 104, 186],
        [0.58, 96, 118, 190],
        [0.70, 156, 110, 168],
        [0.80, 210, 116, 132],
        [0.89, 240, 152, 100],
        [0.96, 250, 198, 134],
        [1.00, 255, 236, 202]
    ];
    var FAR_TINT = [16, 40, 96];    // the back of the box
    var NEAR_TINT = [255, 206, 148]; // warm light from the front

    function buildColourLUT() {
        var nx = LUT_NX;
        var lut = new Uint8Array(nx * LUT_NZ * 3);
        for (var zi = 0; zi < LUT_NZ; zi++) {
            var z = LUT_NZ > 1 ? zi / (LUT_NZ - 1) : 0.5;
            var back = 1 - z;
            var bright = 0.58 + 0.47 * z;
            for (var ti = 0; ti < nx; ti++) {
                var t = ti / (nx - 1);

                var r = 0;
                var g = 0;
                var b = 0;
                for (var k = 1; k < RAMP.length; k++) {
                    if (t <= RAMP[k][0] || k === RAMP.length - 1) {
                        var s0 = RAMP[k - 1];
                        var s1 = RAMP[k];
                        var f = (t - s0[0]) / (s1[0] - s0[0]);
                        f = f < 0 ? 0 : f > 1 ? 1 : f;
                        r = s0[1] + (s1[1] - s0[1]) * f;
                        g = s0[2] + (s1[2] - s0[2]) * f;
                        b = s0[3] + (s1[3] - s0[3]) * f;
                        break;
                    }
                }

                var mb = 0.42 * back * (0.3 + 0.7 * t);
                r += (FAR_TINT[0] - r) * mb;
                g += (FAR_TINT[1] - g) * mb;
                b += (FAR_TINT[2] - b) * mb;

                var mn = 0.34 * z * t * t;
                r += (NEAR_TINT[0] - r) * mn;
                g += (NEAR_TINT[1] - g) * mn;
                b += (NEAR_TINT[2] - b) * mn;

                r *= bright;
                g *= bright;
                b *= bright;

                var c = (zi * nx + ti) * 3;
                lut[c] = r > 255 ? 255 : r | 0;
                lut[c + 1] = g > 255 ? 255 : g | 0;
                lut[c + 2] = b > 255 ? 255 : b | 0;
            }
        }
        colourLUT = lut;
    }

    /* One iteration of a separable 3x3 binomial blur, src -> dst. */
    function blurPass(src, dst, w, h) {
        var x, y, row, l, r, up, dn, v;
        for (y = 0; y < h; y++) {
            row = y * w;
            for (x = 0; x < w; x++) {
                l = x > 0 ? src[row + x - 1] : src[row];
                r = x < w - 1 ? src[row + x + 1] : src[row + w - 1];
                v = src[row + x];
                dst[row + x] = (l + v + v + r) * 0.25;
            }
        }
        for (x = 0; x < w; x++) {
            for (y = 0; y < h; y++) {
                up = y > 0 ? dst[(y - 1) * w + x] : dst[x];
                dn = y < h - 1 ? dst[(y + 1) * w + x] : dst[(h - 1) * w + x];
                v = dst[y * w + x];
                src[y * w + x] = (up + v + v + dn) * 0.25;
            }
        }
    }

    /* Deposit particles and turn the density into the glow texture. */
    function paint(D) {
        var invDMax3 = 1 / (D_MAX * D_MAX * D_MAX);
        var tw = texW;
        var th = texH;
        var size = tw * th;
        dens.fill(0);
        depthBuf.fill(0);

        var sc = tw / viewW;
        var offX = cropX + pointerX * 6;
        var offY = cropY + pointerY * 4;
        if (periodAxis === "x") {
            offX += (drift * viewW) / cssW;
        } else {
            offY += (drift * viewH) / cssH;
        }

        var total = 0;
        for (var k = 0; k < particleCount; k++) {
            var ux = qx[k] + D * ddx[k];
            var uy = qy[k] + D * ddy[k];
            if (secondOrder) {
                var g2 = D * D;
                ux += g2 * (dd2x[k] + scx[k]);
                uy += g2 * (dd2y[k] + scy[k]);
            }
            if (gradientStep) {
                /* third-order-ish ramp so the step arrives with the collapse */
                var g3 = D * D * D * invDMax3;
                ux += g3 * gdx[k];
                uy += g3 * gdy[k];
            }
            ux -= offX;
            if (ux < 0) {
                ux += L;
            }
            if (ux < 0) {
                ux += L;
            }
            if (ux >= L) {
                ux -= L;
            }
            if (ux >= viewW) {
                continue;
            }
            uy -= offY;
            if (uy < 0) {
                uy += L;
            }
            if (uy < 0) {
                uy += L;
            }
            if (uy >= L) {
                uy -= L;
            }
            if (uy >= viewH) {
                continue;
            }

            var x = ux * sc;
            var y = uy * sc;
            var ix = x | 0;
            var iy = y | 0;
            if (iy >= th - 1) {
                continue;
            }
            var fx = x - ix;
            var fy = y - iy;
            if (ix >= tw) {
                ix -= tw;
            }
            var ix1 = ix + 1 < tw ? ix + 1 : ix + 1 - tw;
            var j0 = iy * tw;
            var j1 = j0 + tw;
            var w00 = (1 - fx) * (1 - fy);
            var w10 = fx * (1 - fy);
            var w01 = (1 - fx) * fy;
            var w11 = fx * fy;
            var zd = depth[k];
            dens[j0 + ix] += w00;
            dens[j0 + ix1] += w10;
            dens[j1 + ix] += w01;
            dens[j1 + ix1] += w11;
            depthBuf[j0 + ix] += w00 * zd;
            depthBuf[j0 + ix1] += w10 * zd;
            depthBuf[j1 + ix] += w01 * zd;
            depthBuf[j1 + ix1] += w11 * zd;
            total++;
        }

        /* blurPass() leaves its result in the first argument, so always
           pass (dens, scratch) - swapping them would discard the vertical
           pass and leave horizontal streaks in the texture. */
        blurPass(dens, scratch, tw, th);
        blurPass(depthBuf, depthTmp, tw, th);

        /* Soft halo: the same field blurred further. */
        glowBuf.set(dens);
        blurPass(glowBuf, glowTmp, tw, th);
        blurPass(glowBuf, glowTmp, tw, th);

        var mean = total / size;
        if (mean < 1e-6) {
            mean = 1e-6;
        }
        var invSpan = 1 / (TONE_REF - 1);
        var px = pixels;
        var lut = colourLUT;
        var nx = LUT_NX;
        for (var i = 0, p = 0; i < size; i++, p += 4) {
            var d = dens[i] / mean - 1;
            var g = glowBuf[i] / mean - 1;
            var a = d * invSpan;
            var b = g * invSpan * 1.25;
            if (a < 0) {
                a = 0;
            } else if (a > 1) {
                a = 1;
            }
            if (b < 0) {
                b = 0;
            } else if (b > 1) {
                b = 1;
            }
            var v = a * 0.62 + b * 0.38;
            v = v * v * (3 - 2 * v); /* gentle S-curve: keeps voids dark */
            v = v * (1.18 - 0.18 * v); /* lift the filaments a little */

            /* Depth: smooth ratio of depth-weighted mass to mass. */
            var m = dens[i];
            var z = m > 1e-4 ? depthBuf[i] / m : 0.5;
            if (z < 0) {
                z = 0;
            } else if (z > 1) {
                z = 1;
            }

            /* Colour tone is spread over a wider range than alpha, so faint
               filaments still pick up a hue instead of staying black. */
            var ct = Math.sqrt(v);
            var ti = (ct * nx) | 0;
            if (ti >= nx) {
                ti = nx - 1;
            }
            var zi = (z * LUT_NZ) | 0;
            if (zi >= LUT_NZ) {
                zi = LUT_NZ - 1;
            }
            var c = (zi * nx + ti) * 3;
            px[p] = lut[c];
            px[p + 1] = lut[c + 1];
            px[p + 2] = lut[c + 2];
            px[p + 3] = (v * 0.95 * 255) | 0;
        }
        texCtx.putImageData(imageData, 0, 0);
    }

    function paintStill() {
        paint(D_MAX);
    }

    /* ------------------------------------------------------------------ *
     * Drawing the finished texture (settled / drifting state)
     * ------------------------------------------------------------------ */

    function drawSettled() {
        ctx.clearRect(0, 0, cssW, cssH);
        if (periodAxis === "x") {
            var offX = ((drift % cssW) + cssW) % cssW;
            ctx.drawImage(tex, -offX, 0, cssW, cssH);
            ctx.drawImage(tex, cssW - offX, 0, cssW, cssH);
        } else {
            var offY = ((drift % cssH) + cssH) % cssH;
            ctx.drawImage(tex, 0, -offY, cssW, cssH);
            ctx.drawImage(tex, 0, cssH - offY, cssW, cssH);
        }
    }

    /* ------------------------------------------------------------------ *
     * Animation loop
     * ------------------------------------------------------------------ */

    var raf = null;
    var running = false;
    var elapsed = 0;
    var lastTs = 0;
    var acc = 0;
    var formed = false;

    function frame(ts) {
        if (!running) {
            return;
        }
        raf = requestAnimationFrame(frame);

        if (!lastTs) {
            lastTs = ts;
        }
        var dt = ts - lastTs;
        lastTs = ts;
        if (dt < 0) {
            dt = 0;
        }
        if (dt > 120) {
            dt = 120;
        }
        acc += dt;
        if (acc < 26) {
            return; /* ~38 fps ceiling; the web does not need more */
        }
        dt = acc;
        acc = 0;

        if (!formed) {
            elapsed += dt / 1000;
            var u = elapsed / GROW_SECONDS;
            var D = D_MAX * (u >= 1 ? 1 : u);
            paint(D);
            ctx.clearRect(0, 0, cssW, cssH);
            ctx.drawImage(tex, 0, 0, cssW, cssH);
            if (u >= 1) {
                formed = true;
                elapsed = 0;
                drift = 0;
            }
        } else {
            pointerX += (pointerTX - pointerX) * 0.04;
            pointerY += (pointerTY - pointerY) * 0.04;
            drift += ((DRIFT_SPEED + pointerX * 7) * dt) / 1000;
            drawSettled();
        }
    }

    function start() {
        if (running || reduceMotion) {
            return;
        }
        running = true;
        lastTs = 0;
        acc = 0;
        raf = requestAnimationFrame(frame);
    }

    function stop() {
        running = false;
        if (raf !== null) {
            cancelAnimationFrame(raf);
            raf = null;
        }
    }

    /* ------------------------------------------------------------------ *
     * Bootstrap
     * ------------------------------------------------------------------ */

    PART_N = Math.min(cssW || window.innerWidth, cssH || window.innerHeight) < 700 ? 320 : 512;

    var resizeTimer = null;
    function onResize() {
        if (resizeTimer !== null) {
            clearTimeout(resizeTimer);
        }
        resizeTimer = setTimeout(function () {
            resizeTimer = null;
            resize();
            if (reduceMotion || formed) {
                paintStill();
                drawSettled();
            }
        }, 220);
    }

    function boot() {
        buildColourLUT();
        if (MODEL === "alpt") {
            buildFieldALPT();
            if (LOCAL_STEP) {
                buildLocalStep();
            }
        } else {
            buildField();
        }

        resize();
        window.addEventListener("resize", onResize);

        if (reduceMotion) {
            paintStill();
            drawSettled();
            return;
        }

        window.addEventListener("visibilitychange", function () {
            if (document.hidden) {
                stop();
            } else {
                start();
            }
        });

        if (window.matchMedia("(pointer: fine)").matches) {
            window.addEventListener(
                "pointermove",
                function (event) {
                    if (event.pointerType === "touch") {
                        return;
                    }
                    pointerTX = (event.clientX / cssW - 0.5) * 1.4;
                    pointerTY = (event.clientY / cssH - 0.5) * 1.2;
                },
                { passive: true }
            );
        }

        start();
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(boot, 0);
    } else {
        document.addEventListener("DOMContentLoaded", function () {
            setTimeout(boot, 0);
        });
    }

    /* ------------------------------------------------------------------ *
     * Section reveal on scroll
     * ------------------------------------------------------------------ */

    document.documentElement.classList.add("js");

    var revealTargets = document.querySelectorAll("section > .container");

    if ("IntersectionObserver" in window && !reduceMotion) {
        var observer = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) {
                        return;
                    }
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                });
            },
            { threshold: 0.06, rootMargin: "0px 0px -6% 0px" }
        );

        revealTargets.forEach(function (target) {
            target.classList.add("reveal");
            observer.observe(target);
        });
    }
})();
