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

// --- Color Look-Up Tables (LUTs) ---

const COLOR_LUT_SIZE = 512;

// Palettes are stored as either a list of RGB stops (linearly interpolated)
// or a custom sampler. The first two reproduce the original density and
// thermal maps; the rest are standard scientific colormaps.
const COLORMAP_DEFINITIONS = {
    classic: {
        label: 'Classic',
        // The original density LUT sampled i / COLOR_LUT_SIZE.
        sampling: 'size',
        sample: (t) => {
            // Original CDM map: Blue -> Green -> Red
            const ratio = t * 4.0;
            let hue, sat = 90, lightness;
            if (ratio <= 1.0) {
                hue = 240 - (120 * ratio);
                lightness = 30 + (ratio * 20);
            } else {
                const k = Math.min(1.0, (ratio - 1.0) / 3.0);
                hue = 120 - (120 * k);
                lightness = 50 + (k * 20);
            }
            return hslToRgb(hue, sat, lightness);
        }
    },
    thermal: {
        label: 'Thermal',
        sample: (t) => {
            // Original gas map: Deep Blue -> Cyan -> White -> Gold
            let r, g, b;
            if (t < 0.25) {
                const local = t / 0.25;
                r = 5; g = 10 + 30 * local; b = 40 + 100 * local;
            } else if (t < 0.5) {
                const local = (t - 0.25) / 0.25;
                r = 5; g = 40 + 180 * local; b = 140 + 115 * local;
            } else if (t < 0.75) {
                const local = (t - 0.5) / 0.25;
                r = 5 + 250 * local; g = 220 + 35 * local; b = 255;
            } else {
                const local = (t - 0.75) / 0.25;
                r = 255; g = 255 - 150 * local; b = 255 - 200 * local;
            }
            return [r, g, b];
        }
    },
    viridis: {
        label: 'Viridis',
        stops: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e',
                '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']
    },
    inferno: {
        label: 'Inferno',
        stops: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60',
                '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4']
    },
    plasma: {
        label: 'Plasma',
        stops: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786',
                '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921']
    },
    magma: {
        label: 'Magma',
        stops: ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f',
                '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf']
    },
    turbo: {
        label: 'Turbo',
        stops: ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4',
                '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a',
                '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0402']
    },
    cividis: {
        label: 'Cividis',
        stops: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173',
                '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838']
    },
    coolwarm: {
        label: 'Cool–Warm',
        stops: ['#3b4cc0', '#6788ee', '#9abbff', '#c9d7f0', '#edd1c2',
                '#f7a889', '#e26952', '#b40426']
    }
};

// Which palettes are offered for each visualization mode.
const DENSITY_COLORMAPS = ['classic', 'viridis', 'inferno', 'plasma', 'magma', 'turbo', 'cividis', 'coolwarm'];
const GAS_COLORMAPS = ['thermal', 'viridis', 'inferno', 'plasma', 'magma', 'turbo', 'cividis', 'coolwarm'];

// Every palette also gets a reversed variant ("<name>-rev"). Reversed means the
// ramp runs from the palette's pale/bright end at low density down to its
// saturated end at high density, so voids can sit on a light canvas while
// over-dense knots stay coloured (see isColormapReversed / light background).
const COLORMAP_REVERSED_SUFFIX = '-rev';

Object.keys(COLORMAP_DEFINITIONS).forEach((name) => {
    COLORMAP_DEFINITIONS[name + COLORMAP_REVERSED_SUFFIX] = {
        label: COLORMAP_DEFINITIONS[name].label,
        reverseOf: name
    };
});

function clampByte(v) {
    return Math.min(255, Math.max(0, Math.round(v)));
}

function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (0 <= h && h < 60) { r = c; g = x; b = 0; }
    else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
    else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
    else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
    else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
    else if (300 <= h && h < 360) { r = c; g = 0; b = x; }
    return [clampByte((r + m) * 255), clampByte((g + m) * 255), clampByte((b + m) * 255)];
}

function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Sample a stop list at t in [0, 1] using linear sRGB interpolation.
function sampleStops(stops, t) {
    const clamped = Math.min(1, Math.max(0, t));
    const scaled = clamped * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(scaled));
    const local = scaled - i;
    const c0 = hexToRgb(stops[i]);
    const c1 = hexToRgb(stops[i + 1]);
    return [
        c0[0] + (c1[0] - c0[0]) * local,
        c0[1] + (c1[1] - c0[1]) * local,
        c0[2] + (c1[2] - c0[2]) * local
    ];
}

function buildReversedLUT(name, def) {
    const base = getColormapLUT(def.reverseOf);
    const rgb = new Float32Array(COLOR_LUT_SIZE * 3);
    const ints = new Uint32Array(COLOR_LUT_SIZE);
    const strings = new Array(COLOR_LUT_SIZE);
    const last = COLOR_LUT_SIZE - 1;
    for (let i = 0; i < COLOR_LUT_SIZE; i++) {
        const src = last - i; // low density takes the palette's bright end
        const r = clampByte(base.rgb[src * 3] * 255);
        const g = clampByte(base.rgb[src * 3 + 1] * 255);
        const b = clampByte(base.rgb[src * 3 + 2] * 255);
        rgb[i * 3] = r / 255;
        rgb[i * 3 + 1] = g / 255;
        rgb[i * 3 + 2] = b / 255;
        ints[i] = (255 << 24) | (b << 16) | (g << 8) | r;
        strings[i] = `rgb(${r},${g},${b})`;
    }
    return { name, label: def.label, reversed: true, rgb, ints, strings };
}

