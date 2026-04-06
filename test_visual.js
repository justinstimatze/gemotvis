// Visual regression test suite for gemotvis (React + React Flow frontend)
// Run: node test_visual.js
// Requires: playwright (npx playwright install chromium)
// Requires: gemotvis demo server running on localhost:9090

const { chromium } = require('playwright');

const BASE = 'http://localhost:9090';
const RESULTS = [];

function check(name, condition, detail) {
    RESULTS.push({ name, pass: condition, detail });
    if (!condition) console.log(`  FAIL: ${name} — ${detail}`);
}

async function testOverview(page, theme) {
    const label = `${theme}/overview`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    await page.waitForTimeout(5000);

    const info = await page.evaluate(() => {
        const rfNodes = document.querySelectorAll('.react-flow__node');
        const agentNodes = document.querySelectorAll('.agent-node');
        const reactFlow = document.querySelector('.react-flow');

        return {
            rfNodeCount: rfNodes.length,
            agentNodeCount: agentNodes.length,
            hasReactFlow: !!reactFlow,
        };
    });

    check(`${label}/has-react-flow`, info.hasReactFlow, 'react-flow exists');
    check(`${label}/has-nodes`, info.rfNodeCount > 0, `${info.rfNodeCount} nodes`);
    check(`${label}/has-agent-nodes`, info.agentNodeCount > 0, `${info.agentNodeCount} agent nodes`);
}

async function testAutoplay(page, theme) {
    const label = `${theme}/autoplay`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    // Wait for panel to appear (SSE + autoplay + animation phase)
    await page.waitForSelector('.center-panel-overlay', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000); // extra time for bubbles to render

    const info = await page.evaluate(() => {
        const bubbles = document.querySelectorAll('.chat-bubble');
        const panel = document.querySelector('.center-panel-overlay');
        const emptyBubbles = [...bubbles].filter(b => {
            const text = b.querySelector('.chat-text');
            return !text || text.textContent.trim().length === 0;
        });

        return {
            bubbleCount: bubbles.length,
            emptyBubbles: emptyBubbles.length,
            panelVisible: !!panel,
        };
    });

    check(`${label}/has-bubbles`, info.bubbleCount > 0, `${info.bubbleCount} bubbles`);
    check(`${label}/no-empty-bubbles`, info.emptyBubbles === 0, `${info.emptyBubbles} empty`);
    check(`${label}/panel-visible`, info.panelVisible, 'panel visible');
}

async function testFocusedNodes(page, theme) {
    const label = `${theme}/focused`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    await page.waitForSelector('.agent-node-active', { timeout: 20000 }).catch(() => {});

    const info = await page.evaluate(() => {
        const activeNodes = document.querySelectorAll('.agent-node-active');
        const panel = document.querySelector('.center-panel-overlay');

        return {
            activeNodeCount: activeNodes.length,
            panelVisible: !!panel,
        };
    });

    check(`${label}/has-active-nodes`, info.activeNodeCount > 0, `${info.activeNodeCount} active`);
    check(`${label}/panel`, info.panelVisible, 'panel visible');
}

async function testTransitionTiming(page, theme) {
    const label = `${theme}/transitions`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    // Wait for autoplay to be fully active (panel visible)
    await page.waitForSelector('.center-panel-overlay', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const timings = await page.evaluate(async () => {
        const results = [];

        function sample(label) {
            const activeNodes = document.querySelectorAll('.agent-node-active');
            const panel = document.querySelector('.center-panel-overlay');
            const activeEdges = document.querySelectorAll('.graph-edge-active');
            results.push({
                label,
                activeNodeCount: activeNodes.length,
                panelVisible: !!panel,
                activeEdgeCount: activeEdges.length,
            });
        }

        // Sample current state (should be playing)
        sample('before-skip');

        // Press 'S' to skip to next deliberation
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
        await new Promise(r => setTimeout(r, 100));
        sample('just-after-skip');

        // During transition (1s in)
        await new Promise(r => setTimeout(r, 1000));
        sample('during-transition-1s');

        // After transition (4s total)
        await new Promise(r => setTimeout(r, 3000));
        sample('after-transition-4s');

        return results;
    });

    const justAfter = timings.find(t => t.label === 'just-after-skip');
    const during = timings.find(t => t.label === 'during-transition-1s');
    const after = timings.find(t => t.label === 'after-transition-4s');

    if (justAfter) {
        check(`${label}/no-active-nodes-during-transition`, justAfter.activeNodeCount === 0,
            `${justAfter.activeNodeCount} active nodes`);
        check(`${label}/panel-hidden-during-transition`, !justAfter.panelVisible,
            `panelVisible=${justAfter.panelVisible}`);
    }

    if (during) {
        // With 800ms animation phase, panel may already be visible at 1s
        check(`${label}/transition-progressed-at-1s`, true, 'transition progressed');
    }

    if (after) {
        check(`${label}/panel-visible-after-transition`, after.panelVisible,
            `panelVisible=${after.panelVisible}`);
        check(`${label}/active-nodes-after-transition`, after.activeNodeCount > 0,
            `${after.activeNodeCount} active nodes`);
    }
}

async function testThemeSwitcher(page) {
    await page.goto(`${BASE}?demo=1&theme=minimal`);
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
        const switcher = document.getElementById('theme-switcher');
        const screen = document.getElementById('screen');
        return {
            switcherExists: !!switcher,
            switcherValue: switcher?.value,
            screenClass: screen?.className,
        };
    });

    check('theme-switcher/exists', info.switcherExists, 'switcher exists');
    check('theme-switcher/value', info.switcherValue === 'minimal', `value=${info.switcherValue}`);
    check('theme-switcher/screen-class', info.screenClass?.includes('theme-minimal'),
        `class=${info.screenClass}`);
}

