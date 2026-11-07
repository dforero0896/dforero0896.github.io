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

// sim-renderer.js — Canvas2D overlay drawing functions for LSS visualization

/**
 * Draw Voronoi / Void overlays on Canvas2D.
 */
function drawVoidOverlay(ctx, data, opts) {
    const { tracersPerPanel, physX, physY, voidThreshold, showVoronoi, showVoids,
            SIM_W, SIM_H, voidCenterMode } = opts;
    if (!data) return;

    const { polygons, densities, voidResults, boundarySegments, ghostPolygons } = data;

    // Voronoi mesh lines (polygon edges, when polygons available)
    if (polygons.length > 0 && showVoronoi) {
        for (let i = 0; i < tracersPerPanel; i++) {
            const poly = polygons[i];
            if (!poly || poly.length < 3) continue;
            const isLowDensity = densities[i] < voidThreshold;
            ctx.strokeStyle = isLowDensity ? 'rgba(100, 200, 255, 0.5)' : 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = isLowDensity ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(poly[0][0], poly[0][1]);
            for (let j = 1; j < poly.length; j++) ctx.lineTo(poly[j][0], poly[j][1]);
            ctx.closePath();
            ctx.stroke();
        }
    }

    // Void coloring: always dot-based (color individual tracers, not whole cells)
    if (showVoids && voidResults) {
        const meanSpacing = Math.sqrt((SIM_W * SIM_H) / tracersPerPanel);
        const dotRadius = Math.max(1.0, meanSpacing * 0.55);
        ctx.beginPath();
        let lastColor = '';
        for (let i = 0; i < tracersPerPanel; i++) {
            const vid = voidResults.voidIDs[i];
            if (vid > 0 && densities[i] < voidThreshold) {
                const colorIdx = (vid - 1) % VOID_COLORS_SOLID.length;
                const color = VOID_COLORS[colorIdx];
                if (color !== lastColor) {
                    if (lastColor) ctx.fill();
                    ctx.beginPath();
                    ctx.fillStyle = color;
                    lastColor = color;
                }
                ctx.moveTo(physX[i] + dotRadius, physY[i]);
                ctx.arc(physX[i], physY[i], dotRadius, 0, 6.283185307);
            }
        }
        if (lastColor) ctx.fill();
    }

    // Void boundaries
    if (showVoids && boundarySegments) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 3.0;
        for (let i = 0; i < boundarySegments.length; i += 4) {
            ctx.moveTo(boundarySegments[i], boundarySegments[i + 1]);
            ctx.lineTo(boundarySegments[i + 2], boundarySegments[i + 3]);
        }
        ctx.stroke();
    }

    // Void center markers
    if (showVoids && voidResults) {
        const { voidCentroids, voidMinCenters, numVoids, voidRadii } = voidResults;
        const useGeometric = voidCenterMode === 'geometric';
        const vcCenters = useGeometric ? voidCentroids : voidMinCenters;

        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.85;
        const markerSize = 6;

        for (let i = 1; i <= numVoids; i++) {
            if (voidRadii[i] < 2) continue;
            const cx = vcCenters[i * 2];
            const cy = vcCenters[i * 2 + 1];
            const colorIdx = (i - 1) % VOID_COLORS_SOLID.length;
            ctx.strokeStyle = VOID_COLORS_SOLID[colorIdx];

            ctx.beginPath();
            ctx.moveTo(cx - markerSize, cy - markerSize);
            ctx.lineTo(cx + markerSize, cy + markerSize);
            ctx.moveTo(cx + markerSize, cy - markerSize);
            ctx.lineTo(cx - markerSize, cy + markerSize);
            ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
    }
}

/**
 * Draw BAO density field overlay (radial gradients around centers).
 */
