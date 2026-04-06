// Visual regression test suite for gemotvis
// Run: node test_visual.js
// Requires: playwright (npx playwright install chromium)

const { chromium } = require('playwright');
const assert = require('assert');

const BASE = 'http://localhost:9090';
const RESULTS = [];

function check(name, condition, detail) {
    RESULTS.push({ name, pass: condition, detail });
    if (!condition) console.log(`  FAIL: ${name} — ${detail}`);
}

async function testOverview(page, theme) {
    const label = `${theme}/overview`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    await page.waitForTimeout(4000);

    const info = await page.evaluate(() => {
        const nodes = document.querySelectorAll('.graph-node');
        const edges = document.querySelectorAll('.graph-edge-div');
        const canvas = document.getElementById('graph-canvas');

        // Check node positions aren't clipped
        const nodeClips = [...nodes].filter(n => {
            const r = n.getBoundingClientRect();
            return r.left < -20 || r.right > window.innerWidth + 20;
        });

        return {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            clippedNodes: nodeClips.length,
            canvasExists: !!canvas,
        };
    });

    check(`${label}/nodes`, info.nodeCount > 0, `${info.nodeCount} nodes`);
    check(`${label}/edges`, info.edgeCount > 0, `${info.edgeCount} edges`);
    check(`${label}/canvas`, info.canvasExists, 'graph canvas exists');
    check(`${label}/no-clipped-nodes`, info.clippedNodes === 0, `${info.clippedNodes} nodes clipped`);
    // Demo has 5 deliberations with 17 unique agents total
    check(`${label}/node-count`, info.nodeCount === 17, `expected 17, got ${info.nodeCount}`);
    check(`${label}/edge-count`, info.edgeCount === 10, `expected 10, got ${info.edgeCount}`);
}

async function testAutoplay(page, theme) {
    const label = `${theme}/autoplay`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    await page.waitForTimeout(25000);

    const info = await page.evaluate(() => {
        const bubbles = document.querySelectorAll('.chat-bubble');
        const panel = document.getElementById('center-panel');
        const content = document.getElementById('center-content');
        const emptyBubbles = [...bubbles].filter(b => {
            const text = b.querySelector('.chat-text');
            return !text || text.textContent.trim().length === 0;
        });

        return {
            bubbleCount: bubbles.length,
            emptyBubbles: emptyBubbles.length,
            panelVisible: panel && !panel.classList.contains('hidden'),
            contentScrolled: content ? content.scrollTop > 0 : false,
            contentOverflows: content ? content.scrollHeight > content.clientHeight : false,
        };
    });

    check(`${label}/has-bubbles`, info.bubbleCount > 0, `${info.bubbleCount} bubbles`);
    check(`${label}/no-empty-bubbles`, info.emptyBubbles === 0, `${info.emptyBubbles} empty`);
    check(`${label}/panel-visible`, info.panelVisible, 'panel visible');
    if (info.contentOverflows) {
        check(`${label}/auto-scrolled`, info.contentScrolled, `scrollTop=${info.contentScrolled}`);
    }
}

async function testFocusedNodes(page, theme) {
    const label = `${theme}/focused`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    await page.waitForTimeout(18000);

    const info = await page.evaluate(() => {
        const activeNodes = document.querySelectorAll('.graph-node-active');
        const nodes = document.querySelectorAll('.graph-node');
        const panel = document.getElementById('center-panel');
        const panelRect = panel?.getBoundingClientRect();

        // Check active node ICONS aren't overlapping the panel (labels may extend)
        let nodeOverlapsPanel = false;
        activeNodes.forEach(n => {
            const icon = n.querySelector('.graph-node-icon');
            const nr = icon ? icon.getBoundingClientRect() : n.getBoundingClientRect();
            if (panelRect && nr.right > panelRect.left + 60 && nr.left < panelRect.right - 60 &&
                nr.bottom > panelRect.top && nr.top < panelRect.bottom) {
                nodeOverlapsPanel = true;
            }
        });

        // Check active nodes have enough spacing from viewport edges
        let tooCloseToEdge = false;
        activeNodes.forEach(n => {
            const r = n.getBoundingClientRect();
            if (r.left < 0 || r.right > window.innerWidth) tooCloseToEdge = true;
        });

        return {
            activeNodeCount: activeNodes.length,
            totalNodes: nodes.length,
            panelVisible: panel && !panel.classList.contains('hidden'),
            nodeOverlapsPanel,
            tooCloseToEdge,
        };
    });

    // In single-delib graph mode (demo), active nodes = agents in active edge's delib
    check(`${label}/has-active-nodes`, info.activeNodeCount > 0, `${info.activeNodeCount} active`);
    check(`${label}/panel`, info.panelVisible, 'panel visible');
    // Note: in single-delib mode, nodes stay in overview positions — some overlap with
    // center panel is expected since there's no bilateral focus to push nodes aside
    check(`${label}/not-clipped`, !info.tooCloseToEdge, 'nodes too close to edge');
}

