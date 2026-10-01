// ==UserScript==
// @name         网页阅读工具箱（高亮·批注·涂鸦）
// @namespace    https://github.com/lilipps/reading-toolbox
// @version      1.0.0
// @description  悬浮球拖拽展开工具栏，支持网页高亮、批注、涂鸦、橡皮擦、导出Markdown，绘画时锁定页面交互。
// @author       lilipps
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// @license      MIT
// @homepage     https://github.com/lilipps/reading-toolbox
// @supportURL   https://github.com/lilipps/reading-toolbox/issues
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 存储 ====================
    const HL_KEY = 'rtb_hl_v2';
    const DRAW_KEY = 'rtb_draw_v2';
    const FAB_POS_KEY = 'rtb_fab_pos_v2';

    function gmGet(k, d) {
        try {
            if (typeof GM_getValue !== 'undefined') return GM_getValue(k, d);
            const v = localStorage.getItem(k);
            return v ? JSON.parse(v) : d;
        } catch { return d; }
    }
    function gmSet(k, v) {
        try {
            if (typeof GM_setValue !== 'undefined') GM_setValue(k, v);
            else localStorage.setItem(k, JSON.stringify(v));
        } catch {}
    }

    function hlAll() { return gmGet(HL_KEY, []); }
    function hlSave(l) { gmSet(HL_KEY, l); }
    function hlAdd(it) { const l = hlAll(); l.push(it); hlSave(l); }
    function hlUpdate(id, patch) {
        const l = hlAll(); const i = l.findIndex(x => x.id === id);
        if (i >= 0) { l[i] = { ...l[i], ...patch }; hlSave(l); }
    }
    function hlRemove(id) { hlSave(hlAll().filter(x => x.id !== id)); }
    function hlCurrent() {
        const url = location.href.split('#')[0];
        return hlAll().filter(x => x.url === url);
    }

    function drawAll() { return gmGet(DRAW_KEY, {}); }
    function drawSave(o) { gmSet(DRAW_KEY, o); }
    function drawCurrent() {
        const url = location.href.split('#')[0];
        return drawAll()[url] || [];
    }
    function drawSetCurrent(strokes) {
        const url = location.href.split('#')[0];
        const all = drawAll();
        if (strokes.length === 0) delete all[url];
        else all[url] = strokes;
        drawSave(all);
    }

    // ==================== Shadow DOM ====================
    const host = document.createElement('div');
    host.id = 'rtb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
    (document.documentElement || document.body).appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    function isInsideHost(e) {
        if (!e) return false;
        if (e.composedPath) {
            try { if (e.composedPath().includes(host)) return true; } catch {}
        }
        if (e.target === host) return true;
        return false;
    }

    // ==================== 样式 ====================
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif; }

        .fab {
            position: fixed; width: 52px; height: 52px;
            border-radius: 50%;
            background: linear-gradient(135deg, #ffd54f 0%, #ffb300 100%);
            box-shadow: 0 6px 20px rgba(0,0,0,.3), 0 0 0 2px rgba(255,255,255,.15) inset;
            display: flex; align-items: center; justify-content: center;
            font-size: 24px; color: #222;
            cursor: pointer; user-select: none;
            pointer-events: auto;
            transition: transform .35s cubic-bezier(.4,1.6,.6,1), background .2s;
            touch-action: none; z-index: 2;
            will-change: transform;
        }
        .fab:hover { box-shadow: 0 8px 24px rgba(0,0,0,.35), 0 0 0 2px rgba(255,255,255,.2) inset; }
        .fab.open { background: linear-gradient(135deg, #ff8a65, #f4511e); color: #fff; }
        .fab .badge {
            position: absolute; top: -2px; right: -2px;
            background: #e53935; color: #fff;
            font-size: 10px; min-width: 17px; height: 17px;
            border-radius: 9px; display: flex; align-items: center;
            justify-content: center; padding: 0 4px;
        }

        .tools {
            position: fixed; display: none; flex-direction: column;
            gap: 5px; padding: 7px;
            background: rgba(28,28,32,0.97);
            border-radius: 18px;
            box-shadow: 0 12px 32px rgba(0,0,0,.4);
            backdrop-filter: blur(12px);
            pointer-events: auto; z-index: 1;
        }
        .tools.show { display: flex; animation: pop-in .18s cubic-bezier(.2,.8,.3,1.2); }
        @keyframes pop-in { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }
        .tools .btn {
            width: 40px; height: 40px; border-radius: 12px;
            background: rgba(255,255,255,.08); color: #ddd;
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; cursor: pointer; transition: .15s;
            position: relative;
        }
        .tools .btn:hover { background: rgba(255,255,255,.18); }
        .tools .btn.active { background: linear-gradient(135deg, #ffd54f, #ffb300); color: #222; }
        .tools .btn .dot {
            position: absolute; bottom: 5px; right: 5px;
            width: 10px; height: 10px; border-radius: 50%;
            border: 2px solid #1c1c20;
        }
        .tools .sep { height: 1px; background: rgba(255,255,255,.12); margin: 2px 4px; }

        .drawing-hint {
            position: fixed; top: 16px; left: 50%;
            transform: translateX(-50%);
            padding: 8px 18px; background: rgba(244,81,30,.95);
            color: #fff; border-radius: 20px; font-size: 13px;
            box-shadow: 0 4px 16px rgba(0,0,0,.3);
            pointer-events: none; display: none; z-index: 3;
            white-space: nowrap;
        }
        .drawing-hint.show { display: block; animation: fade-in .2s; }
        @keyframes fade-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes fade-out { to { opacity: 0; transform: translate(-50%, -8px); } }

        .exit-draw {
            position: fixed; top: 16px; right: 16px;
            width: 46px; height: 46px; border-radius: 50%;
            background: linear-gradient(135deg, #ef5350, #c62828);
            color: #fff; display: none; align-items: center; justify-content: center;
            font-size: 22px; font-weight: bold;
            box-shadow: 0 6px 20px rgba(198,40,40,.5), 0 0 0 3px rgba(255,255,255,.2);
            cursor: pointer; pointer-events: auto; z-index: 4; user-select: none;
        }
        .exit-draw:hover { transform: scale(1.1); }
        .exit-draw.show { display: flex; animation: pop-in .25s cubic-bezier(.2,.8,.3,1.2); }

        .sel-toolbar {
            position: fixed; display: none; align-items: center; gap: 6px;
            padding: 8px 12px; background: rgba(28,28,32,.98);
            border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,.4);
            pointer-events: auto; z-index: 10;
            flex-wrap: wrap; justify-content: center;
        }
        .sel-toolbar .c {
            width: 28px; height: 28px; border-radius: 50%;
            border: 2px solid rgba(255,255,255,.25); cursor: pointer;
            transition: transform .12s;
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
        }
        .sel-toolbar .c:hover { transform: scale(1.18); }
        .sel-toolbar button {
            background: rgba(255,255,255,.12); color: #fff;
            border: none; border-radius: 8px; padding: 6px 12px;
            font-size: 13px; cursor: pointer; white-space: nowrap;
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
        }
        .sel-toolbar button:hover { background: rgba(255,255,255,.22); }

        .menu {
            position: fixed; display: none; flex-direction: column;
            background: rgba(28,28,32,.97);
            border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.3);
            overflow: hidden; min-width: 120px; pointer-events: auto;
            z-index: 10;
        }
        .menu button {
            color: #fff; background: transparent; border: none;
            padding: 10px 14px; font-size: 13px; text-align: left;
            cursor: pointer;
        }
        .menu button:hover { background: rgba(255,255,255,.12); }
        .menu button.danger:hover { background: rgba(229,57,53,.4); }

        .panel {
            position: fixed; top: 0; right: 0; width: 320px; max-width: 88vw;
            height: 100%; background: #1c1c20; color: #eee;
            box-shadow: -4px 0 24px rgba(0,0,0,.4);
            transform: translateX(100%);
            transition: transform .25s cubic-bezier(.2,.8,.3,1);
            display: flex; flex-direction: column; pointer-events: auto;
            z-index: 11;
        }
        .panel.open { transform: translateX(0); }
        .panel header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.08);
            font-size: 15px; font-weight: 600;
        }
        .panel header button {
            background: rgba(255,255,255,.1); color: #eee;
            border: none; border-radius: 6px; padding: 5px 10px;
            font-size: 12px; cursor: pointer; margin-left: 6px;
        }
        .panel header button:hover { background: rgba(255,255,255,.2); }
        .panel .tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,.08); }
        .panel .tabs .tab {
            flex: 1; text-align: center; padding: 10px;
            font-size: 13px; cursor: pointer; color: #888;
            border-bottom: 2px solid transparent;
        }
        .panel .tabs .tab.active { color: #ffd54f; border-bottom-color: #ffd54f; }
        .panel .list { flex: 1; overflow-y: auto; padding: 12px 14px 20px; }
        .panel .empty {
            text-align: center; color: #888; font-size: 13px;
            margin-top: 40px; line-height: 1.8;
        }
        .panel .item {
            background: rgba(255,255,255,.05);
            border-radius: 10px; padding: 10px 12px; margin-bottom: 10px;
        }
        .panel .item .text { font-size: 13px; line-height: 1.5; color: #fff; word-break: break-word; }
        .panel .item .note { font-size: 12px; color: #ffd54f; margin-top: 6px; line-height: 1.4; word-break: break-word; }
        .panel .item .meta { font-size: 11px; color: #888; margin-top: 8px; display: flex; justify-content: space-between; gap: 8px; }
        .panel .item .meta .page { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        .panel .item .acts { display: flex; gap: 6px; margin-top: 8px; }
        .panel .item .acts button {
            background: rgba(255,255,255,.08); color: #ddd;
            border: none; border-radius: 6px; padding: 4px 8px;
            font-size: 11px; cursor: pointer;
        }
        .panel .item .acts button:hover { background: rgba(255,255,255,.18); }
        .panel .item .acts button.danger:hover { background: rgba(229,57,53,.4); color: #fff; }
        .panel .draw-item .canvas-wrap { background: rgba(0,0,0,.2); border-radius: 8px; overflow: hidden; margin-top: 6px; }
        .panel .draw-item canvas { display: block; width: 100%; height: auto; }
    `;
    shadow.appendChild(styleEl);

    // ==================== 涂鸦层 ====================
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:2147483400;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    wrapper.appendChild(canvas);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    wrapper.appendChild(overlay);
    (document.body || document.documentElement).appendChild(wrapper);
    const ctx = canvas.getContext('2d');

    let strokes = [];
    let currentStroke = null;
    let drawingMode = false;
    let eraserMode = false;
    let isDrawing = false;
    let drawColor = '#ff5252';
    let drawWidth = 3;
    const DRAW_COLORS = ['#ff5252', '#ffd54f', '#4caf50', '#42a5f5', '#ab47bc', '#000000'];

    function syncSize() {
        const w = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth);
        const h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight);
        wrapper.style.width = w + 'px';
        wrapper.style.height = h + 'px';
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        overlay.style.width = w + 'px';
        overlay.style.height = h + 'px';
        redrawAll();
    }
    window.addEventListener('resize', syncSize);
    window.addEventListener('load', () => setTimeout(syncSize, 300));
    setTimeout(syncSize, 500);
    setInterval(syncSize, 3000);

    function redrawAll() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        strokes.forEach(s => drawStroke(s));
        if (currentStroke) drawStroke(currentStroke);
    }

    function drawStroke(s) {
        if (!s.points || s.points.length === 0) return;
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (s.points.length === 1) {
            ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
            ctx.fillStyle = s.color;
            ctx.fill();
        } else {
            ctx.moveTo(s.points[0].x, s.points[0].y);
            for (let i = 1; i < s.points.length - 1; i++) {
                const xc = (s.points[i].x + s.points[i + 1].x) / 2;
                const yc = (s.points[i].y + s.points[i + 1].y) / 2;
                ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, xc, yc);
            }
            const last = s.points[s.points.length - 1];
            ctx.lineTo(last.x, last.y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function loadStrokes() {
        strokes = drawCurrent().map(s => ({ ...s, points: s.points || [] }));
        redrawAll();
    }

    const drawHint = document.createElement('div');
    drawHint.className = 'drawing-hint';
    drawHint.textContent = '✏️ 绘画中 — 页面已锁定';
    shadow.appendChild(drawHint);

    let hintTimer = null;
    function showDrawingHint() {
        drawHint.classList.add('show');
        drawHint.style.animation = 'fade-in .2s';
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(() => {
            drawHint.style.animation = 'fade-out .3s forwards';
            setTimeout(() => { drawHint.classList.remove('show'); drawHint.style.animation = ''; }, 300);
        }, 3000);
    }
    function hideDrawingHint() {
        if (hintTimer) clearTimeout(hintTimer);
        drawHint.classList.remove('show');
        drawHint.style.animation = '';
    }

    const exitDrawBtn = document.createElement('div');
    exitDrawBtn.className = 'exit-draw';
    exitDrawBtn.textContent = '✕';
    exitDrawBtn.title = '退出绘画';
    shadow.appendChild(exitDrawBtn);

    exitDrawBtn.addEventListener('click', e => { e.stopPropagation(); exitDrawingMode(); });
    exitDrawBtn.addEventListener('pointerdown', e => e.stopPropagation());

    function exitDrawingMode() {
        drawingMode = false;
        eraserMode = false;
        btnDraw.classList.remove('active');
        btnEraser.classList.remove('active');
        updateOverlayEvents();
    }

    function updateOverlayEvents() {
        if (drawingMode || eraserMode) {
            overlay.style.pointerEvents = 'auto';
            overlay.style.cursor = 'crosshair';
            overlay.style.touchAction = 'none';
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            document.body.style.touchAction = 'none';
            showDrawingHint();
            exitDrawBtn.classList.add('show');
        } else {
            overlay.style.pointerEvents = 'none';
            overlay.style.cursor = '';
            overlay.style.touchAction = '';
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            document.body.style.touchAction = '';
            hideDrawingHint();
            exitDrawBtn.classList.remove('show');
        }
    }

    overlay.addEventListener('pointerdown', e => {
        if (!drawingMode && !eraserMode) return;
        e.preventDefault(); e.stopPropagation();
        try { overlay.setPointerCapture(e.pointerId); } catch {}
        isDrawing = true;
        const x = e.pageX, y = e.pageY;
        if (eraserMode) { eraseAt(x, y); return; }
        currentStroke = { color: drawColor, width: drawWidth, points: [{ x, y }] };
        redrawAll();
    });

    overlay.addEventListener('pointermove', e => {
        if (!isDrawing) return;
        e.preventDefault();
        const x = e.pageX, y = e.pageY;
        if (eraserMode) { eraseAt(x, y); return; }
        if (!currentStroke) return;
        currentStroke.points.push({ x, y });
        redrawAll();
    });

    overlay.addEventListener('pointerup', () => {
        if (!isDrawing) return;
        isDrawing = false;
        if (currentStroke) {
            strokes.push(currentStroke);
            currentStroke = null;
            drawSetCurrent(strokes);
            if (panel.classList.contains('open')) refreshPanel();
        }
    });
    overlay.addEventListener('pointercancel', () => { isDrawing = false; currentStroke = null; });
    overlay.addEventListener('wheel', e => { if (drawingMode || eraserMode) e.preventDefault(); }, { passive: false });
    overlay.addEventListener('touchmove', e => { if (drawingMode || eraserMode) e.preventDefault(); }, { passive: false });

    function eraseAt(x, y) {
        const threshold = 14;
        let changed = false;
        for (let i = strokes.length - 1; i >= 0; i--) {
            const s = strokes[i];
            for (const p of s.points) {
                if (Math.hypot(p.x - x, p.y - y) < threshold) {
                    strokes.splice(i, 1);
                    changed = true;
                    break;
                }
            }
        }
        if (changed) { redrawAll(); drawSetCurrent(strokes); }
    }

    // ==================== 悬浮球 ====================
    const fab = document.createElement('div');
    fab.className = 'fab';
    fab.innerHTML = '🖍<span class="badge" style="display:none">0</span>';
    fab.title = '阅读工具箱';
    shadow.appendChild(fab);

    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.innerHTML = `
        <div class="btn" data-act="draw" title="涂鸦模式">✏️</div>
        <div class="btn" data-act="eraser" title="橡皮擦">🧽</div>
        <div class="btn" data-act="color" title="切换颜色">
            🎨<span class="dot" style="background:${drawColor}"></span>
        </div>
        <div class="sep"></div>
        <div class="btn" data-act="clearDraw" title="清除本页涂鸦">🗑️</div>
        <div class="btn" data-act="panel" title="打开笔记面板">📋</div>
    `;
    shadow.appendChild(tools);

    const btnDraw = tools.querySelector('[data-act="draw"]');
    const btnEraser = tools.querySelector('[data-act="eraser"]');
    const btnColor = tools.querySelector('[data-act="color"]');
    const btnColorDot = btnColor.querySelector('.dot');
    const btnClearDraw = tools.querySelector('[data-act="clearDraw"]');
    const btnPanel = tools.querySelector('[data-act="panel"]');
    const badge = fab.querySelector('.badge');

    function updateBadge() {
        const n = hlAll().length;
        if (n > 0) { badge.textContent = n > 99 ? '99+' : n; badge.style.display = 'flex'; }
        else badge.style.display = 'none';
    }

    // --- 悬浮球旋转：工具栏展开时让笔头对准工具栏中心 ---
    function updateFabTransform() {
        if (!fab) return;
        const toolsVisible = tools.classList.contains('show');

        if (toolsVisible) {
            const fabRect = fab.getBoundingClientRect();
            const toolsRect = tools.getBoundingClientRect();
            const dx = (toolsRect.left + toolsRect.width / 2) - (fabRect.left + fabRect.width / 2);
            const dy = (toolsRect.top + toolsRect.height / 2) - (fabRect.top + fabRect.height / 2);
            // 🖍 原始朝向是左下 45°，需补偿
            const angle = Math.atan2(dy, dx) * 180 / Math.PI - 90 - 45;
            fab.style.transform = `rotate(${angle}deg) scale(1.06)`;
        } else {
            fab.style.transform = '';
        }
    }

    let fabPos = gmGet(FAB_POS_KEY, { right: 20, bottom: 100 });
    function applyFabPos() {
        if (fabPos.left !== undefined && fabPos.top !== undefined) {
            fab.style.left = fabPos.left + 'px'; fab.style.top = fabPos.top + 'px';
            fab.style.right = 'auto'; fab.style.bottom = 'auto';
        } else {
            fab.style.right = fabPos.right + 'px'; fab.style.bottom = fabPos.bottom + 'px';
            fab.style.left = 'auto'; fab.style.top = 'auto';
        }
    }
    applyFabPos();

    let dragState = null;
    const DRAG_THRESHOLD = 6;

    fab.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        try { fab.setPointerCapture(e.pointerId); } catch {}
        dragState = { startX: e.clientX, startY: e.clientY, moved: false, rect: fab.getBoundingClientRect() };
    });

    fab.addEventListener('pointermove', e => {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragState.moved = true;
        if (dragState.moved) {
            const newLeft = dragState.rect.left + dx;
            const newTop = dragState.rect.top + dy;
            const maxLeft = window.innerWidth - fab.offsetWidth;
            const maxTop = window.innerHeight - fab.offsetHeight;
            fab.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
            fab.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
            fab.style.right = 'auto'; fab.style.bottom = 'auto';
            if (tools.classList.contains('show')) updateFabTransform();
        }
    });

    fab.addEventListener('pointerup', () => {
        if (!dragState) return;
        const wasMoved = dragState.moved;
        dragState = null;
        if (wasMoved) {
            const rect = fab.getBoundingClientRect();
            fabPos = { left: rect.left, top: rect.top };
            gmSet(FAB_POS_KEY, fabPos);
        } else {
            toggleTools();
        }
    });
    fab.addEventListener('pointercancel', () => { dragState = null; });

    function toggleTools() { if (tools.classList.contains('show')) closeTools(); else openTools(); }

    function openTools() {
        const rect = fab.getBoundingClientRect();
        const toolsH = 5 * 45 + 20; const toolsW = 54;
        let left, top;
        if (rect.left > toolsW + 12) left = rect.left - toolsW - 8;
        else left = rect.right + 8;
        top = rect.top + rect.height / 2 - toolsH / 2;
        top = Math.max(8, Math.min(top, window.innerHeight - toolsH - 8));
        tools.style.left = left + 'px'; tools.style.top = top + 'px';
        tools.classList.add('show'); fab.classList.add('open');
        requestAnimationFrame(() => updateFabTransform());
    }

    function closeTools() {
        tools.classList.remove('show');
        fab.classList.remove('open');
        updateFabTransform();
    }

    document.addEventListener('pointerdown', e => {
        if (isInsideHost(e)) return;
        closeTools();
    });

    btnDraw.addEventListener('click', e => {
        e.stopPropagation(); drawingMode = !drawingMode;
        if (drawingMode) eraserMode = false;
        btnDraw.classList.toggle('active', drawingMode);
        btnEraser.classList.toggle('active', eraserMode);
        updateOverlayEvents();
    });
    btnEraser.addEventListener('click', e => {
        e.stopPropagation(); eraserMode = !eraserMode;
        if (eraserMode) drawingMode = false;
        btnDraw.classList.toggle('active', drawingMode);
        btnEraser.classList.toggle('active', eraserMode);
        updateOverlayEvents();
    });
    btnColor.addEventListener('click', e => {
        e.stopPropagation();
        let idx = DRAW_COLORS.indexOf(drawColor);
        idx = (idx + 1) % DRAW_COLORS.length;
        drawColor = DRAW_COLORS[idx];
        btnColorDot.style.background = drawColor;
    });
    btnClearDraw.addEventListener('click', e => {
        e.stopPropagation();
        if (strokes.length === 0) { alert('本页没有涂鸦'); return; }
        if (!confirm('确定要清除本页所有涂鸦吗？此操作不可恢复。')) return;
        strokes = []; currentStroke = null;
        drawSetCurrent([]); redrawAll();
        if (panel.classList.contains('open')) refreshPanel();
    });
    btnPanel.addEventListener('click', e => {
        e.stopPropagation();
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) refreshPanel();
        closeTools();
    });

    // ==================== 选中文字工具条 ====================
    const selToolbar = document.createElement('div');
    selToolbar.className = 'sel-toolbar';
    const HL_COLORS = [
        { name: '黄', value: '#ffeb3b' }, { name: '绿', value: '#a5d6a7' },
        { name: '蓝', value: '#90caf9' }, { name: '粉', value: '#f8bbd0' },
        { name: '紫', value: '#ce93d8' }
    ];
    HL_COLORS.forEach(c => {
        const dot = document.createElement('div');
        dot.className = 'c';
        dot.style.background = c.value;
        dot.title = c.name;
        dot.addEventListener('mousedown', e => e.preventDefault());
        dot.addEventListener('click', e => {
            e.stopPropagation();
            applyHighlight(c.value, '');
        });
        selToolbar.appendChild(dot);
    });
    const noteBtn = document.createElement('button');
    noteBtn.textContent = '＋笔记';
    noteBtn.addEventListener('mousedown', e => e.preventDefault());
    noteBtn.addEventListener('click', e => {
        e.stopPropagation();
        const sel = window.getSelection();
        const savedText = sel ? sel.toString().trim() : '';
        const note = prompt('输入批注：', '');
        if (note === null) return;
        if (!savedText) { hideSelToolbar(); return; }
        applyHighlightByText(savedText, '#ffeb3b', note);
    });
    selToolbar.appendChild(noteBtn);
    selToolbar.addEventListener('pointerdown', e => e.stopPropagation());
    shadow.appendChild(selToolbar);

    // ==================== 高亮菜单 ====================
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.innerHTML = `
        <button class="edit">✏️ 编辑批注</button>
        <button class="delete danger">🗑 删除高亮</button>
    `;
    menu.addEventListener('pointerdown', e => e.stopPropagation());
    shadow.appendChild(menu);
    let menuTargetId = null;
    menu.querySelector('.edit').addEventListener('click', () => {
        const id = menuTargetId; hideMenu();
        if (!id) return;
        const it = hlAll().find(x => x.id === id);
        const note = prompt('编辑批注：', it ? it.note || '' : '');
        if (note === null) return;
        hlUpdate(id, { note }); refreshPanel();
    });
    menu.querySelector('.delete').addEventListener('click', () => {
        const id = menuTargetId; hideMenu();
        if (!id) return;
        if (!confirm('确定删除这条高亮吗？')) return;
        removeHighlightDOM(id); hlRemove(id); updateBadge(); refreshPanel();
    });
    function showMenu(x, y, id) {
        menuTargetId = id;
        menu.style.left = Math.min(x, window.innerWidth - 150) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - 90) + 'px';
        menu.style.display = 'flex';
    }
    function hideMenu() { menu.style.display = 'none'; menuTargetId = null; }

    // ==================== 侧边栏面板 ====================
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
        <header>
            <span>📚 阅读工具箱</span>
            <div><button class="export">导出</button><button class="close">✕</button></div>
        </header>
        <div class="tabs">
            <div class="tab active" data-tab="hl">🖍 高亮笔记</div>
            <div class="tab" data-tab="draw">✏️ 涂鸦</div>
        </div>
        <div class="list"></div>
    `;
    panel.addEventListener('pointerdown', e => e.stopPropagation());
    shadow.appendChild(panel);
    const listEl = panel.querySelector('.list');
    let activeTab = 'hl';

    panel.querySelector('.close').addEventListener('click', () => panel.classList.remove('open'));
    panel.querySelector('.export').addEventListener('click', exportMarkdown);
    panel.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => {
            panel.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active'); activeTab = t.dataset.tab; refreshPanel();
        });
    });

    function refreshPanel() {
        listEl.innerHTML = '';
        if (activeTab === 'hl') refreshHLList();
        else refreshDrawList();
    }

    function refreshHLList() {
        const all = hlAll().sort((a, b) => b.time - a.time);
        if (all.length === 0) { listEl.innerHTML = '<div class="empty">还没有高亮<br>选中网页文字试试吧 ✨</div>'; return; }
        all.forEach(item => {
            const div = document.createElement('div');
            div.className = 'item';
            div.style.borderLeft = `4px solid ${item.color}`;
            const text = document.createElement('div');
            text.className = 'text';
            text.textContent = item.text.length > 200 ? item.text.slice(0, 200) + '…' : item.text;
            div.appendChild(text);
            if (item.note) {
                const n = document.createElement('div'); n.className = 'note'; n.textContent = '📝 ' + item.note; div.appendChild(n);
            }
            const meta = document.createElement('div'); meta.className = 'meta';
            const page = document.createElement('span'); page.className = 'page';
            page.textContent = (item.title || item.url).slice(0, 40); page.title = item.url;
            meta.appendChild(page);
            const time = document.createElement('span'); time.textContent = formatTime(item.time); meta.appendChild(time);
            div.appendChild(meta);

            const acts = document.createElement('div'); acts.className = 'acts';
            const go = document.createElement('button'); go.textContent = '跳转';
            go.addEventListener('click', () => {
                if (item.url === location.href.split('#')[0]) {
                    const el = document.querySelector(`[data-hl-id="${item.id}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.style.transition = 'box-shadow .4s';
                        el.style.boxShadow = '0 0 0 4px rgba(255,213,79,.8)';
                        setTimeout(() => { el.style.boxShadow = ''; }, 1200);
                    }
                } else location.href = item.url;
            }); acts.appendChild(go);
            const ed = document.createElement('button'); ed.textContent = '编辑';
            ed.addEventListener('click', () => {
                const note = prompt('编辑批注：', item.note || '');
                if (note === null) return; hlUpdate(item.id, { note }); refreshPanel();
            }); acts.appendChild(ed);
            const del = document.createElement('button'); del.className = 'danger'; del.textContent = '删除';
            del.addEventListener('click', () => {
                if (!confirm('确定删除这条高亮吗？')) return;
                removeHighlightDOM(item.id); hlRemove(item.id); refreshPanel(); updateBadge();
            });
            acts.appendChild(del);
            div.appendChild(acts); listEl.appendChild(div);
        });
    }

    function refreshDrawList() {
        const url = location.href.split('#')[0];
        const all = drawAll(); const urls = Object.keys(all);
        if (urls.length === 0) { listEl.innerHTML = '<div class="empty">还没有涂鸦<br>展开工具栏点 ✏️ 开始画吧</div>'; return; }
        urls.sort((a, b) => (a === url ? -1 : b === url ? 1 : 0));
        urls.forEach(u => {
            const strokeList = all[u];
            if (!strokeList || strokeList.length === 0) return;
            const div = document.createElement('div');
            div.className = 'item draw-item';
            if (u === url) div.style.borderLeft = '4px solid #ffd54f';
            const title = document.createElement('div'); title.className = 'text';
            try { title.textContent = new URL(u).hostname + (u === url ? '（当前页面）' : ''); } catch { title.textContent = u.slice(0, 40); }
            div.appendChild(title);
            const count = document.createElement('div'); count.className = 'note'; count.textContent = `🎨 ${strokeList.length} 条笔画`; div.appendChild(count);
            const cw = document.createElement('div'); cw.className = 'canvas-wrap';
            const thumb = document.createElement('canvas'); const maxW = 260;
            let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
            strokeList.forEach(s => s.points.forEach(p => {
                if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
            }));
            if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
            const w = Math.max(50, maxX - minX + 20); const h = Math.max(50, maxY - minY + 20);
            const scale = Math.min(1, maxW / w);
            thumb.width = w * scale; thumb.height = h * scale;
            const tctx = thumb.getContext('2d');
            tctx.scale(scale, scale); tctx.translate(-minX + 10, -minY + 10);
            tctx.lineCap = 'round'; tctx.lineJoin = 'round';
            strokeList.forEach(s => {
                if (s.points.length === 0) return;
                tctx.strokeStyle = s.color; tctx.lineWidth = s.width;
                tctx.beginPath();
                if (s.points.length === 1) {
                    tctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
                    tctx.fillStyle = s.color; tctx.fill();
                } else {
                    tctx.moveTo(s.points[0].x, s.points[0].y);
                    for (let i = 1; i < s.points.length - 1; i++) {
                        const xc = (s.points[i].x + s.points[i + 1].x) / 2;
                        const yc = (s.points[i].y + s.points[i + 1].y) / 2;
                        tctx.quadraticCurveTo(s.points[i].x, s.points[i].y, xc, yc);
                    }
                    const last = s.points[s.points.length - 1];
                    tctx.lineTo(last.x, last.y); tctx.stroke();
                }
            });
            cw.appendChild(thumb); div.appendChild(cw);
            const acts = document.createElement('div'); acts.className = 'acts';
            if (u === url) {
                const clear = document.createElement('button'); clear.className = 'danger'; clear.textContent = '清除本页涂鸦';
                clear.addEventListener('click', () => {
                    if (!confirm('确定要清除本页所有涂鸦吗？此操作不可恢复。')) return;
                    strokes = []; currentStroke = null; drawSetCurrent([]); redrawAll(); refreshPanel();
                }); acts.appendChild(clear);
            } else {
                const go = document.createElement('button'); go.textContent = '跳转';
                go.addEventListener('click', () => { location.href = u; }); acts.appendChild(go);
                const del = document.createElement('button'); del.className = 'danger'; del.textContent = '删除';
                del.addEventListener('click', () => {
                    if (!confirm('确定要删除该页面的涂鸦吗？此操作不可恢复。')) return;
                    const all2 = drawAll(); delete all2[u]; drawSave(all2); refreshPanel();
                }); acts.appendChild(del);
            }
            div.appendChild(acts); listEl.appendChild(div);
        });
    }

    function formatTime(ts) {
        const d = new Date(ts); const diff = (Date.now() - d) / 1000;
        if (diff < 60) return '刚刚';
        if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
        if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
        if (diff < 86400 * 7) return Math.floor(diff / 86400) + '天前';
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    function exportMarkdown() {
        const all = hlAll().sort((a, b) => a.time - b.time);
        if (all.length === 0) { alert('还没有高亮笔记可导出'); return; }
        const groups = {};
        all.forEach(it => { if (!groups[it.url]) groups[it.url] = { title: it.title, url: it.url, items: [] }; groups[it.url].items.push(it); });
        let md = '# 阅读笔记\n\n导出时间：' + new Date().toLocaleString() + '\n\n---\n\n';
        Object.values(groups).forEach(g => {
            md += `## ${g.title || g.url}\n\n<${g.url}>\n\n`;
            g.items.forEach((it, i) => {
                md += `${i + 1}. **${it.text.replace(/\n/g, ' ')}**\n`;
                if (it.note) md += `   > 📝 ${it.note}\n`;
                md += `   \n   时间：${new Date(it.time).toLocaleString()}\n\n`;
            });
            md += '---\n\n';
        });
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = '阅读笔记_' + new Date().toISOString().slice(0, 10) + '.md'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function genId() { return 'hl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

    function applyHighlight(color, note) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const text = sel.toString().trim();
        if (!text) return;
        const range = sel.getRangeAt(0);
        if (isInsideMark(range)) { sel.removeAllRanges(); hideSelToolbar(); return; }
        const id = genId();
        const item = { id, url: location.href.split('#')[0], title: document.title, text, color, note: note || '', time: Date.now() };
        if (wrapRange(range, id, color)) {
            hlAdd(item); updateBadge();
            if (panel.classList.contains('open')) refreshPanel();
        }
        sel.removeAllRanges(); hideSelToolbar();
    }

    function applyHighlightByText(text, color, note) {
        if (!text) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = node.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                const tag = p.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
                if (p.closest('.rtb-hl-mark')) return NodeFilter.FILTER_REJECT;
                if (p.closest('#rtb-host')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) {
            const idx = n.nodeValue.indexOf(text);
            if (idx < 0) continue;
            try {
                const r = document.createRange();
                r.setStart(n, idx); r.setEnd(n, idx + text.length);
                const id = genId();
                const item = { id, url: location.href.split('#')[0], title: document.title, text, color, note: note || '', time: Date.now() };
                if (wrapRange(r, id, color)) {
                    hlAdd(item); updateBadge();
                    if (panel.classList.contains('open')) refreshPanel();
                }
                hideSelToolbar();
                return;
            } catch { continue; }
        }
        hideSelToolbar();
    }

    function isInsideMark(range) {
        let n = range.startContainer;
        if (n.nodeType === Node.TEXT_NODE) n = n.parentNode;
        return !!(n && n.closest && n.closest('.rtb-hl-mark'));
    }

    function wrapRange(range, id, color) {
        const span = document.createElement('span');
        span.className = 'rtb-hl-mark';
        span.dataset.hlId = id;
        span.style.backgroundColor = color;
        span.style.borderRadius = '2px';
        span.style.cursor = 'pointer';
        span.style.boxDecorationBreak = 'clone';
        span.style.webkitBoxDecorationBreak = 'clone';
        try { range.surroundContents(span); }
        catch {
            try { const frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); }
            catch { return false; }
        }
        bindMarkEvents(span); return true;
    }

    function bindMarkEvents(span) {
        if (span.dataset.bound) return;
        span.dataset.bound = '1';
        span.addEventListener('click', e => {
            e.stopPropagation();
            showMenu(e.clientX, e.clientY, span.dataset.hlId);
        });
    }

    function removeHighlightDOM(id) {
        const el = document.querySelector(`[data-hl-id="${id}"]`);
        if (!el) return;
        const p = el.parentNode;
        while (el.firstChild) p.insertBefore(el.firstChild, el);
        p.removeChild(el); p.normalize();
    }

    function restoreHighlights() {
        hlCurrent().forEach(item => {
            if (document.querySelector(`[data-hl-id="${item.id}"]`)) return;
            findAndWrap(item);
        });
    }

    function findAndWrap(item) {
        if (!item.text) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = node.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                const tag = p.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
                if (p.closest('.rtb-hl-mark')) return NodeFilter.FILTER_REJECT;
                if (p.closest('#rtb-host')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) {
            const idx = n.nodeValue.indexOf(item.text);
            if (idx < 0) continue;
            try {
                const r = document.createRange();
                r.setStart(n, idx); r.setEnd(n, idx + item.text.length);
                wrapRange(r, item.id, item.color); return true;
            } catch { continue; }
        }
        return false;
    }

    function showSelToolbar(rect) {
        selToolbar.style.display = 'flex';
        const tw = selToolbar.offsetWidth || 240;
        const th = selToolbar.offsetHeight || 44;
        let left, top;
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        if (isMobile) {
            left = (window.innerWidth - tw) / 2;
            top = window.innerHeight - th - 90;
        } else {
            left = rect.left + rect.width / 2 - tw / 2;
            top = rect.bottom + 8;
            if (top + th > window.innerHeight - 8) top = rect.top - th - 8;
            if (top < 8) top = window.innerHeight - th - 8;
        }

        left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
        selToolbar.style.left = left + 'px';
        selToolbar.style.top = top + 'px';
    }
    function hideSelToolbar() { selToolbar.style.display = 'none'; }

    let lastSelectionText = '';

    function tryShowToolbar() {
        if (drawingMode || eraserMode) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
            hideSelToolbar();
            lastSelectionText = '';
            return;
        }
        const text = sel.toString().trim();
        if (!text) { hideSelToolbar(); return; }

        if (selToolbar.style.display === 'flex' && text === lastSelectionText) return;

        const range = sel.getRangeAt(0);
        if (isInsideMark(range)) { hideSelToolbar(); return; }

        let rect = range.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            if (range.startContainer && range.startContainer.parentElement) {
                rect = range.startContainer.parentElement.getBoundingClientRect();
            }
        }
        if (rect.width === 0 && rect.height === 0) return;

        lastSelectionText = text;
        showSelToolbar(rect);
    }

    function checkSelection() {
        tryShowToolbar();
        setTimeout(tryShowToolbar, 50);
        setTimeout(tryShowToolbar, 150);
        setTimeout(tryShowToolbar, 300);
        setTimeout(tryShowToolbar, 500);
    }

    document.addEventListener('mouseup', e => {
        if (isInsideHost(e)) return;
        setTimeout(checkSelection, 10);
    });

    document.addEventListener('touchend', e => {
        if (isInsideHost(e)) return;
        setTimeout(checkSelection, 100);
    });

    let selectionTimer = null;
    document.addEventListener('selectionchange', () => {
        if (drawingMode || eraserMode) return;
        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => {
            checkSelection();
        }, 30);
    });

    document.addEventListener('touchmove', () => {
        if (drawingMode || eraserMode) return;
        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => {
            checkSelection();
        }, 200);
    }, { passive: true });

    document.addEventListener('mousedown', e => {
        if (isInsideHost(e)) return;
        hideSelToolbar();
        hideMenu();
        lastSelectionText = '';
    });
    window.addEventListener('scroll', () => { hideSelToolbar(); hideMenu(); }, { passive: true });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (drawingMode || eraserMode) exitDrawingMode();
            if (tools.classList.contains('show')) closeTools();
            if (panel.classList.contains('open')) panel.classList.remove('open');
            hideSelToolbar(); hideMenu();
        }
    });

    // ==================== 启动 ====================
    updateBadge();
    setTimeout(loadStrokes, 200);
    if (document.readyState === 'complete') setTimeout(restoreHighlights, 300);
    else window.addEventListener('load', () => setTimeout(restoreHighlights, 300));

    let retry = 0;
    const timer = setInterval(() => {
        retry++;
        if (retry > 5) { clearInterval(timer); return; }
        hlCurrent().forEach(item => {
            if (!document.querySelector(`[data-hl-id="${item.id}"]`)) findAndWrap(item);
        });
    }, 1500);
})();