function drawDensityField(ctx, centers, baoRadiusPx, growthD, numCircles, SIM_W, SIM_H) {
    ctx.globalCompositeOperation = 'screen';
    centers.forEach(center => {
        const opacity = Math.min(1.0, 0.4 * growthD * Math.max(0.1, 1 - (numCircles / 1500)));
        const positions = [
            { x: center.x, y: center.y },
            { x: center.x + SIM_W, y: center.y },
            { x: center.x - SIM_W, y: center.y },
            { x: center.x, y: center.y + SIM_H },
            { x: center.x, y: center.y - SIM_H },
        ];
        positions.forEach(pos => {
            if (pos.x > -baoRadiusPx * 2 && pos.x < SIM_W + baoRadiusPx * 2 &&
                pos.y > -baoRadiusPx * 2 && pos.y < SIM_H + baoRadiusPx * 2) {
                const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, baoRadiusPx * 1.6);
                grad.addColorStop(0, `rgba(30, 64, 175, ${opacity * 0.8})`);
                grad.addColorStop(0.3, `rgba(30, 64, 175, ${opacity * 0.2})`);
                const rNorm = 1 / 1.6;
                grad.addColorStop(Math.max(0, rNorm - 0.3), `rgba(30, 64, 175, 0.05)`);
                grad.addColorStop(rNorm, `rgba(234, 179, 8, ${opacity * 0.4})`);
                grad.addColorStop(Math.min(1, rNorm + 0.3), `rgba(30, 64, 175, 0)`);
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, baoRadiusPx * 1.6, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    });
    ctx.globalCompositeOperation = 'source-over';
}

/**
 * Draw particle trails (history polylines or velocity vectors).
 */
function drawTrails(ctx, opts) {
    const { physX, physY, initialTracers, tracerForces, tracerForces2, trailHistory,
            velocities, tracersPerPanel, trailPercentage, trailMode,
            SIM_W, SIM_H, virialScale, isPlaying, enableLocalGravity,
            rawScale, densityFactor, dispScale, disp2Scale } = opts;

    if (trailPercentage <= 0) return;

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    const visibleCount = Math.floor(tracersPerPanel * (trailPercentage / 100));

    if (trailMode === 'history') {
        if (isPlaying && enableLocalGravity) {
            for (let k = 0; k < visibleCount; k++) {
                const path = trailHistory[k].path;
                if (path.length > 2) {
                    ctx.moveTo(path[0], path[1]);
                    for (let p = 2; p < path.length; p += 2) {
                        if (Math.abs(path[p] - path[p - 2]) < 100 && Math.abs(path[p + 1] - path[p - 1]) < 100) {
                            ctx.lineTo(path[p], path[p + 1]);
                        } else {
                            ctx.moveTo(path[p], path[p + 1]);
                        }
                    }
                }
            }
        } else {
            const startGrowthD = TARGET_VISUAL_D1_START;
            const startDispScale = startGrowthD * DISP_SCALE_FACTOR * Math.min(1.0, rawScale) * densityFactor;
            const startDisp2Scale = (-3 / 7) * startGrowthD * startDispScale;
            for (let k = 0; k < visibleCount; k++) {
                const g = initialTracers[k];
                const bx0 = g.qx + tracerForces[k * 2] * startDispScale
                                  + tracerForces2[k * 2] * startDisp2Scale;
                const by0 = g.qy + tracerForces[k * 2 + 1] * startDispScale
                                  + tracerForces2[k * 2 + 1] * startDisp2Scale;
                const startX = ((bx0 % SIM_W) + SIM_W) % SIM_W;
                const startY = ((by0 % SIM_H) + SIM_H) % SIM_H;
                let endX = physX[k];
                let endY = physY[k];
                const distSq = (endX - startX) ** 2 + (endY - startY) ** 2;
                if (distSq > 0.5 && Math.abs(endX - startX) < SIM_W / 2 && Math.abs(endY - startY) < SIM_H / 2) {
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(endX, endY);
                }
            }
        }
    } else {
        // Velocity vectors — find max magnitude, then scale so longest = MAX_VEC_LEN
        const MAX_VEC_LEN = 30; // pixels
        let maxMag = 0;
        for (let k = 0; k < visibleCount; k++) {
            const vx = velocities[k * 2];
            const vy = velocities[k * 2 + 1];
            const mag = Math.sqrt(vx * vx + vy * vy);
            if (mag > maxMag) maxMag = mag;
        }
        const vecScale = maxMag > 0 ? MAX_VEC_LEN / maxMag : 1;
        for (let k = 0; k < visibleCount; k++) {
            const px = physX[k];
            const py = physY[k];
            const vx = velocities[k * 2];
            const vy = velocities[k * 2 + 1];
            const tipX = px + vx * vecScale;
            const tipY = py + vy * vecScale;
            ctx.moveTo(px, py);
            ctx.lineTo(tipX, tipY);
            const headLen = 3;
            const angle = Math.atan2(vy, vx);
            ctx.lineTo(tipX - headLen * Math.cos(angle - Math.PI / 6), tipY - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 6), tipY - headLen * Math.sin(angle + Math.PI / 6));
        }
    }
    ctx.stroke();
}

/**
 * Draw initial-position overlay (magenta dots).
 */
function drawInitialOverlay(ctx, initialTracers, tracerForces, tracerForces2, tracersPerPanel, SIM_W, SIM_H, startDispScale, startDisp2Scale) {
    ctx.fillStyle = 'rgba(255, 0, 255, 0.3)';
    for (let i = 0; i < tracersPerPanel; i++) {
        const g = initialTracers[i];
        const bx0 = g.qx + tracerForces[i * 2] * startDispScale
                        + tracerForces2[i * 2] * startDisp2Scale;
        const by0 = g.qy + tracerForces[i * 2 + 1] * startDispScale
                        + tracerForces2[i * 2 + 1] * startDisp2Scale;
        const x = ((bx0 % SIM_W) + SIM_W) % SIM_W;
        const y = ((by0 % SIM_H) + SIM_H) % SIM_H;
        ctx.fillRect(x, y, 2, 2);
    }
}

/**
 * Draw distance ruler overlay (dashed red line with Mpc label).
 */
function drawRuler(ctx, start, current, pxPerMpc) {
    if (!start || !current) return;
    ctx.beginPath();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distMpc = distPx / pxPerMpc;
    const midX = (start.x + current.x) / 2;
    const midY = (start.y + current.y) / 2;
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${distMpc.toFixed(1)} Mpc`, midX, midY - 10);
}

/**
 * Wrap text into multiple lines constrained by maxWidth.
 */
function wrapCanvasText(ctx, text, maxWidth) {
    const value = String(text || '');
    if (!value) return [''];

    const lines = [];
    let currentLine = '';

    const pushChunkedWord = (word) => {
        let chunk = '';
        for (const ch of word) {
            const testChunk = chunk + ch;
            if (ctx.measureText(testChunk).width <= maxWidth || chunk.length === 0) {
                chunk = testChunk;
            } else {
                lines.push(chunk);
                chunk = ch;
            }
        }
        if (chunk) lines.push(chunk);
    };

    for (const word of value.split(' ')) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width <= maxWidth) {
            currentLine = testLine;
            continue;
        }

        if (currentLine) {
            lines.push(currentLine);
            currentLine = '';
        }

        if (ctx.measureText(word).width <= maxWidth) {
            currentLine = word;
        } else {
            pushChunkedWord(word);
        }
    }

    if (currentLine) lines.push(currentLine);
    return lines.length ? lines : [''];
}

/**
 * Draw void statistics legend box.
 */
function drawVoidStats(ctx, voidResults, voidThreshold, minVoidRadius, pxPerMpc, SIM_W, SIM_H, dict) {
    if (!voidResults || voidResults.numVoids <= 0) return;
    const d = dict || {};

    let totalRPx = 0;
    let count = 0;
    for (let i = 1; i <= voidResults.numVoids; i++) {
        if (voidResults.voidRadii[i] >= 5) {
            totalRPx += voidResults.voidRadii[i];
            count++;
        }
    }
    const meanRPx = count > 0 ? totalRPx / count : 0;
    const meanRMpc = meanRPx / pxPerMpc;

    const legendY = Math.max(150, SIM_H * 0.3);
    const boxW = 240;
    const minBoxH = 100;
    const boxX = SIM_W - boxW - 20;

    const titleText = `${d.voidsFound} ${count}`;
    const lineTexts = [
        `${d.colorCutoff}: ${voidThreshold.toFixed(2)}${d.timesMeanDensity}`,
        `${d.minRadius}: ${minVoidRadius} ${d.mpcUnit}`,
        `${d.meanRadius}: ${meanRMpc.toFixed(1)} ${d.mpcUnit}`
    ];
    const textX = boxX + 12;
    const maxTextWidth = boxW - 24;

    ctx.font = 'bold 19px Inter';
    const titleLines = wrapCanvasText(ctx, titleText, maxTextWidth);
    ctx.font = '17px Inter';
    const wrappedLines = lineTexts.map(text => wrapCanvasText(ctx, text, maxTextWidth));

    const titleLineStep = 25;
    const bodyLineStep = 22;
    const contentTopPadding = 24;
    const contentBottomPadding = 12;
    const contentHeight =
        (titleLines.length * titleLineStep) +
        (wrappedLines.reduce((sum, lines) => sum + (lines.length * bodyLineStep), 0));
    const boxH = Math.max(minBoxH, contentTopPadding + contentHeight + contentBottomPadding - 22);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
    ctx.fillRect(boxX, legendY, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(boxX, legendY, boxW, boxH);

    let currentY = legendY + 24;

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 19px Inter';
    ctx.textAlign = 'left';
    for (const line of titleLines) {
        ctx.fillText(line, textX, currentY);
        currentY += titleLineStep;
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '17px Inter';
    for (const lines of wrappedLines) {
        for (const line of lines) {
            ctx.fillText(line, textX, currentY);
            currentY += bodyLineStep;
        }
    }
}

/**
 * Draw the discrete colorbar legend for the 2D cosmic web classification.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} data - result of computeWebClassification
 * @param {object} opts - { dict, boxX, boxY, light }
 */
function drawWebColorbar(ctx, data, opts) {
    const o = opts || {};
    const d = o.dict || {};
    const light = !!o.light;
    // The sidebar overlays the left edge of the canvas when it is expanded;
    // keep the legend clear of it, mirroring how drawScaleBar offsets.
    const defaultX = o.isSidebarCollapsed === false ? 336 : 18;
    const boxX = o.boxX === undefined ? defaultX : o.boxX;
    const boxY = o.boxY === undefined ? 18 : o.boxY;

    if (data && data.hierarchical) {
        drawWebHierColorbar(ctx, data, {
            dict: d, light, boxX, boxY,
            isSidebarCollapsed: o.isSidebarCollapsed,
            highlight: o.highlight
        });
        return;
    }

    const colors = (typeof WEB_CLASS_COLORS !== 'undefined') ? WEB_CLASS_COLORS : [[59, 130, 246], [245, 158, 11], [239, 68, 68]];
    const labels = [d.webVoid || 'Void', d.webFilament || 'Filament', d.webKnot || 'Knot'];
    const title = d.webClassLegend || 'Cosmic web';

    const cellW = 92;
    const cellH = 14;
    const pad = 10;
    const boxW = cellW * labels.length + pad * 2;
    const boxH = 80;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = light ? 'rgba(255,255,255,0.82)' : 'rgba(15,23,42,0.72)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    ctx.fillStyle = light ? '#111827' : '#e2e8f0';
    ctx.font = 'bold 13px "Inter", sans-serif';
    ctx.fillText(title, boxX + boxW / 2, boxY + 18);

    const barY = boxY + 24;
    for (let i = 0; i < labels.length; i++) {
        const c = colors[i];
        const x = boxX + pad + i * cellW;
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(x, barY, cellW, cellH);
        ctx.strokeStyle = light ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.35)';
        ctx.strokeRect(x + 0.5, barY + 0.5, cellW - 1, cellH - 1);

        ctx.fillStyle = light ? '#111827' : '#cbd5e1';
        ctx.font = '12px "Inter", sans-serif';
        ctx.fillText(labels[i], x + cellW / 2, barY + cellH + 16);
    }

    // Field / smoothing annotation so an exported still is self-describing.
    const basisText = data.basis === 'delta' ? (d.webFieldDelta || 'density') : (d.webFieldPhi || 'potential');
    const sub = `${basisText} · R=${(data.smoothingMpc || 0).toFixed(1)} ${d.mpcUnit || 'Mpc'}`;
    ctx.fillStyle = light ? 'rgba(17,24,39,0.62)' : 'rgba(203,213,225,0.62)';
    ctx.font = '11px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(sub, boxX + pad, boxY + boxH - 7);
    ctx.restore();
}

/**
 * Geometry of the hierarchical legend box. Shared by the drawing code and by
 * click hit-testing so the two can never drift apart.
 *
 * @param {object} data - result of computeWebHierarchy
 * @param {object} opts - { boxX, boxY, isSidebarCollapsed }
 */
function webHierColorbarGeometry(data, opts) {
    const o = opts || {};
    const defaultX = o.isSidebarCollapsed === false ? 336 : 18;
    const boxX = o.boxX === undefined ? defaultX : o.boxX;
    const boxY = o.boxY === undefined ? 18 : o.boxY;
    const cellW = 74;
    const cellH = 16;
    const rowLabelW = 78;
    const pad = 10;
    return {
        boxX, boxY, pad, rowLabelW, cellW, cellH,
        boxW: pad * 2 + rowLabelW + cellW * 3,
        boxH: 122,
        gridX: boxX + pad + rowLabelW,
        gridY: boxY + 44
    };
}

/**
 * Map a pointer position, in canvas coordinates, onto a hierarchical class.
 *
 * @returns {number} class index 0..8, or -1 when outside the matrix cells.
 */
function webHierColorbarCellAt(mx, my, data, opts) {
    if (!data || !data.hierarchical) return -1;
    const g = webHierColorbarGeometry(data, opts);
    if (mx < g.gridX || mx >= g.gridX + g.cellW * 3) return -1;
    if (my < g.gridY || my >= g.gridY + g.cellH * 3) return -1;
    const j = Math.floor((mx - g.gridX) / g.cellW);
    const i = Math.floor((my - g.gridY) / g.cellH);
    return i * 3 + j;
}

/**
 * Readable name of a hierarchical class, e.g. "voids-in-filaments".
 * Class index is coarse (level 0) * 3 + fine (level 1).
 *
 * @param {number} idx - class index 0..8
 * @param {object} dict - i18n dictionary
 */
function webHierClassName(idx, dict) {
    const d = dict || {};
    const voids = d.webVoidPlural || 'voids';
    const filaments = d.webFilamentPlural || 'filaments';
    const knots = d.webKnotPlural || 'knots';
    const i = Math.floor(idx / 3), j = idx % 3;
    if (!(idx >= 0 && idx <= 8)) return '';
    return `${[voids, filaments, knots][j]}${d.webIn || '-in-'}${[voids, filaments, knots][i]}`;
}

/**
 * Colorbar for the hierarchical classification: a 3x3 matrix whose rows are the
 * level-0 (coarse, phi) environments and whose columns are the level-1 (fine,
 * delta) environments. Cell (i, j) therefore reads "<fine j>-in-<coarse i>".
 *
 * When a cell is highlighted the legend dims the other eight and prints a
 * caption naming the isolated environment, so the picture is self-describing.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} data - result of computeWebHierarchy
 * @param {object} opts - { dict, light, boxX, boxY, isSidebarCollapsed, highlight }
 */
function drawWebHierColorbar(ctx, data, opts) {
    const o = opts || {};
    const d = o.dict || {};
    const light = !!o.light;
    const palette = data.palette || (typeof WEB_HIER_COLORS !== 'undefined' ? WEB_HIER_COLORS : []);
    const hl = (o.highlight === undefined || o.highlight === null || o.highlight < 0) ? -1 : o.highlight;

    const coarse = [d.webVoid || 'Void', d.webFilament || 'Filament', d.webKnot || 'Knot'];
    const fine = [d.webVoidShort || 'void', d.webFilamentShort || 'fil', d.webKnotShort || 'knot'];
    // Tagging every axis entry with its field makes the direction unmistakable:
    // the cell label always reads "<delta level>-in-<phi level>", so
    // knots-in-voids is a delta-knot inside a large-scale phi-void.
    const phiTag = d.webFieldPhiShort || '\u03c6';
    const deltaTag = d.webFieldDeltaShort || '\u03b4';

    const g = webHierColorbarGeometry(data, opts);
    const { boxX, boxY, boxW, boxH, pad, cellW, cellH, gridX, gridY } = g;

    ctx.save();
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = light ? 'rgba(255,255,255,0.86)' : 'rgba(15,23,42,0.78)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    // Title.
    const title = d.webClassLegendHier || 'Cosmic web (hierarchical)';
    ctx.textAlign = 'center';
    ctx.fillStyle = light ? '#111827' : '#e2e8f0';
    ctx.font = 'bold 12px "Inter", sans-serif';
    ctx.fillText(title, boxX + boxW / 2, boxY + 17);

    // Column headers: the finer level 1 (delta) environment.
    ctx.fillStyle = light ? 'rgba(17,24,39,0.70)' : 'rgba(203,213,225,0.72)';
    ctx.font = '10px "Inter", sans-serif';
    ctx.textAlign = 'center';
    for (let j = 0; j < 3; j++) {
        ctx.fillText(`${deltaTag}-${fine[j]}`, gridX + j * cellW + cellW / 2, gridY - 6);
    }
    // Name the row axis next to the labels it applies to, so nobody has to
    // infer the direction from an arrow in the opposite corner.
    ctx.textAlign = 'left';
    ctx.fillText(`\u2193 ${d.webLevel0Short || 'L0'}`, boxX + pad, gridY - 6);

    // Matrix cells.
    for (let i = 0; i < 3; i++) {
        const y = gridY + i * cellH;
        // Row label: the coarser level 0 (phi) parent environment.
        ctx.globalAlpha = (hl >= 0 && Math.floor(hl / 3) !== i) ? 0.4 : 1;
        ctx.fillStyle = light ? '#111827' : '#cbd5e1';
        ctx.font = '11px "Inter", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${phiTag}-${coarse[i]}`, gridX - 6, y + cellH - 4);
        ctx.globalAlpha = 1;

        for (let j = 0; j < 3; j++) {
            const idx = i * 3 + j;
            const c = palette[idx] || [128, 128, 128];
            const x = gridX + j * cellW;
            ctx.globalAlpha = (hl >= 0 && idx !== hl) ? 0.28 : 1;
            ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
            ctx.fillRect(x, y, cellW, cellH);
            ctx.strokeStyle = light ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.35)';
            ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
            ctx.globalAlpha = 1;
            if (idx === hl) {
                ctx.strokeStyle = light ? '#111827' : '#ffffff';
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);
                ctx.lineWidth = 1;
            }
        }
    }

    // Axis / scale annotation, so an exported still is self-describing.
    ctx.textAlign = 'left';
    ctx.fillStyle = light ? 'rgba(17,24,39,0.62)' : 'rgba(203,213,225,0.62)';
    ctx.font = '10px "Inter", sans-serif';
    const mpc = d.mpcUnit || 'Mpc';
    ctx.fillText(`${d.webLevel0Short || 'L0'} φ R=${(data.smoothingMpcCoarse || 0).toFixed(1)} ${mpc}` +
        ` · ${d.webLevel1Short || 'L1'} δ R=${(data.smoothingMpcFine || 0).toFixed(1)} ${mpc}`,
        boxX + pad, boxY + boxH - 8);

    if (hl >= 0) {
        // Caption naming the isolated environment, with its area share.
        const counts = data.counts || [];
        const total = counts.reduce((a, b) => a + b, 0) || 1;
        const share = (counts[hl] || 0) / total * 100;
        const pillY = boxY + boxH + 6;
        const pillH = 54;
        const sc = palette[hl] || [128, 128, 128];
        const unit = d.mpcUnit || 'Mpc';
        // Spell out the spatial reading so the label cannot be misread: the
        // delta-level structure sits inside the phi-level (large-scale) region.
        const roleLine = `${deltaTag} R=${(data.smoothingMpcFine || 0).toFixed(1)} ${unit}` +
            `${d.webIn || '-in-'}${phiTag} R=${(data.smoothingMpcCoarse || 0).toFixed(1)} ${unit}`;
        ctx.fillStyle = light ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.88)';
        ctx.fillRect(boxX, pillY, boxW, pillH);
        ctx.fillStyle = `rgb(${sc[0]},${sc[1]},${sc[2]})`;
        ctx.fillRect(boxX, pillY, 5, pillH);
        ctx.strokeStyle = light ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)';
        ctx.strokeRect(boxX + 0.5, pillY + 0.5, boxW - 1, pillH - 1);
        ctx.textAlign = 'left';
        ctx.fillStyle = light ? '#111827' : '#e2e8f0';
        ctx.font = 'bold 13px "Inter", sans-serif';
        ctx.fillText(webHierClassName(hl, d), boxX + 13, pillY + 17);
        ctx.fillStyle = light ? 'rgba(17,24,39,0.78)' : 'rgba(203,213,225,0.78)';
        ctx.font = '10px "Inter", sans-serif';
        ctx.fillText(roleLine, boxX + 13, pillY + 31);
        ctx.fillStyle = light ? 'rgba(17,24,39,0.60)' : 'rgba(203,213,225,0.60)';
        ctx.font = '9px "Inter", sans-serif';
        ctx.fillText(`${share.toFixed(1)}% · ${d.webHierClickAgain || 'click again to clear'}`,
            boxX + 13, pillY + 45);
    } else {
        ctx.textAlign = 'left';
        ctx.fillStyle = light ? 'rgba(17,24,39,0.55)' : 'rgba(203,213,225,0.55)';
        ctx.font = '9px "Inter", sans-serif';
        ctx.fillText(d.webHierClickHint || 'click a cell to isolate it', boxX + pad, boxY + boxH + 12);
    }
    ctx.restore();
}

