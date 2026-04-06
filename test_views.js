// View checklist: tests every layout mode to catch regressions
// Run: node test_views.js
// Requires: playwright, gemotvis demo on localhost:9090
//
// Views tested:
// 1. showcase/minimal  — 5 agents, side panel, single-delib cycling
// 2. showcase/magi     — same layout, MAGI theme
// 3. showcase/gastown  — same layout, Gastown theme
// 4. diplomacy/minimal — 7 agents, multi-delib, side panel
// 5. code-review/minimal — 3 agents, center panel
// 6. showcase 3-agent  — MAGI triangle (3 agents, center panel)

const { chromium } = require('playwright');
const BASE = 'http://localhost:9090';
const RESULTS = [];

function check(name, condition, detail) {
  RESULTS.push({ name, pass: condition, detail });
  if (!condition) console.log(`  FAIL: ${name} — ${detail}`);
}

async function testView(page, label, url, advanceSteps, expectations) {
  await page.goto(url);
  await page.waitForTimeout(5000);
  for (let i = 0; i < advanceSteps; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => {
    const nodes = document.querySelectorAll('.react-flow__node');
    const activeNodes = document.querySelectorAll('.agent-node-active');
    const inactiveNodes = document.querySelectorAll('.agent-node-inactive');
    const centerPanel = document.querySelector('.center-panel-overlay');
    const sidePanel = document.querySelector('.chat-panel-side');
    const bubbles = document.querySelectorAll('.chat-bubble');
    const footer = document.querySelector('.graph-footer');
    const footerPanels = document.querySelectorAll('.footer-panel');
    const bottomBar = document.querySelector('.bottom-bar');

    // Color consistency
    const nodeColors = {};
    nodes.forEach(n => {
      const id = n.getAttribute('data-id');
      const icon = n.querySelector('.agent-node-icon');
      if (icon) nodeColors[id] = getComputedStyle(icon).borderColor;
    });
    const chatColors = {};
    bubbles.forEach(b => {
      const name = b.querySelector('.chat-name')?.textContent;
      if (name && !chatColors[name]) chatColors[name] = b.style.borderLeftColor;
    });
    let colorMismatches = 0;
    for (const [id, nc] of Object.entries(nodeColors)) {
      const cc = chatColors[id];
      if (cc && nc !== cc) colorMismatches++;
    }

    // Footer positioning
    const footerOK = (() => {
      if (!footer) return true; // no footer yet is ok
      const fr = footer.getBoundingClientRect();
      return fr.left >= -5; // not shifted off-screen
    })();

    // Side panel vs bottom bar overlap
    const sidePanelOverlap = (() => {
      if (!sidePanel || !bottomBar) return false;
      const sp = sidePanel.getBoundingClientRect();
      const bb = bottomBar.getBoundingClientRect();
      return sp.bottom > bb.top + 5;
    })();

    // Node dimming check
    const allNodeOpacities = [];
    nodes.forEach(n => {
      const s = getComputedStyle(n.querySelector('.agent-node') || n);
      allNodeOpacities.push(parseFloat(s.opacity) || 1);
    });

    return {
      nodeCount: nodes.length,
      activeCount: activeNodes.length,
      inactiveCount: inactiveNodes.length,
      hasCenterPanel: !!centerPanel,
      hasSidePanel: !!sidePanel,
      bubbleCount: bubbles.length,
      footerPanelCount: footerPanels.length,
      colorMismatches,
      footerOK,
      sidePanelOverlap,
      allNodeOpacities,
    };
  });

  check(`${label}/nodes`, state.nodeCount === expectations.nodes,
    `expected ${expectations.nodes} nodes, got ${state.nodeCount}`);

  if (expectations.panel === 'center') {
    check(`${label}/center-panel`, state.hasCenterPanel, 'expected center panel');
  } else if (expectations.panel === 'side') {
    check(`${label}/has-panel`, state.hasSidePanel || state.hasCenterPanel, 'expected a chat panel');
  }

  check(`${label}/has-bubbles`, state.bubbleCount > 0, `${state.bubbleCount} bubbles`);
  check(`${label}/colors-match`, state.colorMismatches === 0,
    `${state.colorMismatches} color mismatches`);
  check(`${label}/footer-positioned`, state.footerOK, 'footer not shifted');
  check(`${label}/no-panel-overlap`, !state.sidePanelOverlap, 'side panel overlaps bottom bar');

  if (expectations.noDimming) {
    check(`${label}/no-inactive-nodes`, state.inactiveCount === 0,
      `${state.inactiveCount} inactive nodes (all should be active in single-delib)`);
  }

  if (expectations.hasDimming) {
    check(`${label}/has-inactive-nodes`, state.inactiveCount > 0,
      `${state.inactiveCount} inactive nodes (some should dim in multi-delib bilateral)`);
  }
}

(async () => {
  const browser = await chromium.launch();

  // View 1: showcase, minimal, 5 agents, side panel
  console.log('\n--- showcase/minimal (5 agents, side panel) ---');
  const p1 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testView(p1, 'showcase-minimal', `${BASE}?demo=1&data=showcase&theme=minimal`, 15,
    { nodes: 5, panel: 'side', noDimming: true });
  await p1.close();

  // View 2: showcase, magi
  console.log('\n--- showcase/magi ---');
  const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testView(p2, 'showcase-magi', `${BASE}?demo=1&data=showcase&theme=magi`, 15,
    { nodes: 5, panel: 'side', noDimming: true });
  await p2.close();

  // View 3: showcase, gastown
  console.log('\n--- showcase/gastown ---');
  const p3 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testView(p3, 'showcase-gastown', `${BASE}?demo=1&data=showcase&theme=gastown`, 15,
    { nodes: 5, panel: 'side', noDimming: true });
  await p3.close();

  // View 4: diplomacy, 7 agents, multi-delib, side panel
  console.log('\n--- diplomacy/minimal (7 agents, multi-delib) ---');
  const p4 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testView(p4, 'diplomacy-minimal', `${BASE}?demo=1&data=diplomacy&theme=minimal`, 20,
    { nodes: 7, panel: 'side' });
  await p4.close();

  // View 5: code-review, 3 agents, center panel
  console.log('\n--- code-review/minimal (3 agents, center panel) ---');
  const p5 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testView(p5, 'code-review-minimal', `${BASE}?demo=1&data=code-review&theme=minimal`, 10,
    { nodes: 3, panel: 'center', noDimming: true });
  await p5.close();

  // View 6: showcase cycles through delibs — test after skip to MAGI triangle (3 agents)
  console.log('\n--- showcase/skip-to-3-agent ---');
  const p6 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await p6.goto(`${BASE}?demo=1&data=showcase&theme=minimal`);
  await p6.waitForTimeout(5000);
  // Skip through delibs to find the 3-agent one
  for (let i = 0; i < 3; i++) {
    await p6.keyboard.press('s');
    await p6.waitForTimeout(4000);
  }
  const skipState = await p6.evaluate(() => ({
    nodeCount: document.querySelectorAll('.react-flow__node').length,
    inactiveCount: document.querySelectorAll('.agent-node-inactive').length,
  }));
  check('showcase-skip/no-inactive', skipState.inactiveCount === 0,
    `${skipState.inactiveCount} inactive after skip (${skipState.nodeCount} nodes)`);
  await p6.close();

  await browser.close();

  const passed = RESULTS.filter(r => r.pass).length;
  const failed = RESULTS.filter(r => !r.pass).length;
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('\nFailed:');
    RESULTS.filter(r => !r.pass).forEach(r => console.log(`  ${r.name}: ${r.detail}`));
    process.exit(1);
  }
})();