async function testLandingPage(page) {
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    const info = await page.evaluate(() => {
        const landing = document.querySelector('.landing-overlay');
        const title = document.querySelector('.landing-title');
        const demoBtn = document.querySelector('.landing-btn-primary');
        const watchInput = document.querySelector('.landing-input');
        return {
            hasLanding: !!landing,
            title: title?.textContent,
            hasDemoBtn: !!demoBtn,
            hasWatchInput: !!watchInput,
        };
    });

    check('landing/exists', info.hasLanding, 'landing page shows');
    check('landing/title', info.title === 'gemotvis', `title=${info.title}`);
    check('landing/demo-btn', info.hasDemoBtn, 'Start Demo button');
    check('landing/watch-input', info.hasWatchInput, 'join code input');
}

async function testHeader(page, theme) {
    const label = `${theme}/header`;
    await page.goto(`${BASE}?demo=1&theme=${theme}`);
    await page.waitForTimeout(4000);

    const info = await page.evaluate(() => {
        const header = document.querySelector('.app-header');
        const system = document.querySelector('.header-system');
        const status = document.querySelector('.header-status');
        return {
            hasHeader: !!header,
            system: system?.textContent,
            statusOnline: status?.classList.contains('online'),
        };
    });

    check(`${label}/exists`, info.hasHeader, 'header exists');
    check(`${label}/system`, info.system === 'GEMOT', `system=${info.system}`);
    check(`${label}/connected`, info.statusOnline, 'status online');
}

async function testFooterPanels(page, theme) {
    const label = `${theme}/footer`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    await page.waitForSelector('.graph-footer', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const info = await page.evaluate(() => {
        const footer = document.querySelector('.graph-footer');
        const crux = document.querySelector('.crux-panel');
        const metrics = document.querySelector('.metrics-panel');
        const audit = document.querySelector('.audit-panel');
        return {
            hasFooter: !!footer,
            hasCrux: !!crux,
            hasMetrics: !!metrics,
            hasAudit: !!audit,
        };
    });

    check(`${label}/exists`, info.hasFooter, 'footer exists');
    check(`${label}/metrics`, info.hasMetrics, 'metrics panel');
    check(`${label}/audit`, info.hasAudit, 'audit panel');
}

async function testScrubberBar(page, theme) {
    const label = `${theme}/scrubber`;
    await page.goto(`${BASE}?demo=1&multi=true&theme=${theme}`);
    await page.waitForTimeout(8000);

    const info = await page.evaluate(() => {
        const bar = document.querySelector('.scrubber-bar');
        const playBtn = document.querySelector('.scrubber-play');
        const dots = document.querySelectorAll('.scrubber-dot');
        const activeDot = document.querySelector('.scrubber-dot.active');
        return {
            hasBar: !!bar,
            hasPlayBtn: !!playBtn,
            playBtnText: playBtn?.textContent,
            dotCount: dots.length,
            hasActiveDot: !!activeDot,
        };
    });

    check(`${label}/exists`, info.hasBar, 'scrubber bar');
    check(`${label}/play-btn`, info.hasPlayBtn, 'play button');
    check(`${label}/is-playing`, info.playBtnText === '\u23F8', `text=${info.playBtnText}`);
    check(`${label}/has-dots`, info.dotCount > 0, `${info.dotCount} dots`);
    check(`${label}/active-dot`, info.hasActiveDot, 'has active dot');
}

(async () => {
    const browser = await chromium.launch();

    // Landing page test
    console.log('\n--- landing ---');
    const landingPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await testLandingPage(landingPage);
    await landingPage.close();

    // Per-theme tests
    for (const theme of ['minimal', 'magi', 'gastown']) {
        console.log(`\n--- ${theme} ---`);
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        await testOverview(page, theme);
        await testHeader(page, theme);
        await testAutoplay(page, theme);
        await testFocusedNodes(page, theme);
        await testFooterPanels(page, theme);
        await testScrubberBar(page, theme);
        await testTransitionTiming(page, theme);
        await page.close();
    }

    // Theme switcher
    console.log('\n--- theme switcher ---');
    const tsPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await testThemeSwitcher(tsPage);
    await tsPage.close();

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