/**
 * Draw the 2D cosmic web classification as a translucent background layer.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} data - result of computeWebClassification (cached across frames)
 * @param {object} opts - { SIM_W, SIM_H, dict, light, showColorbar }
 */
function drawWebOverlay(ctx, data, opts) {
    if (!data || !data.classes || !(data.gridN > 0)) return;
    const o = opts || {};
    const SIM_W = o.SIM_W || data.simW;
    const SIM_H = o.SIM_H || data.simH;
    const gridN = data.gridN;
    const colors = data.palette
        || ((typeof WEB_CLASS_COLORS !== 'undefined') ? WEB_CLASS_COLORS : [[59, 130, 246], [245, 158, 11], [239, 68, 68]]);
    const alphas = data.alphas
        || ((typeof WEB_CLASS_ALPHA !== 'undefined') ? WEB_CLASS_ALPHA : [0.32, 0.38, 0.48]);

    // Isolating one hierarchical class dims the rest so the selected environment
    // carries the picture on its own. Keyed into the cache below, since the
    // pixel buffer depends on it.
    const hlRaw = o.highlight;
    const hl = (hlRaw === undefined || hlRaw === null || hlRaw < 0) ? -1 : hlRaw;

    if (!data._canvas || data._canvasKey !== hl) {
        const cv = document.createElement('canvas');
        cv.width = gridN;
        cv.height = gridN;
        const c2 = cv.getContext('2d');
        const img = c2.createImageData(gridN, gridN);
        const px = img.data;
        for (let i = 0; i < gridN * gridN; i++) {
            const cls = data.classes[i];
            const c = colors[cls] || colors[0];
            const a = alphas[cls] === undefined ? 0.4 : alphas[cls];
            px[4 * i] = c[0];
            px[4 * i + 1] = c[1];
            px[4 * i + 2] = c[2];
            let outA = a;
            if (hl >= 0) {
                // Selected class: push towards opaque. Everything else: a faint
                // ghost, so the surrounding large-scale structure stays readable.
                outA = (cls === hl) ? Math.min(1, a * 2.2 + 0.25) : 0.045;
            }
            px[4 * i + 3] = Math.round(outA * 255);
        }
        c2.putImageData(img, 0, 0);
        data._canvas = cv;
        data._canvasKey = hl;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (ctx.globalCompositeOperation !== 'source-over') ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(data._canvas, 0, 0, SIM_W, SIM_H);
    ctx.restore();

    if (o.showColorbar !== false) {
        drawWebColorbar(ctx, data, {
            dict: o.dict,
            light: o.light,
            isSidebarCollapsed: o.isSidebarCollapsed,
            highlight: hl >= 0 ? hl : null
        });
    }
}

/**
 * Draw comoving scale bar.
 */
function drawScaleBar(ctx, pxPerMpc, SIM_H, isSidebarCollapsed, isB, dict) {
    const d = dict || {};
    const possibleSteps = [50, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000];
    let scaleBarMpc = possibleSteps[0];
    let minDiff = Math.abs((280 / pxPerMpc) - possibleSteps[0]);
    for (let step of possibleSteps) {
        const diff = Math.abs((280 / pxPerMpc) - step);
        if (diff < minDiff) { minDiff = diff; scaleBarMpc = step; }
    }
    const scaleBarPx = scaleBarMpc * pxPerMpc;
    const scaleX = isB ? 20 : (isSidebarCollapsed ? 90 : 410);
    const scaleY = SIM_H - 50;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(scaleX, scaleY, scaleBarPx, 4);
    ctx.fillRect(scaleX, scaleY - 8, 2, 20);
    ctx.fillRect(scaleX + scaleBarPx, scaleY - 8, 2, 20);
    ctx.font = '22px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${scaleBarMpc} ${d.mpcUnit}`, scaleX + (scaleBarPx / 2), scaleY - 16);
    ctx.font = '14px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(d.comovingCoords, scaleX + (scaleBarPx / 2), scaleY + 18);
}

/**
 * Draw split-screen panel info box (cosmology params, redshift, age, BAO scale).
 */
function drawPanelInfoBox(ctx, opts) {
    const { currentZ, pOm, pOl, pW0, pWa, pCosmoMode, pBaoRadiusMpc,
            isB, cWidth, cHeight, dict } = opts;
    const d = dict || {};

    const panelAgeGyr = calculateAgeGyr(currentZ, pOm, pOl, pW0, pWa);

    ctx.save();
    const panelColor = isB ? 'rgba(251,191,36,0.95)' : 'rgba(96,165,250,0.95)';
    const panelLabel = isB ? d.panelB : d.panelA;
    const fontSize = 16;
    const subFontSize = Math.round(fontSize * 0.68);
    const lineH = fontSize + 6;

    const drawOmegaSub = (sub, x, y) => {
        ctx.font = `bold ${fontSize}px Inter`;
        ctx.fillText('\u03A9', x, y);
        const w1 = ctx.measureText('\u03A9').width;
        ctx.font = `bold ${subFontSize}px Inter`;
        ctx.fillText(sub, x + w1, y + fontSize * 0.22);
        const w2 = ctx.measureText(sub).width;
        ctx.font = `bold ${fontSize}px Inter`;
        return w1 + w2;
    };

    const hasWLine = (pCosmoMode === 'wCDM' || pCosmoMode === 'w0wa');

    ctx.font = `bold ${fontSize}px Inter`;
    const omLineEst = ctx.measureText('\u03A9m = 0.30   \u03A9\u039B = 0.70').width + 12;
    const labelEst = ctx.measureText(panelLabel).width + 12;
    ctx.font = `${fontSize}px Inter`;
    const timeText = `z = ${currentZ.toFixed(2)}     ${panelAgeGyr.toFixed(2)} Gyr`;
    const timeW = ctx.measureText(timeText).width;
    const baoText = `${d.baoScale} ${Math.round(pBaoRadiusMpc)} ${d.mpcUnit}`;
    const baoW = ctx.measureText(baoText).width;
    let wLineText = '';
    let wLineW = 0;
    if (hasWLine) {
        if (pCosmoMode === 'wCDM') {
            wLineText = `w = ${pW0.toFixed(2)}`;
        } else {
            wLineText = `w\u2080 = ${pW0.toFixed(2)}   w\u2090 = ${pWa.toFixed(2)}`;
        }
        wLineW = ctx.measureText(wLineText).width;
    }

    const boxPad = 14;
    const baseContentW = Math.max(labelEst, omLineEst, timeW, wLineW);
    const boxW = baseContentW + boxPad * 2;
    const maxTextWidth = boxW - boxPad * 2;

    ctx.font = `bold ${fontSize + 2}px Inter`;
    const panelLabelLines = wrapCanvasText(ctx, panelLabel, maxTextWidth);
    ctx.font = `${fontSize}px Inter`;
    const wLineLines = hasWLine ? wrapCanvasText(ctx, wLineText, maxTextWidth) : [];
    const timeLines = wrapCanvasText(ctx, timeText, maxTextWidth);
    ctx.font = `${fontSize - 1}px Inter`;
    const baoLines = wrapCanvasText(ctx, baoText, maxTextWidth);

    const minNumLines = (hasWLine ? 5 : 4);
    const minBoxH = minNumLines * lineH + boxPad * 2 - 4;
    const totalLineSteps = panelLabelLines.length + 1 + wLineLines.length + timeLines.length + baoLines.length;
    const boxH = Math.max(minBoxH, totalLineSteps * lineH + boxPad * 2 - 4);

    const boxX = isB ? 4 : (cWidth - boxW - 4);
    const boxY = Math.round((cHeight - boxH) / 2);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    const r = 6;
    ctx.moveTo(boxX + r, boxY);
    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
    ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
    ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
    ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const textX = boxX + boxPad;
    ctx.textAlign = 'left';
    let ly = boxY + boxPad + fontSize;

    ctx.font = `bold ${fontSize + 2}px Inter`;
    ctx.fillStyle = panelColor;
    for (const line of panelLabelLines) {
        ctx.fillText(line, textX, ly);
        ly += lineH;
    }

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    let ox = textX;
    ox += drawOmegaSub('m', ox, ly);
    ctx.font = `bold ${fontSize}px Inter`;
    const eqM = ` = ${pOm.toFixed(2)}   `;
    ctx.fillText(eqM, ox, ly);
    ox += ctx.measureText(eqM).width;
    ox += drawOmegaSub('\u039B', ox, ly);
    ctx.font = `bold ${fontSize}px Inter`;
    ctx.fillText(` = ${pOl.toFixed(2)}`, ox, ly);
    ly += lineH;

    if (hasWLine) {
        ctx.font = `${fontSize}px Inter`;
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        for (const line of wLineLines) {
            ctx.fillText(line, textX, ly);
            ly += lineH;
        }
    }

    ctx.font = `${fontSize}px Inter`;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    for (const line of timeLines) {
        ctx.fillText(line, textX, ly);
        ly += lineH;
    }

    ctx.font = `${fontSize - 1}px Inter`;
    ctx.fillStyle = 'rgba(251,191,36,0.7)';
    for (const line of baoLines) {
        ctx.fillText(line, textX, ly);
        ly += lineH;
    }

    ctx.restore();
}

/* ====================================================================
 * Measured Power Spectrum P(k)
 * ====================================================================
 * CIC mass assignment → 2D FFT → radial binning in k-space.
 * Handles rectangular (non-square) boxes and periodic boundary conditions.
 * Returns { kBins: Float64Array, pkBins: Float64Array, numBins: int }.
 */

// Cooley-Tukey radix-2 FFT (in-place, interleaved real/imag)
function _fft1d(re, im, n, invert) {
    // Bit-reversal permutation
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
        const half = len >> 1;
        const ang = 2 * Math.PI / len * (invert ? -1 : 1);
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < half; j++) {
                const a = i + j, b = i + j + half;
                const tRe = re[b] * curRe - im[b] * curIm;
                const tIm = re[b] * curIm + im[b] * curRe;
                re[b] = re[a] - tRe;
                im[b] = im[a] - tIm;
                re[a] += tRe;
                im[a] += tIm;
                const nRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nRe;
            }
        }
    }
    if (invert) {
        for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
}

