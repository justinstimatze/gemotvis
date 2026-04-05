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

async function testOverview(page, theme, dataset) {
    const label = `${dataset}/${theme}/overview`;
    await page.goto(`${BASE}?demo=1&data=${dataset}&multi=true&theme=${theme}`);
    await page.waitForTimeout(4000);

    const info = await page.evaluate(() => {
        const nodes = document.querySelectorAll('.graph-node');
        const edges = document.querySelectorAll('.graph-edge-div');
        const map = document.querySelector('.world-map-bg');
        const panel = document.getElementById('center-panel');
        const title = document.querySelector('.topic-label')?.textContent || '';
        const canvas = document.getElementById('graph-canvas');

        // Check node positions aren't clipped
        const nodeClips = [...nodes].filter(n => {
            const r = n.getBoundingClientRect();
            return r.left < -20 || r.right > window.innerWidth + 20;
        });

        return {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            hasMap: !!map,
            mapHasSVG: map?.querySelector('svg') != null,
            panelHidden: panel?.classList.contains('hidden'),
            title,
            clippedNodes: nodeClips.length,
            canvasExists: !!canvas,
        };
    });

    check(`${label}/nodes`, info.nodeCount > 0, `${info.nodeCount} nodes`);
    check(`${label}/edges`, info.edgeCount > 0, `${info.edgeCount} edges`);
    check(`${label}/canvas`, info.canvasExists, 'graph canvas exists');
    check(`${label}/no-clipped-nodes`, info.clippedNodes === 0, `${info.clippedNodes} nodes clipped`);

    if (dataset === 'diplomacy') {
        check(`${label}/map`, info.hasMap && info.mapHasSVG, `map=${info.hasMap} svg=${info.mapHasSVG}`);
        check(`${label}/node-count`, info.nodeCount === 7, `expected 7, got ${info.nodeCount}`);
        check(`${label}/edge-count`, info.edgeCount === 21, `expected 21, got ${info.edgeCount}`);
    }
    if (dataset === 'code-review') {
        check(`${label}/node-count`, info.nodeCount === 3, `expected 3, got ${info.nodeCount}`);
        check(`${label}/edge-count`, info.edgeCount === 3, `expected 3, got ${info.edgeCount}`);
    }
}

async function testAutoplay(page, theme, dataset) {
    const label = `${dataset}/${theme}/autoplay`;
    await page.goto(`${BASE}?demo=1&data=${dataset}&multi=true&theme=${theme}`);
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

async function testBilateralFocus(page, theme) {
    const label = `diplomacy/${theme}/bilateral`;
    await page.goto(`${BASE}?demo=1&data=diplomacy&multi=true&theme=${theme}`);
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

        // Check active nodes have enough spacing from edges
        let tooCloseToEdge = false;
        activeNodes.forEach(n => {
            const r = n.getBoundingClientRect();
            if (r.left < 10 || r.right > window.innerWidth - 10) tooCloseToEdge = true;
        });

        return {
            activeNodeCount: activeNodes.length,
            totalNodes: nodes.length,
            panelVisible: panel && !panel.classList.contains('hidden'),
            nodeOverlapsPanel,
            tooCloseToEdge,
        };
    });

    check(`${label}/active-nodes`, info.activeNodeCount === 2, `${info.activeNodeCount} active`);
    check(`${label}/panel`, info.panelVisible, 'panel visible');
    check(`${label}/no-overlap`, !info.nodeOverlapsPanel, 'nodes overlap panel');
    check(`${label}/not-clipped`, !info.tooCloseToEdge, 'nodes too close to edge');
}

async function testEdgeAlignment(page, theme, dataset) {
    const label = `${dataset}/${theme}/edges`;
    await page.goto(`${BASE}?demo=1&data=${dataset}&multi=true&theme=${theme}`);
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

async function testThemeSwitcher(page) {
    await page.goto(`${BASE}?demo=1&data=code-review`);
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
        for (const dataset of ['diplomacy', 'code-review']) {
            console.log(`\n--- ${dataset} / ${theme} ---`);
            const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
            await testOverview(page, theme, dataset);
            await testEdgeAlignment(page, theme, dataset);
            await testAutoplay(page, theme, dataset);
            if (dataset === 'diplomacy') {
                await testBilateralFocus(page, theme);
            }
            await page.close();
        }
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