function buildColormapLUT(name) {
    const def = COLORMAP_DEFINITIONS[name] || COLORMAP_DEFINITIONS.classic;
    if (def.reverseOf) return buildReversedLUT(name, def);
    const rgb = new Float32Array(COLOR_LUT_SIZE * 3); // For WebGL
    const ints = new Uint32Array(COLOR_LUT_SIZE);
    const strings = new Array(COLOR_LUT_SIZE);
    for (let i = 0; i < COLOR_LUT_SIZE; i++) {
        const t = def.sampling === 'size' ? i / COLOR_LUT_SIZE : i / (COLOR_LUT_SIZE - 1);
        const raw = def.sample ? def.sample(t) : sampleStops(def.stops, t);
        const r = clampByte(raw[0]);
        const g = clampByte(raw[1]);
        const b = clampByte(raw[2]);
        rgb[i * 3] = r / 255;
        rgb[i * 3 + 1] = g / 255;
        rgb[i * 3 + 2] = b / 255;
        ints[i] = (255 << 24) | (b << 16) | (g << 8) | r;
        strings[i] = `rgb(${r},${g},${b})`;
    }
    return { name, label: def.label, rgb, ints, strings };
}

const _colormapLUTCache = Object.create(null);

function getColormapLUT(name) {
    const key = COLORMAP_DEFINITIONS[name] ? name : 'classic';
    if (!_colormapLUTCache[key]) _colormapLUTCache[key] = buildColormapLUT(key);
    return _colormapLUTCache[key];
}

function getColormapNames(kind) {
    const base = (kind === 'gas' ? GAS_COLORMAPS : DENSITY_COLORMAPS);
    return base.concat(base.map((name) => name + COLORMAP_REVERSED_SUFFIX));
}

function isColormapReversed(name) {
    return typeof name === 'string' && name.slice(-COLORMAP_REVERSED_SUFFIX.length) === COLORMAP_REVERSED_SUFFIX;
}

function getColormapBaseName(name) {
    return isColormapReversed(name) ? name.slice(0, -COLORMAP_REVERSED_SUFFIX.length) : name;
}

function getColormapLabel(name) {
    return (COLORMAP_DEFINITIONS[name] || COLORMAP_DEFINITIONS.classic).label;
}

// RGB Float32Array for WebGL / renderer use.
function getDensityLUT(name) {
    return getColormapLUT(name || 'classic').rgb;
}

function getGasLUT(name) {
    return getColormapLUT(name || 'thermal').rgb;
}

// CSS gradient string for UI previews.
function getColormapGradientCSS(name, steps = 16) {
    const lut = getColormapLUT(name);
    const parts = [];
    for (let i = 0; i < steps; i++) {
        const idx = Math.round((i / (steps - 1)) * (COLOR_LUT_SIZE - 1)) * 3;
        const r = Math.round(lut.rgb[idx] * 255);
        const g = Math.round(lut.rgb[idx + 1] * 255);
        const b = Math.round(lut.rgb[idx + 2] * 255);
        parts.push(`rgb(${r},${g},${b}) ${(i / (steps - 1) * 100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg, ${parts.join(', ')})`;
}

// --- Default LUTs (backward-compatible globals) ---
const DENSITY_LUT = getColormapLUT('classic').ints;
const DENSITY_LUT_RGB = getColormapLUT('classic').rgb;
const GAS_LUT_STRING = getColormapLUT('thermal').strings;
const GAS_LUT_RGB = getColormapLUT('thermal').rgb;

const VOID_COLORS = [
    'rgba(239, 68, 68, 0.25)', 'rgba(59, 130, 246, 0.25)', 'rgba(34, 197, 94, 0.25)',
    'rgba(168, 85, 247, 0.25)', 'rgba(251, 191, 36, 0.25)', 'rgba(236, 72, 153, 0.25)',
    'rgba(20, 184, 166, 0.25)', 'rgba(249, 115, 22, 0.25)', 'rgba(99, 102, 241, 0.25)',
    'rgba(132, 204, 22, 0.25)', 'rgba(244, 63, 94, 0.25)', 'rgba(6, 182, 212, 0.25)',
    'rgba(192, 132, 252, 0.25)', 'rgba(250, 204, 21, 0.25)', 'rgba(248, 113, 113, 0.25)',
    'rgba(134, 239, 172, 0.25)', 'rgba(253, 186, 116, 0.25)', 'rgba(147, 197, 253, 0.25)',
    'rgba(244, 114, 182, 0.25)', 'rgba(165, 180, 252, 0.25)', 'rgba(110, 231, 183, 0.25)',
    'rgba(253, 224, 71, 0.25)', 'rgba(216, 180, 254, 0.25)', 'rgba(203, 213, 225, 0.25)'
];

const VOID_COLORS_SOLID = [
    '#ef4444', '#3b82f6', '#22c55e',
    '#a855f7', '#fbbf24', '#ec4899',
    '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#f43f5e', '#06b6d4',
    '#c084fc', '#facc15', '#f87171',
    '#86efac', '#fdba74', '#93c5fd',
    '#f472b6', '#a5b4fc', '#6ee7b7',
    '#fde047', '#d8b4fe', '#cbd5e1'
];