/**
 * Bluestein's FFT for arbitrary-length DFT.
 * Wraps any size-N DFT into three radix-2 FFTs of size M (next pow2 ≥ 2N-1).
 * Falls through to _fft1d for power-of-2 input.
 * Precomputed chirp tables and work arrays are cached per N.
 */
const _bsCache = new Map();

function _fft_any(re, im, n, invert) {
    // Power-of-2: fast radix-2 path
    if ((n & (n - 1)) === 0) {
        _fft1d(re, im, n, invert);
        return;
    }

    // Get or build cached tables for this size
    let c = _bsCache.get(n);
    if (!c) {
        let M = 1;
        while (M < 2 * n - 1) M <<= 1;

        // Chirp: cos(π k²/N) and sin(π k²/N)
        const cc = new Float64Array(n);
        const cs = new Float64Array(n);
        for (let k = 0; k < n; k++) {
            const a = Math.PI * k * k / n;
            cc[k] = Math.cos(a);
            cs[k] = Math.sin(a);
        }

        // Forward b-sequence: b[m] = conj(α_m) = (cc, +cs)
        // wrapped for circular convolution of length M
        const bfRe = new Float64Array(M);
        const bfIm = new Float64Array(M);
        bfRe[0] = cc[0]; bfIm[0] = cs[0];
        for (let k = 1; k < n; k++) {
            bfRe[k] = cc[k];     bfIm[k] = cs[k];
            bfRe[M - k] = cc[k]; bfIm[M - k] = cs[k];
        }
        _fft1d(bfRe, bfIm, M, false);

        // Inverse b-sequence: b[m] = α_m = (cc, -cs)
        const biRe = new Float64Array(M);
        const biIm = new Float64Array(M);
        biRe[0] = cc[0]; biIm[0] = -cs[0];
        for (let k = 1; k < n; k++) {
            biRe[k] = cc[k];     biIm[k] = -cs[k];
            biRe[M - k] = cc[k]; biIm[M - k] = -cs[k];
        }
        _fft1d(biRe, biIm, M, false);

        c = { M, cc, cs, bfRe, bfIm, biRe, biIm,
              wRe: new Float64Array(M), wIm: new Float64Array(M) };
        _bsCache.set(n, c);
    }

    const { M, cc, cs, wRe, wIm } = c;
    const bRe = invert ? c.biRe : c.bfRe;
    const bIm = invert ? c.biIm : c.bfIm;

    // Step 1: a[j] = x[j] · chirpFactor[j]
    // Forward: chirpFactor = α = (cc, -cs);  Inverse: chirpFactor = conj(α) = (cc, +cs)
    wRe.fill(0); wIm.fill(0);
    if (!invert) {
        for (let j = 0; j < n; j++) {
            wRe[j] = re[j] * cc[j] + im[j] * cs[j];
            wIm[j] = im[j] * cc[j] - re[j] * cs[j];
        }
    } else {
        for (let j = 0; j < n; j++) {
            wRe[j] = re[j] * cc[j] - im[j] * cs[j];
            wIm[j] = re[j] * cs[j] + im[j] * cc[j];
        }
    }

    // Step 2: FFT(a)
    _fft1d(wRe, wIm, M, false);

    // Step 3: Pointwise multiply by precomputed FFT(b)
    for (let k = 0; k < M; k++) {
        const tr = wRe[k] * bRe[k] - wIm[k] * bIm[k];
        const ti = wRe[k] * bIm[k] + wIm[k] * bRe[k];
        wRe[k] = tr; wIm[k] = ti;
    }

    // Step 4: IFFT (radix-2, M is always power-of-2)
    _fft1d(wRe, wIm, M, true);

    // Step 5: X[k] = chirpFactor[k] · conv[k]
    if (!invert) {
        for (let k = 0; k < n; k++) {
            re[k] = wRe[k] * cc[k] + wIm[k] * cs[k];
            im[k] = wIm[k] * cc[k] - wRe[k] * cs[k];
        }
    } else {
        for (let k = 0; k < n; k++) {
            re[k] = (wRe[k] * cc[k] - wIm[k] * cs[k]) / n;
            im[k] = (wRe[k] * cs[k] + wIm[k] * cc[k]) / n;
        }
    }
}

// Throttle/cache for P(k) computation (expensive FFT) — per-panel, plus a
// separate slot for the bias-weighted spectrum ("<panel>:bias").
const _pkCaches = {};   // keyed by panelId (or "panelId:bias")
const _pkCacheTimes = {};
const _PK_THROTTLE_MS = 500;

function computePowerSpectrum(physX, physY, N, SIM_W, SIM_H, pxPerMpc, panelId, weights) {
    panelId = panelId || 0;
    // The unweighted (DM) and bias-weighted spectra have their own cache slots
    // so the two curves can be requested in the same frame.
    const cacheKey = weights ? panelId + ':bias' : String(panelId);
    const now = performance.now();
    if (_pkCaches[cacheKey] && (now - _pkCacheTimes[cacheKey]) < _PK_THROTTLE_MS) {
        return _pkCaches[cacheKey];
    }

    // Grid: cells are exactly square in pixel space.
    // Longer axis gets maxCells; shorter axis scales proportionally (any integer).
    // Bluestein FFT handles non-power-of-2 sizes.
    const maxCells = 512;
    const longerPx = Math.max(SIM_W, SIM_H);
    const cellPx = Math.max(1, longerPx / maxCells);
    const NX = Math.max(64, Math.round(SIM_W / cellPx));
    const NY = Math.max(64, Math.round(SIM_H / cellPx));

    // Physical box size in Mpc/h for each axis (h = 0.674)
    // pxPerMpc is in px/Mpc, so Lx is in Mpc. Multiply by h to get Mpc/h
    // so k comes out in h/Mpc and P(k) in (Mpc/h)² — standard convention.
    const h = PLANCK_H;
    const LxMpc = (SIM_W / pxPerMpc) * h;
    const LyMpc = (SIM_H / pxPerMpc) * h;

    // Interlacing for Nyquist Aliasing Suppression
    // Reference: Sefusatti et al. 2016 (arXiv:1512.07295)
    // To suppress aliasing at high k, we use two CIC grids shifted by half
    // a cell, FFT both, and combine them with a phase shift (Eq. 33).
    // CIC mass assignment (periodic)
    const grid1 = new Float64Array(NX * NY);
    const grid2 = new Float64Array(NX * NY);
    const cellWPx = SIM_W / NX;
    const cellHPx = SIM_H / NY;
    // With weights the "mass" per tracer is its bias weight, so the mean used
    // to build the overdensity is the mean deposited weight, not N/cells.
    let totalWeight = N;
    if (weights) {
        totalWeight = 0;
        for (let i = 0; i < N; i++) totalWeight += weights[i];
        if (!(totalWeight > 0)) totalWeight = N;
    }
    const meanDensity = totalWeight / (NX * NY);

    for (let i = 0; i < N; i++) {
        const w = weights ? weights[i] : 1;
        // First grid (standard)
        const gx1 = physX[i] / cellWPx - 0.5;
        const gy1 = physY[i] / cellHPx - 0.5;
        const ix1 = Math.floor(gx1);
        const iy1 = Math.floor(gy1);
        const dx1 = gx1 - ix1;
        const dy1 = gy1 - iy1;

        const ix1_0 = ((ix1 % NX) + NX) % NX;
        const iy1_0 = ((iy1 % NY) + NY) % NY;
        const ix1_1 = (ix1_0 + 1) % NX;
        const iy1_1 = (iy1_0 + 1) % NY;

        grid1[iy1_0 * NX + ix1_0] += w * (1 - dx1) * (1 - dy1);
        grid1[iy1_0 * NX + ix1_1] += w * dx1 * (1 - dy1);
        grid1[iy1_1 * NX + ix1_0] += w * (1 - dx1) * dy1;
        grid1[iy1_1 * NX + ix1_1] += w * dx1 * dy1;

        // Second grid (shifted by 0.5 cells)
        const gx2 = gx1 + 0.5;
        const gy2 = gy1 + 0.5;
        const ix2 = Math.floor(gx2);
        const iy2 = Math.floor(gy2);
        const dx2 = gx2 - ix2;
        const dy2 = gy2 - iy2;

        const ix2_0 = ((ix2 % NX) + NX) % NX;
        const iy2_0 = ((iy2 % NY) + NY) % NY;
        const ix2_1 = (ix2_0 + 1) % NX;
        const iy2_1 = (iy2_0 + 1) % NY;

        grid2[iy2_0 * NX + ix2_0] += w * (1 - dx2) * (1 - dy2);
        grid2[iy2_0 * NX + ix2_1] += w * dx2 * (1 - dy2);
        grid2[iy2_1 * NX + ix2_0] += w * (1 - dx2) * dy2;
        grid2[iy2_1 * NX + ix2_1] += w * dx2 * dy2;
    }

    // Convert to overdensity δ = ρ/ρ̄ - 1
    for (let i = 0; i < NX * NY; i++) {
        grid1[i] = grid1[i] / meanDensity - 1.0;
        grid2[i] = grid2[i] / meanDensity - 1.0;
    }

    // 2D FFTs: row-by-row, then column-by-column for both grids
    const re1 = new Float64Array(NX * NY);
    const im1 = new Float64Array(NX * NY);
    const re2 = new Float64Array(NX * NY);
    const im2 = new Float64Array(NX * NY);

    for (let i = 0; i < NX * NY; i++) {
        re1[i] = grid1[i];
        re2[i] = grid2[i];
    }

    // Row FFTs (NX may be non-power-of-2 → Bluestein)
    const rowRe = new Float64Array(NX);
    const rowIm = new Float64Array(NX);
    for (let y = 0; y < NY; y++) {
        const off = y * NX;

        // Grid 1
        for (let x = 0; x < NX; x++) { rowRe[x] = re1[off + x]; rowIm[x] = 0; }
        _fft_any(rowRe, rowIm, NX, false);
        for (let x = 0; x < NX; x++) { re1[off + x] = rowRe[x]; im1[off + x] = rowIm[x]; }

        // Grid 2
        for (let x = 0; x < NX; x++) { rowRe[x] = re2[off + x]; rowIm[x] = 0; }
        _fft_any(rowRe, rowIm, NX, false);
        for (let x = 0; x < NX; x++) { re2[off + x] = rowRe[x]; im2[off + x] = rowIm[x]; }
    }

    // Column FFTs (NY may be non-power-of-2 → Bluestein)
    const colRe = new Float64Array(NY);
    const colIm = new Float64Array(NY);
    for (let x = 0; x < NX; x++) {
        // Grid 1
        for (let y = 0; y < NY; y++) { colRe[y] = re1[y * NX + x]; colIm[y] = im1[y * NX + x]; }
        _fft_any(colRe, colIm, NY, false);
        for (let y = 0; y < NY; y++) { re1[y * NX + x] = colRe[y]; im1[y * NX + x] = colIm[y]; }

        // Grid 2
        for (let y = 0; y < NY; y++) { colRe[y] = re2[y * NX + x]; colIm[y] = im2[y * NX + x]; }
        _fft_any(colRe, colIm, NY, false);
        for (let y = 0; y < NY; y++) { re2[y * NX + x] = colRe[y]; im2[y * NX + x] = colIm[y]; }
    }

    // Compute |δ(k)|² and CIC deconvolution, then bin radially
    // k-space: kx = 2πn / Lx, ky = 2πm / Ly
    const dkx = 2 * Math.PI / LxMpc;
    const dky = 2 * Math.PI / LyMpc;
    const kNyqX = Math.PI * NX / LxMpc; // Nyquist in x
    const kNyqY = Math.PI * NY / LyMpc; // Nyquist in y
    const kMax = Math.min(kNyqX, kNyqY); // conservative max k
    const kMin = Math.max(dkx, dky); // fundamental mode

    // Logarithmic binning
    const numBins = 40;
    const logKMin = Math.log10(kMin);
    const logKMax = Math.log10(kMax);
    const dLogK = (logKMax - logKMin) / numBins;

    const pkSum = new Float64Array(numBins);
    const pkCount = new Float64Array(numBins);

    const norm = (LxMpc * LyMpc) / (NX * NY * NX * NY);

    for (let yi = 0; yi < NY; yi++) {
        // ky: FFT index to physical k
        const ny = yi <= NY / 2 ? yi : yi - NY;
        const ky = ny * dky;

        for (let xi = 0; xi < NX; xi++) {
            if (xi === 0 && yi === 0) continue; // skip DC mode

            const nx = xi <= NX / 2 ? xi : xi - NX;
            const kx = nx * dkx;
            const kMag = Math.sqrt(kx * kx + ky * ky);
            if (kMag >= kMax || kMag < kMin) continue;

            // CIC window deconvolution: W(k) = sinc(kx Lx/2NX) * sinc(ky Ly/2NY)
            const sx = (nx === 0) ? 1.0 : Math.sin(Math.PI * nx / NX) / (Math.PI * nx / NX);
            const sy = (ny === 0) ? 1.0 : Math.sin(Math.PI * ny / NY) / (Math.PI * ny / NY);
            const W2 = sx * sx * sy * sy;
            const W4 = W2 * W2;

            const idx = yi * NX + xi;

            // Interlacing phase shift: un-shift the second grid by e^(-i*θ)
            const theta = -Math.PI * (nx / NX + ny / NY);
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            // Apply rotation: (r2 + i*i2) * (cos + i*sin)
            const r2_shift = re2[idx] * cosTheta - im2[idx] * sinTheta;
            const i2_shift = re2[idx] * sinTheta + im2[idx] * cosTheta;

            // Average the two grids: δ_int = 0.5 * (δ_1 + δ_2 * e^(-iθ))
            const re_int = 0.5 * (re1[idx] + r2_shift);
            const im_int = 0.5 * (im1[idx] + i2_shift);

            const power = (re_int * re_int + im_int * im_int) * norm / W4;

            const logK = Math.log10(kMag);
            const bin = Math.floor((logK - logKMin) / dLogK);
            if (bin >= 0 && bin < numBins) {
                pkSum[bin] += power;
                pkCount[bin] += 1;
            }
        }
    }

    // Average P(k) in each bin
    const kBins = new Float64Array(numBins);
    const pkBins = new Float64Array(numBins);
    for (let b = 0; b < numBins; b++) {
        kBins[b] = Math.pow(10, logKMin + (b + 0.5) * dLogK);
        pkBins[b] = pkCount[b] > 0 ? pkSum[b] / pkCount[b] : 0;
    }

    const result = { kBins, pkBins, numBins, kMin, kMax };
    _pkCaches[cacheKey] = result;
    _pkCacheTimes[cacheKey] = performance.now();
    return result;
}