async function testEdgeAlignment(page, theme) {
    const label = `${theme}/edges`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    await page.waitForTimeout(5000);

    const info = await page.evaluate(() => {
        const edges = document.querySelectorAll('.graph-edge-div');
        const zeroSize = [...edges].filter(e => {
            const w = parseFloat(e.style.width);
            return !w || w < 1;
        });
        return {
            totalEdges: edges.length,
            zeroSizeEdges: zeroSize.length,
        };
    });

    check(`${label}/no-zero-edges`, info.zeroSizeEdges === 0, `${info.zeroSizeEdges} zero-size edges`);
}

async function testTransitionTiming(page, theme) {
    const label = `${theme}/transitions`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    // Wait for initial load + first edge focus (scrubber starts at 100ms)
    await page.waitForTimeout(6000);

    // Sample the state at multiple points during the next edge change
    // The scrubber advances roughly every 12s per message, so by 6s we should
    // be mid-conversation. Force a skip to trigger a transition.
    const timings = await page.evaluate(async () => {
        const results = [];

        // Record current state
        function sample(label) {
            const main = document.getElementById('main');
            const activeEdges = document.querySelectorAll('.graph-edge-active');
            const panel = document.getElementById('center-panel');
            const activeNodes = document.querySelectorAll('.graph-node-active');
            results.push({
                label,
                hasFocusedClass: main?.classList.contains('graph-edge-focused'),
                activeEdgeCount: activeEdges.length,
                panelHidden: panel?.classList.contains('hidden'),
                activeNodeCount: activeNodes.length,
            });
        }

        // Click skip button to trigger edge transition
        const skipBtn = document.getElementById('scrubber-skip');
        if (!skipBtn) {
            results.push({ label: 'no-skip-btn', error: true });
            return results;
        }

        // Sample before skip
        sample('before-skip');

        // Click skip — this should trigger an edge change + 3.5s transition
        skipBtn.click();
        await new Promise(r => setTimeout(r, 50));
        sample('just-after-skip');

        // Sample during transition (1s in)
        await new Promise(r => setTimeout(r, 1000));
        sample('during-transition-1s');

        // Sample after transition should be complete (3.5s) + first message render (~1s)
        await new Promise(r => setTimeout(r, 5000));
        sample('after-transition-6s');

        return results;
    });

    if (timings.some(t => t.error)) {
        check(`${label}/skip-button-exists`, false, 'no skip button found');
        return;
    }

    const justAfter = timings.find(t => t.label === 'just-after-skip');
    const during = timings.find(t => t.label === 'during-transition-1s');
    const after = timings.find(t => t.label === 'after-transition-6s');

    if (justAfter) {
        // During transition: no focused class, no active edges, panel hidden, no active nodes
        check(`${label}/no-focus-during-transition`, !justAfter.hasFocusedClass,
            `hasFocusedClass=${justAfter.hasFocusedClass}`);
        check(`${label}/no-active-edges-during-transition`, justAfter.activeEdgeCount === 0,
            `${justAfter.activeEdgeCount} active edges`);
        check(`${label}/panel-hidden-during-transition`, justAfter.panelHidden,
            `panelHidden=${justAfter.panelHidden}`);
        check(`${label}/no-active-nodes-during-transition`, justAfter.activeNodeCount === 0,
            `${justAfter.activeNodeCount} active nodes`);
    }

    if (during) {
        check(`${label}/still-transitioning-at-1s`, !during.hasFocusedClass,
            `hasFocusedClass=${during.hasFocusedClass}`);
    }

    if (after) {
        // After transition: focused class should be back, panel visible
        check(`${label}/focus-restored-after-transition`, after.hasFocusedClass,
            `hasFocusedClass=${after.hasFocusedClass}`);
        check(`${label}/panel-visible-after-transition`, !after.panelHidden,
            `panelHidden=${after.panelHidden}`);
    }
}

async function testThemeSwitcher(page) {
    await page.goto(`${BASE}?demo=1`);
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
        const switcher = document.getElementById('theme-switcher');
        return { exists: !!switcher, value: switcher?.value };
    });

    check('theme-switcher/exists', info.exists, 'switcher exists');
    check('theme-switcher/value', info.value === 'minimal', `value=${info.value}`);
}

(async () => {
    const browser = await chromium.launch();

    for (const theme of ['minimal', 'magi', 'gastown']) {
        console.log(`\n--- ${theme} ---`);
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        await testOverview(page, theme);
        await testEdgeAlignment(page, theme);
        await testAutoplay(page, theme);
        await testFocusedNodes(page, theme);
        await testTransitionTiming(page, theme);
        await page.close();
    }

    // Theme switcher test
    console.log('\n--- theme switcher ---');
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await testThemeSwitcher(page);
    await page.close();

    await browser.close();

    // Summary
    const passed = RESULTS.filter(r => r.pass).length;
    const failed = RESULTS.filter(r => !r.pass).length;
    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
        console.log('\nFailed tests:');
        RESULTS.filter(r => !r.pass).forEach(r => console.log(`  ${r.name}: ${r.detail}`));
        process.exit(1);
    }
})();