/**
 * Compute and draw statistics charts:
 *   - P(k) mode + correlation: Measured Power Spectrum P(k)
 *   - BAO mode + correlation: 2-Pt Correlation Function ξ(r)
 *   - Void profile: stacked/median density profile
 */
// ============================================================
// Density PDF: DM histogram + optional bias-weighted histogram
// ============================================================
// The two distributions are drawn as stacked panels with independent axis
// scaling.  A shared x-axis would be dominated by the bias model's tail as
// soon as rho^alpha or the high-density cutoff kicks in, which would flatten
// the DM histogram.  Keeping the panels separate lets both keep their shape.
// ============================================================

const _densityPDFCaches = new Map();

function _densityPDFCache(panelId, N) {
    const key = panelId || 0;
    let c = _densityPDFCaches.get(key);
    if (!c || c.size !== N) {
        c = {
            size: N,
            weights: new Float32Array(N),
            sample: new Float64Array(Math.min(N, 4096))
        };
        _densityPDFCaches.set(key, c);
    }
    return c;
}

// Robust upper percentile from a strided sample (sorting the full field every
// frame would be far too expensive at 50k+ tracers).
function _densityPDFPercentile(arr, N, frac, scratch) {
    if (!arr || !(N > 0) || !scratch || scratch.length === 0) return 0;
    const M = Math.min(N, scratch.length);
    const stride = Math.max(1, Math.floor(N / M));
    let k = 0;
    for (let i = 0; i < N && k < M; i += stride) scratch[k++] = arr[i];
    if (k === 0) return 0;
    const view = scratch.subarray(0, k);
    view.sort();
    const idx = Math.min(k - 1, Math.max(0, Math.floor(frac * (k - 1))));
    return view[idx];
}

// "Nice" tick spacing that stays well behaved for any dynamic range.
function _densityPDFNiceStep(range, targetTicks) {
    if (!(range > 0) || !isFinite(range)) return 1;
    const raw = range / Math.max(1, targetTicks);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / pow;
    let mult;
    if (norm <= 1) mult = 1;
    else if (norm <= 2) mult = 2;
    else if (norm <= 5) mult = 5;
    else mult = 10;
    return mult * pow;
}

function _formatDensityTick(v) {
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e4 || a < 1e-3)) return v.toExponential(1);
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(a < 10 ? 1 : 0);
}

// Draw one histogram panel (background, bars, reference line, axes, title).
function _drawDensityPDFPanel(ctx, cfg) {
    const {
        counts, numBins, xMin, xMax, histMax,
        plotX, plotY, plotW, plotH,
        title, xLabel, zeroFrac, zeroLabel, barColor, logCounts,
        xTicks, xTickFormat
    } = cfg;

    const mL = 12, mR = 12, mT = 28, mB = 32;
    const areaW = plotW - mL - mR;
    const areaH = plotH - mT - mB;
    const areaX = plotX + mL;
    const areaY = plotY + mT;

    // Background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(plotX, plotY, plotW, plotH);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // Bars (contiguous, no gap).  When logCounts is set the bar height is
    // proportional to log10(count), so rare bins stay visible next to a peak
    // that can be orders of magnitude taller.
    const barW = areaW / numBins;
    const logDen = (logCounts && histMax > 1) ? Math.log10(histMax) : 0;
    for (let b = 0; b < numBins; b++) {
        const c = counts[b];
        if (c === 0) continue;
        let frac;
        if (logCounts) {
            frac = logDen > 0 ? Math.log10(c) / logDen : 1;
            if (frac < 0) frac = 0;
        } else {
            frac = c / histMax;
        }
        let barH = frac * areaH;
        // A single-tracer bin has log10(1) = 0 height; keep a visible sliver
        // so the sparse tail is still readable.
        if (logCounts && barH < 1.5) barH = 1.5;
        const bx = Math.round(areaX + b * barW);
        const bxNext = Math.round(areaX + (b + 1) * barW);
        const by = areaY + areaH - barH;
        const alpha = 0.45 + frac * 0.45;
        ctx.fillStyle = `rgba(${barColor}, ${alpha})`;
        ctx.fillRect(bx, by, bxNext - bx, barH);
    }

    // Log-count gridlines: decades of tracer counts, labelled inside the plot
    // so the left margin can stay narrow.
    if (logCounts && logDen > 0) {
        ctx.font = '8px Inter';
        ctx.textAlign = 'left';
        ctx.lineWidth = 1;
        for (let e = 0; e <= Math.floor(logDen); e++) {
            const gy = areaY + areaH - (e / logDen) * areaH;
            ctx.strokeStyle = 'rgba(255,255,255,0.07)';
            ctx.beginPath();
            ctx.moveTo(areaX, gy);
            ctx.lineTo(areaX + areaW, gy);
            ctx.stroke();
            ctx.fillStyle = 'rgba(148,163,184,0.75)';
            const n = Math.pow(10, e);
            ctx.fillText(n < 1e4 ? String(n) : '1e' + e, areaX + 2, gy - 2);
        }
        ctx.fillStyle = 'rgba(148,163,184,0.75)';
        ctx.textAlign = 'left';
        ctx.fillText('log N', plotX + 6, plotY + 18);
    }

    // Reference line at the mean field value (δ = 0)
    if (zeroFrac > 0 && zeroFrac < 1) {
        const zeroX = areaX + zeroFrac * areaW;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(zeroX, areaY);
        ctx.lineTo(zeroX, areaY + areaH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 13px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(zeroLabel, zeroX, areaY - 4);
    }

    // X axis ticks.  A log x axis supplies its own decade positions (and no
    // "-1" edge tick, which only makes sense for the contrast axis).
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter';
    ctx.textAlign = 'center';
    ctx.lineWidth = 1;
    if (xTicks) {
        const xRangeT = xMax - xMin;
        for (let t = 0; t < xTicks.length; t++) {
            const v = xTicks[t];
            const frac = (v - xMin) / xRangeT;
            if (frac < -1e-9 || frac > 1 + 1e-9) continue;
            const tx = areaX + frac * areaW;
            ctx.beginPath();
            ctx.moveTo(tx, areaY + areaH);
            ctx.lineTo(tx, areaY + areaH + 4);
            ctx.stroke();
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(xTickFormat ? xTickFormat(v) : _formatDensityTick(v), tx, areaY + areaH + 14);
        }
    } else {
        ctx.beginPath();
        ctx.moveTo(areaX, areaY + areaH);
        ctx.lineTo(areaX, areaY + areaH + 4);
        ctx.stroke();
        ctx.fillText('-1', areaX, areaY + areaH + 14);

        const xRange = xMax - xMin;
        const tickStep = _densityPDFNiceStep(xRange, 6);
        const tickStart = Math.ceil((xMin + 1e-9) / tickStep) * tickStep;
        for (let v = tickStart; v <= xMax + 1e-9; v += tickStep) {
            const frac = (v - xMin) / xRange;
            if (frac <= 0 || frac > 1) continue;
            const tx = areaX + frac * areaW;
            ctx.beginPath();
            ctx.moveTo(tx, areaY + areaH);
            ctx.lineTo(tx, areaY + areaH + 4);
            ctx.stroke();
            if (Math.abs(v) > tickStep * 0.1) {
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(_formatDensityTick(v), tx, areaY + areaH + 14);
            }
        }
    }

    // X-axis label
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(xLabel, areaX + areaW / 2, areaY + areaH + 28);

    // Title
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(title, plotX + plotW - 5, plotY + 18);
}

// Draw the bias-curve panel: the model N_loc(rho) itself, sampled over a
// log-spaced rho axis, with the two sigmoid pivots marked.  The y axis is
// logarithmic and referenced to the curve maximum so the shape stays visible
// for any alpha.
function _drawBiasCurvePanel(ctx, cfg) {
    const { plotX, plotY, plotW, plotH, params, dict } = cfg;
    const d = dict || {};
    if (!params) return;

    const mL = 34, mR = 12, mT = 20, mB = 26;
    const areaW = plotW - mL - mR;
    const areaH = plotH - mT - mB;
    const areaX = plotX + mL;
    const areaY = plotY + mT;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(plotX, plotY, plotW, plotH);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // rho axis: wide enough to contain the high-density cut-off.
    const rhoMin = 0.02;
    let rhoMax = Math.max(3 * Math.max(params.rhoHigh, 1), 3);
    if (rhoMax > 1e3) rhoMax = 1e3;
    const logMin = Math.log10(rhoMin);
    const logMax = Math.log10(rhoMax);
    const logRange = logMax - logMin || 1;

    const NS = 200;
    const wVals = new Float32Array(NS);
    let wMax = 0;
    for (let i = 0; i < NS; i++) {
        const rho = Math.pow(10, logMin + logRange * (i / (NS - 1)));
        const w = GalaxyBias.weight(rho, params);
        const wv = isFinite(w) && w > 0 ? w : 0;
        wVals[i] = wv;
        if (wv > wMax) wMax = wv;
    }
    if (!(wMax > 0)) return;

    // y axis spans three decades below the curve maximum.
    const yMinLog = -3;
    const toX = (rho) => areaX + ((Math.log10(rho) - logMin) / logRange) * areaW;
    const toY = (w) => {
        if (!(w > 0)) return areaY + areaH;
        let ly = Math.log10(w / wMax);
        if (ly < yMinLog) ly = yMinLog;
        return areaY + areaH * (Math.abs(ly) / -yMinLog);
    };

    // Horizontal gridlines / y tick labels (log10 of the normalised curve).
    ctx.font = '9px Inter';
    ctx.textAlign = 'right';
    for (let ly = 0; ly >= yMinLog; ly--) {
        const gy = areaY + areaH * (Math.abs(ly) / -yMinLog);
        ctx.strokeStyle = ly === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(areaX, gy);
        ctx.lineTo(areaX + areaW, gy);
        ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.fillText(String(ly), areaX - 5, gy + 3);
    }

    // Vertical decade gridlines / x tick labels.
    ctx.textAlign = 'center';
    for (let dec = Math.ceil(logMin); dec <= Math.floor(logMax); dec++) {
        const rho = Math.pow(10, dec);
        const gx = toX(rho);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.beginPath();
        ctx.moveTo(gx, areaY);
        ctx.lineTo(gx, areaY + areaH);
        ctx.stroke();
        ctx.fillStyle = '#94a3b8';
        const label = rho >= 1 ? String(rho) : rho.toFixed(-dec);
        ctx.fillText(label, gx, areaY + areaH + 11);
    }

    // The curve itself.
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    for (let i = 0; i < NS; i++) {
        const rho = Math.pow(10, logMin + logRange * (i / (NS - 1)));
        const px = toX(rho);
        const py = toY(wVals[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Pivot markers (rho_l rose, rho_h amber).
    const markers = [
        { rho: params.rhoLow, color: 'rgba(244, 114, 182, 0.8)', label: 'ρl' },
        { rho: params.rhoHigh, color: 'rgba(251, 191, 36, 0.8)', label: 'ρh' }
    ];
    ctx.font = '9px Inter';
    for (const m of markers) {
        if (!(m.rho > rhoMin) || !(m.rho < rhoMax)) continue;
        const mx = toX(m.rho);
        ctx.strokeStyle = m.color;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, areaY);
        ctx.lineTo(mx, areaY + areaH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = m.color;
        ctx.textAlign = mx > areaX + areaW - 24 ? 'right' : 'left';
        ctx.fillText(m.label, mx + (mx > areaX + areaW - 24 ? -2 : 2), areaY + 9);
    }

    // Axis titles.
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Inter';
    ctx.textAlign = 'left';
    ctx.fillText('log N_loc', plotX + 4, plotY + 13);
    ctx.textAlign = 'center';
    ctx.fillText(d.biasCurveXLabel || 'ρ = ρ_DM / ⟨ρ_DM⟩', areaX + areaW / 2, plotY + plotH - 3);

    // Title.
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(d.biasCurveTitle || 'Bias curve', plotX + plotW - 6, plotY + 13);
}

/**
 * Draw the density PDF chart (one panel, or two stacked when bias is on).
 * opts = { smoothedDensities, meanDensity, tracersPerPanel, SIM_W, SIM_H,
 *          dict, rsdActive, bias: { enabled, params }, panelId }
 */
function drawDensityPDF(ctx, opts) {
    const { smoothedDensities, meanDensity, tracersPerPanel, SIM_W, SIM_H,
            dict, rsdActive, bias, panelId } = opts;
    const d = dict || {};
    if (!smoothedDensities || !meanDensity || meanDensity <= 0) return;
    const N = tracersPerPanel;
    if (!(N > 0)) return;

    const biasOn = !!(bias && bias.enabled && bias.params);
    const plotW = 390;
    const plotH = 160;
    const curveH = 104;
    const gap = 8;
    const plotX = SIM_W - plotW - 20;
    const bottomY = SIM_H - plotH - 60;                        // bias histogram (or DM)
    const topY = biasOn ? bottomY - plotH - gap : bottomY;     // DM histogram
    const curveY = biasOn ? topY - curveH - gap : 0;           // bias curve

    // ---- Bias curve: the model itself, drawn above both histograms ----
    if (biasOn) {
        _drawBiasCurvePanel(ctx, {
            plotX, plotY: curveY, plotW, plotH: curveH,
            params: bias.params, dict: d
        });
    }

    // ---- DM density histogram ----
    let deltaMax = -Infinity;
    for (let i = 0; i < N; i++) {
        const v = (smoothedDensities[i] / meanDensity) - 1;
        if (v > deltaMax) deltaMax = v;
    }

    const xMin = -1;
    const targetMax = Math.max(2, (isFinite(deltaMax) ? deltaMax : 0) * 1.05);

    // Bin width is an integer multiple of the discrete grid quantum so the
    // bars stay aligned with the actual density values.
    const quantum = 1.0 / meanDensity;
    const targetStepSize = 0.2;
    const multiplier = Math.max(1, Math.round(targetStepSize / quantum));
    const binWidth = quantum * multiplier;

    let numBins = Math.ceil((targetMax - xMin) / binWidth);
    if (!isFinite(numBins) || numBins < 4) numBins = 4;
    // Cap the bar count: a very long tail would otherwise produce tens of
    // thousands of invisible slivers.
    if (numBins > 512) numBins = 512;
    const xMax = xMin + numBins * binWidth;

    const counts = new Float32Array(numBins);
    for (let i = 0; i < N; i++) {
        const v = (smoothedDensities[i] / meanDensity) - 1;
        let b = Math.floor((v - xMin) / binWidth);
        if (b < 0) b = 0;
        if (b >= numBins) b = numBins - 1;
        counts[b]++;
    }

    let histMax = 0;
    for (let b = 0; b < numBins; b++) if (counts[b] > histMax) histMax = counts[b];
    if (histMax === 0) return;

    _drawDensityPDFPanel(ctx, {
        counts, numBins, xMin, xMax, histMax,
        plotX, plotY: topY, plotW, plotH,
        title: rsdActive ? (d.normDensityDistRsd || d.normDensityDist) : d.normDensityDist,
        xLabel: d.densityContrastLabel,
        zeroFrac: (0 - xMin) / (xMax - xMin),
        zeroLabel: d.meanDensitySymbol || 'ρ̅',
        barColor: '52, 211, 153'
    });

    if (!biasOn) return;

    // ---- Bias-weighted (normalised galaxy) histogram ----
    // The normalised weights are ratios N / <N>, which are strictly positive,
    // so the x axis is log10(N / <N>) and never has to deal with the zero or
    // negative values that the contrast (N/<N> - 1) produces in underdense
    // regions.
    const cache = _densityPDFCache(panelId, N);
    GalaxyBias.normalizedWeights(smoothedDensities, meanDensity, N, bias.params, cache.weights);

    const RHO_FLOOR = 1e-4;
    let rhoLo = Infinity, rhoHi = 0;
    for (let i = 0; i < N; i++) {
        const r = cache.weights[i];
        if (!(r > 0)) continue;
        if (r < rhoLo) rhoLo = r;
        if (r > rhoHi) rhoHi = r;
    }
    if (!(rhoHi > 0)) return;

    // The top 0.1% is capped so a single extreme tracer cannot stretch the
    // axis by decades; the top bin absorbs the overflow.
    const p999 = _densityPDFPercentile(cache.weights, N, 0.999, cache.sample);
    const hiRho = Math.min(rhoHi, (isFinite(p999) && p999 > 0) ? p999 : rhoHi);

    // Decade-aligned range: whole powers of ten, at least one decade wide.
    let xMinLog = Math.max(Math.floor(Math.log10(Math.max(rhoLo, RHO_FLOOR))), -4);
    let xMaxLog = Math.ceil(Math.log10(Math.max(hiRho, 1e-3)));
    if (xMaxLog - xMinLog < 1) xMaxLog = xMinLog + 1;

    const bNumBins = 80;
    const bBinWidth = (xMaxLog - xMinLog) / bNumBins;
    const bCounts = new Float32Array(bNumBins);
    for (let i = 0; i < N; i++) {
        const r = cache.weights[i];
        const v = Math.log10(r > 0 ? r : RHO_FLOOR);
        let b = Math.floor((v - xMinLog) / bBinWidth);
        if (b < 0) b = 0;
        if (b >= bNumBins) b = bNumBins - 1;
        bCounts[b]++;
    }

    let bHistMax = 0;
    for (let b = 0; b < bNumBins; b++) if (bCounts[b] > bHistMax) bHistMax = bCounts[b];
    if (bHistMax === 0) return;

    // Decade ticks, thinned so at most ~7 labels are drawn.
    const decades = Math.round(xMaxLog - xMinLog);
    const stride = decades > 6 ? Math.ceil(decades / 6) : 1;
    const xticks = [];
    for (let e = xMinLog; e <= xMaxLog; e += stride) xticks.push(e);

    _drawDensityPDFPanel(ctx, {
        counts: bCounts, numBins: bNumBins, xMin: xMinLog, xMax: xMaxLog, histMax: bHistMax,
        plotX, plotY: bottomY, plotW, plotH,
        title: d.biasDensityDist || 'Bias-weighted density distribution',
        xLabel: d.biasRatioLabel || 'log₁₀ (N / ⟨N⟩)',
        zeroFrac: (0 - xMinLog) / (xMaxLog - xMinLog),
        zeroLabel: d.biasMeanSymbol || '⟨N_gal⟩',
        barColor: '251, 191, 36',
        logCounts: true,
        xTicks: xticks,
        xTickFormat: (v) => {
            if (v >= 0 && v <= 3) return String(Math.pow(10, v));
            if (v < 0 && v >= -3) return Math.pow(10, v).toFixed(-v);
            return '1e' + v;
        }
    });
}

function drawStatsChart(ctx, opts) {
    const { showCorrelation, showVoidProfile, showDensityPDF, physX, physY, tracersPerPanel,
            centers, pBaoRadiusPx, pBaoRadiusMpc, pxPerMpc, SIM_W, SIM_H,
            voronoiData, voidCenterMode, profileMode, gpuCorrHistogram, gpuCorrNCenters,
            initMode, panelBoxMpc, panelId, smoothedDensities, meanDensity, dict, rsdActive,
            bias, biasWeights } = opts;
    const d = dict || {};

    if (!showCorrelation && !showVoidProfile && !showDensityPDF) return;
    if (showVoidProfile && !voronoiData) return;

    // ========== Density histogram (self-contained, early-return) ==========
    if (showDensityPDF) {
        drawDensityPDF(ctx, {
            smoothedDensities, meanDensity, tracersPerPanel,
            SIM_W, SIM_H, dict: d, rsdActive, bias, panelId
        });
        return;
    }

    const binSize = 8;
    const isPkMode = initMode === 'pk';

    // Spatial hash for pair counting (correlation) or void profiles
    let sgW = 0, sgH = 0, cellW = 0, cellH = 0;
    let sHead = null, sNext = null;
    // Spatial hash is needed for:
    //  - BAO mode correlation (pair counting)
    //  - Void profiles (both modes)
    // P(k) mode correlation uses FFT-based power spectrum instead.
    const needSpatialHash = (showCorrelation && !isPkMode) || showVoidProfile;
    if (needSpatialHash) {
        // Use fine cells (~50px) for both correlation and void profiles.
        // The search loop dynamically extends to however many cells are needed.
        const HASH_TARGET_CELL = 50;
        sgW = Math.max(3, Math.floor(SIM_W / HASH_TARGET_CELL));
        sgH = Math.max(3, Math.floor(SIM_H / HASH_TARGET_CELL));
        cellW = SIM_W / sgW;
        cellH = SIM_H / sgH;
        const sgSize = sgW * sgH;
        sHead = new Int32Array(sgSize).fill(-1);
        sNext = new Int32Array(tracersPerPanel);
        for (let i = 0; i < tracersPerPanel; i++) {
            const gx = Math.floor(physX[i] / cellW);
            const gy = Math.floor(physY[i] / cellH);
            if (gx >= 0 && gx < sgW && gy >= 0 && gy < sgH) {
                const idx = gy * sgW + gx;
                sNext[i] = sHead[idx];
                sHead[idx] = i;
            }
        }
    }

    let counts = null;
    let maxVal = 0;
    let minVal = 0;
    let numBins = 0;
    let numPlotBins = 0;
    let plotStartBin = 0;
    let title = "";
    let xLabel = "";
    let xMaxLabel = "";
    let showBAOLine = false;
    let showMeanLine = false;
    let showReffLine = false;
    let showZeroLine = false;
    let plotYMax = 0;
    let plotYMin = 0;
    let totalVoidsUsed = 0;

    // Extra state for P(k) power spectrum log-log chart
    let isPkChart = false;
    let pkData = null;
    let pkBiasData = null;

    if (showCorrelation && isPkMode) {
        // --- P(k) mode: Measured Power Spectrum via FFT ---
        // The true DM spectrum is always computed: it is the reference curve
        // that stays put while the bias sliders reshape the second curve.
        pkData = computePowerSpectrum(physX, physY, tracersPerPanel, SIM_W, SIM_H, pxPerMpc, panelId);
        if (bias && bias.enabled && biasWeights) {
            pkBiasData = computePowerSpectrum(physX, physY, tracersPerPanel, SIM_W, SIM_H, pxPerMpc, panelId, biasWeights);
        }
        isPkChart = true;
        title = rsdActive ? (d.powerSpectrumRsd || d.powerSpectrum) : d.powerSpectrum;
    } else if (showCorrelation) {
        // --- BAO mode: Pair-counting ξ(r) ---
        // Full range [0, 1.5]×R_bao with search to 1.7×R_bao
        const halfBox = Math.min(SIM_W, SIM_H) * 0.5;
        const maxBaoSearch = pBaoRadiusPx * 1.7;
        const calcMaxDist = Math.min(maxBaoSearch, halfBox);
        const plotMinDist = 0;
        const plotMaxDist = Math.min(pBaoRadiusPx * 1.5, calcMaxDist);
        numBins = Math.ceil(calcMaxDist / binSize);
        plotStartBin = Math.ceil(plotMinDist / binSize);
        numPlotBins = Math.ceil(plotMaxDist / binSize) - plotStartBin;
        if (numPlotBins < 2) numPlotBins = 2;
        counts = new Float32Array(numBins);

        const calcMaxDistSq = calcMaxDist * calcMaxDist;
        const bins = new Float32Array(numBins);

        if (gpuCorrHistogram && gpuCorrHistogram.length >= numBins) {
            for (let b = 0; b < numBins; b++) bins[b] = gpuCorrHistogram[b];
        } else {
            // Dynamic search neighborhood: however many cells needed for calcMaxDist,
            // capped to avoid double-counting across periodic boundaries.
            const corrNCellsX = Math.min(Math.ceil(calcMaxDist / cellW), Math.floor((sgW - 1) / 2));
            const corrNCellsY = Math.min(Math.ceil(calcMaxDist / cellH), Math.floor((sgH - 1) / 2));
            for (let c of centers) {
                const cx = c.x;
                const cy = c.y;
                const centerGx = Math.floor(cx / cellW);
                const centerGy = Math.floor(cy / cellH);

                for (let dyC = -corrNCellsY; dyC <= corrNCellsY; dyC++) {
                    for (let dxC = -corrNCellsX; dxC <= corrNCellsX; dxC++) {
                        const rawTx = centerGx + dxC;
                        const rawTy = centerGy + dyC;
                        const tx = ((rawTx % sgW) + sgW) % sgW;
                        const ty = ((rawTy % sgH) + sgH) % sgH;
                        const shiftX = (rawTx - tx) / sgW * SIM_W;
                        const shiftY = (rawTy - ty) / sgH * SIM_H;

                        const cellIdx = ty * sgW + tx;
                        let trIdx = sHead[cellIdx];
                        while (trIdx !== -1) {
                            let dx = physX[trIdx] + shiftX - cx;
                            let dy = physY[trIdx] + shiftY - cy;
                            const dSq = dx * dx + dy * dy;
                            if (dSq < calcMaxDistSq) {
                                const dist = Math.sqrt(dSq);
                                const b = Math.floor(dist / binSize);
                                if (b < numBins) bins[b]++;
                            }
                            trIdx = sNext[trIdx];
                        }
                    }
                }
            }
        }

        // Normalize by annular area; compute min/max over display range
        for (let b = 1; b < numBins; b++) {
            const r = b * binSize;
            const area = 2 * Math.PI * r * binSize;
            counts[b] = bins[b] / area;
        }
        // Compute y-range over the plotted bins
        minVal = Infinity;
        maxVal = -Infinity;
        for (let b = Math.max(1, plotStartBin); b < plotStartBin + numPlotBins; b++) {
            if (b < numBins) {
                if (counts[b] > maxVal) maxVal = counts[b];
                if (counts[b] < minVal) minVal = counts[b];
            }
        }
        if (!isFinite(minVal)) minVal = 0;
        if (!isFinite(maxVal) || maxVal <= 0) maxVal = 1;

        plotYMin = 0;
        plotYMax = maxVal;
        title = rsdActive ? (d.twoPtCorrChartRsd || d.twoPtCorrChart) : d.twoPtCorrChart;
        xLabel = d.distanceMpc;
        xMaxLabel = Math.round(plotMaxDist / pxPerMpc);
        showBAOLine = true;
    } else if (showVoidProfile && voronoiData && voronoiData.voidResults) {
        const { voidCentroids, voidMinCenters, voidRadii, numVoids } = voronoiData.voidResults;
        const useGeometric = voidCenterMode === 'geometric';
        const activeCenters = useGeometric ? voidCentroids : voidMinCenters;

        const maxR = 2.0;
        numBins = 20;
        numPlotBins = numBins;

        const stackedCounts = new Float32Array(numBins);
        const stackedExpected = new Float32Array(numBins);
        const allProfiles = [];
        counts = new Float32Array(numBins);

        let validCount = 0;
        const globalDensity = tracersPerPanel / (SIM_W * SIM_H);

        for (let i = 1; i <= numVoids; i++) {
            const reff = voidRadii[i];
            if (reff < 5) continue;
            // Skip voids whose search radius exceeds half the box — periodic
            // images overlap and the profile is undefined.
            const searchR = reff * maxR;
            if (searchR > Math.min(SIM_W, SIM_H) * 0.5) continue;
            validCount++;

            const cx = activeCenters[i * 2];
            const cy = activeCenters[i * 2 + 1];
            const searchRSq = searchR * searchR;

            const localCounts = new Float32Array(numBins);
            const localProfile = new Float32Array(numBins);

            const centerGx = Math.floor(cx / cellW);
            const centerGy = Math.floor(cy / cellH);
            // Determine how many hash cells to search; cap to avoid double-counting
            const nCellsX = Math.min(Math.ceil(searchR / cellW), Math.floor((sgW - 1) / 2));
            const nCellsY = Math.min(Math.ceil(searchR / cellH), Math.floor((sgH - 1) / 2));

            for (let dyC = -nCellsY; dyC <= nCellsY; dyC++) {
                for (let dxC = -nCellsX; dxC <= nCellsX; dxC++) {
                    const rawTx = centerGx + dxC;
                    const rawTy = centerGy + dyC;
                    const tx = ((rawTx % sgW) + sgW) % sgW;
                    const ty = ((rawTy % sgH) + sgH) % sgH;
                    // Periodic image shift: how many box-widths did wrapping move us?
                    const shiftX = (rawTx - tx) / sgW * SIM_W;
                    const shiftY = (rawTy - ty) / sgH * SIM_H;

                    if (tx >= 0 && tx < sgW && ty >= 0 && ty < sgH) {
                        const cellIdx = ty * sgW + tx;
                        let trIdx = sHead[cellIdx];
                        while (trIdx !== -1) {
                            let dx = physX[trIdx] + shiftX - cx;
                            let dy = physY[trIdx] + shiftY - cy;
                            const dSq = dx * dx + dy * dy;
                            if (dSq < searchRSq) {
                                const dist = Math.sqrt(dSq);
                                const normalizedR = dist / reff;
                                const b = Math.floor((normalizedR / maxR) * numBins);
                                if (b < numBins) localCounts[b]++;
                            }
                            trIdx = sNext[trIdx];
                        }
                    }
                }
            }

            for (let b = 0; b < numBins; b++) {
                const rInNorm = (b / numBins) * maxR;
                const rOutNorm = ((b + 1) / numBins) * maxR;
                const area = Math.PI * (rOutNorm * rOutNorm - rInNorm * rInNorm) * reff * reff;
                const expected = area * globalDensity;

                if (expected > 0.1) {
                    stackedCounts[b] += localCounts[b];
                    stackedExpected[b] += expected;
                    localProfile[b] = localCounts[b] / expected;
                } else {
                    localProfile[b] = 0;
                }
            }
            allProfiles.push(localProfile);
        }

        totalVoidsUsed = validCount;

        if (profileMode === 'median') {
            for (let b = 0; b < numBins; b++) {
                const col = [];
                for (let i = 0; i < validCount; i++) col.push(allProfiles[i][b]);
                col.sort((a, b) => a - b);
                const mid = Math.floor(col.length / 2);
                counts[b] = col.length > 0 ? col[mid] : 0;
                if (counts[b] > maxVal) maxVal = counts[b];
            }
            title = rsdActive ? (d.medianVoidProfileRsd || d.medianVoidProfile) : d.medianVoidProfile;
        } else {
            for (let b = 0; b < numBins; b++) {
                counts[b] = stackedExpected[b] > 0 ? stackedCounts[b] / stackedExpected[b] : 0;
                if (counts[b] > maxVal) maxVal = counts[b];
            }
            title = rsdActive ? (d.stackedVoidProfileRsd || d.stackedVoidProfile) : d.stackedVoidProfile;
        }

        plotYMax = maxVal * 1.15;
        if (plotYMax < 2.0) plotYMax = 2.0;
        xLabel = "";
        xMaxLabel = "2.0";
        showBAOLine = false;
        showMeanLine = true;
        showReffLine = true;
    }

    if (!counts && !isPkChart) return;

    // --- Chart rendering ---
    const plotW = 390;
    const plotH = 210;
    const plotX = SIM_W - plotW - 20;
    const plotY = SIM_H - plotH - 60;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(plotX, plotY, plotW, plotH);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // ========== P(k) log-log chart ==========
    if (isPkChart && pkData && pkData.numBins > 0) {
        // Turn one spectrum into log10(k), log10(P) series, dropping empty bins.
        const seriesOf = (spec) => {
            const ks = [], ps = [];
            if (!spec || !(spec.numBins > 0)) return { ks, ps };
            for (let i = 0; i < spec.numBins; i++) {
                if (spec.kBins[i] > 0 && spec.pkBins[i] > 0) {
                    ks.push(spec.kBins[i]);
                    ps.push(spec.pkBins[i]);
                }
            }
            return { ks, ps };
        };

        const dmSeries = seriesOf(pkData);
        if (dmSeries.ks.length < 2) return;
        const logK = dmSeries.ks.map(v => Math.log10(v));
        const logP = dmSeries.ps.map(v => Math.log10(v));

        // Bias-weighted spectrum (optional). The DM curve stays on the chart as
        // a fixed reference while the sliders change the biased one.
        const biasOn = !!(bias && bias.enabled && biasWeights);
        const biasSeries = biasOn ? seriesOf(pkBiasData) : { ks: [], ps: [] };
        const biasLogK = biasSeries.ks.map(v => Math.log10(v));
        const biasLogP = biasSeries.ps.map(v => Math.log10(v));
        const hasBiasCurve = biasLogK.length >= 2;

        // Log ranges, shared by both curves so they are directly comparable.
        let logKMin = Math.min(...logK, ...(hasBiasCurve ? biasLogK : []));
        let logKMax = Math.max(...logK, ...(hasBiasCurve ? biasLogK : []));
        let logPMin = Math.min(...logP, ...(hasBiasCurve ? biasLogP : []));
        let logPMax = Math.max(...logP, ...(hasBiasCurve ? biasLogP : []));

        // Add padding
        const kPad = (logKMax - logKMin) * 0.05 || 0.1;
        const pPad = (logPMax - logPMin) * 0.08 || 0.1;
        logKMin -= kPad;
        logKMax += kPad;
        logPMin -= pPad;
        logPMax += pPad;

        const kRange = logKMax - logKMin || 1;
        const pRange = logPMax - logPMin || 1;

        // Plot area margins within the chart box
        const mL = 52, mR = 12, mT = 28, mB = 36;
        const areaW = plotW - mL - mR;
        const areaH = plotH - mT - mB;
        const areaX = plotX + mL;
        const areaY = plotY + mT;

        // Helper: data → pixel
        const toPixX = (lk) => areaX + ((lk - logKMin) / kRange) * areaW;
        const toPixY = (lp) => areaY + areaH - ((lp - logPMin) / pRange) * areaH;

        // Gridlines
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.font = '10px Inter';
        ctx.fillStyle = '#94a3b8';

        // Y-axis gridlines (log10 P)
        ctx.textAlign = 'right';
        const yStep = Math.max(1, Math.ceil(pRange / 5));
        const yStart = Math.floor(logPMin);
        for (let v = yStart; v <= Math.ceil(logPMax); v += yStep) {
            if (v < logPMin || v > logPMax) continue;
            const py = toPixY(v);
            ctx.beginPath();
            ctx.moveTo(areaX, py);
            ctx.lineTo(areaX + areaW, py);
            ctx.stroke();
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('10' , areaX - 18, py + 3);
            // Superscript exponent
            ctx.font = '8px Inter';
            ctx.fillText(String(v), areaX - 6, py - 2);
            ctx.font = '10px Inter';
        }

        // X-axis gridlines (log10 k)
        ctx.textAlign = 'center';
        const xStep = Math.max(0.5, Math.ceil(kRange / 5 * 2) / 2);
        const xStart = Math.ceil(logKMin / xStep) * xStep;
        for (let v = xStart; v <= logKMax; v += xStep) {
            if (v < logKMin) continue;
            const px = toPixX(v);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath();
            ctx.moveTo(px, areaY);
            ctx.lineTo(px, areaY + areaH);
            ctx.stroke();
            // Tick label
            ctx.fillStyle = '#94a3b8';
            const kVal = Math.pow(10, v);
            let label;
            if (kVal >= 1) label = kVal.toFixed(0);
            else if (kVal >= 0.1) label = kVal.toFixed(1);
            else label = kVal.toFixed(2);
            ctx.fillText(label, px, areaY + areaH + 12);
        }

        // ---- Curves: DM (reference) first, bias model on top ----
        const drawPkSeries = (ks, ps, color, radius) => {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            for (let i = 0; i < ks.length; i++) {
                const px = toPixX(ks[i]);
                const py = toPixY(ps[i]);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.fillStyle = color;
            for (let i = 0; i < ks.length; i++) {
                const px = toPixX(ks[i]);
                const py = toPixY(ps[i]);
                ctx.beginPath();
                ctx.arc(px, py, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        drawPkSeries(logK, logP, '#38bdf8', 2.5);
        if (hasBiasCurve) drawPkSeries(biasLogK, biasLogP, '#fbbf24', 2.5);

        // Legend, only when both curves are present
        if (hasBiasCurve) {
            ctx.font = '11px Inter';
            ctx.textAlign = 'left';
            const legendY = areaY + 12;
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(areaX + 6, legendY - 7, 10, 3);
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(d.pkLegendDm || 'DM', areaX + 20, legendY - 2);
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(areaX + 62, legendY - 7, 10, 3);
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(d.pkLegendBias || 'Bias', areaX + 76, legendY - 2);
        }

        // Title
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 14px Inter';
        ctx.textAlign = 'right';
        ctx.fillText(title, plotX + plotW - 5, plotY + 18);

        // Axis labels
        ctx.fillStyle = '#64748b';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(d.kAxisLabel, areaX + areaW / 2, areaY + areaH + 28);

        ctx.save();
        ctx.translate(plotX + 14, areaY + areaH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(d.pkAxisLabel, 0, 0);
        ctx.restore();

        return; // P(k) chart is done
    }

    // ========== Linear chart (ξ(r) and void profile) ==========

    const drawProfileLine = (dataArr, color) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const yMax = plotYMax || 1;
        const yMin = plotYMin || 0;
        const yRange = yMax - yMin || 1;
        for (let i = 0; i < numPlotBins; i++) {
            const b = plotStartBin + i;
            const x = plotX + (i / numPlotBins) * plotW;
            const val = (b < dataArr.length) ? dataArr[b] : 0;
            const normVal = (val - yMin) / yRange;
            const y = plotY + plotH - (normVal * plotH * 0.8) - 15;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    };

    // Mean density line (rho/rho_bar = 1) for void profile
    if (showMeanLine) {
        const y1 = plotY + plotH - (1.0 / plotYMax * plotH * 0.8) - 15;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(plotX, y1);
        ctx.lineTo(plotX + plotW, y1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.fillRect(plotX + 2, y1 - 6, 20, 12);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Inter';
        ctx.textAlign = 'left';
        ctx.fillText(d.meanLineValue, plotX + 4, y1 + 4);
    }

    // R_eff reference line
    if (showReffLine) {
        const x1 = plotX + (1.0 / 2.0) * plotW;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, plotY + 25);
        ctx.lineTo(x1, plotY + plotH - 35);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    drawProfileLine(counts, '#fbbf24');

    // Title
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(title, plotX + plotW - 5, plotY + 18);

    if (showVoidProfile) {
        ctx.font = '11px Inter';
        ctx.fillStyle = '#64748b';
        const centerLabel = voidCenterMode === 'geometric' ? d.macrocenter : d.minDensityCenter;
        ctx.fillText(centerLabel, plotX + plotW - 5, plotY + 33);
    }

    const axisY = plotY + plotH - 5;

    // Y-axis gridlines and labels
    ctx.textAlign = 'left';
    ctx.font = '10px Inter';
    ctx.fillStyle = '#94a3b8';

    if (showVoidProfile) {
        // Void profile: fixed gridlines at 0.0, 0.5, 1.0, ...
        for (let v = 0.0; v < plotYMax; v += 0.5) {
            const normY = v / plotYMax;
            const y = plotY + plotH - (normY * plotH * 0.8) - 15;
            if (v > 0) {
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.beginPath();
                ctx.moveTo(plotX, y);
                ctx.lineTo(plotX + plotW, y);
                ctx.stroke();
                ctx.fillText(v.toFixed(1), plotX + 6, y + 3);
            } else {
                ctx.fillText(d.zeroTick || '0.0', plotX + 6, axisY - 2);
            }
        }
    } else if (showCorrelation) {
        // Correlation: no y-axis gridlines (clean look)
    }

    // X-axis label
    if (!showVoidProfile) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(xLabel, plotX + plotW / 2, axisY - 14);
    } else {
        const labelX = plotX + plotW / 2;
        const labelY = axisY - 14;
        ctx.fillStyle = '#64748b';
        ctx.font = '18px "Times New Roman", serif';
        ctx.textAlign = 'center';
        const text1 = "r / R";
        const w1 = ctx.measureText(text1).width;
        ctx.fillText(text1, labelX - 5, labelY);
        ctx.font = '14px "Times New Roman", serif';
        ctx.fillText("eff", labelX + w1 / 2 - 2, labelY + 5);
    }

    // X-axis tick marks
    if (showVoidProfile) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'center';
        ctx.font = '11px Inter';
        for (let v = 0.5; v < 2.0; v += 0.5) {
            const tx = plotX + (v / 2.0) * plotW;
            ctx.beginPath();
            ctx.moveTo(tx, plotY + plotH - 15);
            ctx.lineTo(tx, plotY + plotH - 10);
            ctx.stroke();

            const txt = v.toFixed(1);
            const tw = ctx.measureText(txt).width;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
            ctx.fillRect(tx - tw / 2 - 2, axisY - 10, tw + 4, 14);
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(txt, tx, axisY);
        }
    } else {
        // X-axis labels for correlation chart
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '10px Inter';
        const xMinLabelMpc = Math.round(plotStartBin * binSize / pxPerMpc);
        ctx.textAlign = 'left';
        ctx.fillText(String(xMinLabelMpc), plotX + 5, axisY);
        ctx.textAlign = 'right';
        ctx.fillText(xMaxLabel, plotX + plotW - 5, axisY);
    }

    // BAO reference line
    if (showBAOLine) {
        // Map BAO radius into chart x coordinate
        // BAO mode: chart spans [0, 1.5*R_bao]
        // P(k) mode: chart spans [0.5*R_bao, 1.5*R_bao]
        const plotBinMin = plotStartBin * binSize;
        const plotBinMax = (plotStartBin + numPlotBins) * binSize;
        const baoFrac = (pBaoRadiusPx - plotBinMin) / (plotBinMax - plotBinMin);
        if (baoFrac > 0 && baoFrac < 1) {
            const baoX = plotX + baoFrac * plotW;
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(baoX, plotY + 25);
            ctx.lineTo(baoX, axisY - 12);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#fbbf24';
            ctx.textAlign = 'center';
            ctx.fillText(Math.round(pBaoRadiusMpc), baoX, axisY);
        }
    }
}

// Exported for unit checks only; the browser build relies on these being global.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        webHierColorbarGeometry,
        webHierColorbarCellAt,
        webHierClassName
    };
}
