// Visual QA: automated consistency checks for gemotvis
// Run: node test_visual_qa.js
// Requires: playwright (npx playwright install chromium)
// Requires: gemotvis demo server running on localhost:9090
//
// Checks:
// - Agent node colors match chat bubble colors
// - Footer panels visible and properly positioned
// - Side panel doesn't overlap bottom bar
// - Graph fits within viewport
// - Bottom bar spans full viewport width

const { chromium } = require('playwright');

const BASE = 'http://localhost:9090';
const RESULTS = [];

function check(name, condition, detail) {
  RESULTS.push({ name, pass: condition, detail });
  if (!condition) console.log(`  FAIL: ${name} — ${detail}`);
}

async function testColorConsistency(page, label, url, advanceSteps) {
  await page.goto(url);
  await page.waitForTimeout(5000);

  // Advance scrubber to get chat bubbles
  for (let i = 0; i < advanceSteps; i++) {
    await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    const nodes = document.querySelectorAll('.react-flow__node');
    const nodeColors = {};
    nodes.forEach(n => {
      const id = n.getAttribute('data-id');
      const icon = n.querySelector('.agent-node-icon');
      if (icon) nodeColors[id] = getComputedStyle(icon).borderColor;
    });

    const bubbles = document.querySelectorAll('.chat-bubble');
    const chatColors = {};
    bubbles.forEach(b => {
      const name = b.querySelector('.chat-name')?.textContent;
      if (name && !chatColors[name]) chatColors[name] = b.style.borderLeftColor;
    });

    const mismatches = [];
    for (const [id, nc] of Object.entries(nodeColors)) {
      const cc = chatColors[id];
      if (cc && nc !== cc) mismatches.push({ agent: id, node: nc, chat: cc });
    }

    return { nodeCount: nodes.length, bubbleCount: bubbles.length, mismatches };
  });

  check(`${label}/has-nodes`, result.nodeCount > 0, `${result.nodeCount} nodes`);
  check(`${label}/has-bubbles`, result.bubbleCount > 0, `${result.bubbleCount} bubbles`);
  check(`${label}/colors-match`, result.mismatches.length === 0,
    result.mismatches.length > 0
      ? result.mismatches.map(m => `${m.agent}: node=${m.node} chat=${m.chat}`).join('; ')
      : 'all colors match');
}

async function testFooterPanels(page, label, url) {
  await page.goto(url);
  await page.waitForTimeout(5000);
  // Advance to get footer data
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    const footer = document.querySelector('.graph-footer');
    if (!footer) return { hasFooter: false };

    const fr = footer.getBoundingClientRect();
    const panels = document.querySelectorAll('.footer-panel');
    const panelInfo = [];
    panels.forEach(p => {
      const r = p.getBoundingClientRect();
      const title = p.querySelector('.footer-panel-title')?.textContent;
      panelInfo.push({
        title,
        left: Math.round(r.left),
        right: Math.round(r.right),
        visible: r.left >= 0 && r.right <= window.innerWidth + 5,
        width: Math.round(r.width),
      });
    });

    return {
      hasFooter: true,
      footerLeft: Math.round(fr.left),
      footerRight: Math.round(fr.right),
      footerWidth: Math.round(fr.width),
      vpWidth: window.innerWidth,
      panelCount: panels.length,
      panelInfo,
      allVisible: panelInfo.every(p => p.visible),
    };
  });

  check(`${label}/footer-exists`, result.hasFooter, 'footer present');
  if (result.hasFooter) {
    check(`${label}/footer-3-panels`, result.panelCount === 3, `${result.panelCount} panels`);
    check(`${label}/footer-not-shifted`, result.footerLeft >= -5,
      `footer left=${result.footerLeft}`);
    check(`${label}/all-panels-visible`, result.allVisible,
      result.panelInfo.map(p => `${p.title}: left=${p.left} right=${p.right} visible=${p.visible}`).join('; '));
  }
}

async function testSidePanelLayout(page, label, url) {
  await page.goto(url);
  await page.waitForTimeout(5000);
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    const sidePanel = document.querySelector('.chat-panel-side');
    const bottomBar = document.querySelector('.bottom-bar');
    if (!sidePanel || !bottomBar) return { hasSidePanel: !!sidePanel, hasBottomBar: !!bottomBar };

    const sp = sidePanel.getBoundingClientRect();
    const bb = bottomBar.getBoundingClientRect();

    return {
      hasSidePanel: true,
      hasBottomBar: true,
      sidePanelBottom: Math.round(sp.bottom),
      bottomBarTop: Math.round(bb.top),
      overlaps: sp.bottom > bb.top + 2, // 2px tolerance
      graphView: (() => {
        const gv = document.querySelector('.graph-view');
        if (!gv) return null;
        const r = gv.getBoundingClientRect();
        return { width: Math.round(r.width), vpWidth: window.innerWidth };
      })(),
    };
  });

  if (result.hasSidePanel) {
    check(`${label}/side-panel-above-bottom-bar`, !result.overlaps,
      `sideBottom=${result.sidePanelBottom} barTop=${result.bottomBarTop}`);
    if (result.graphView) {
      check(`${label}/graph-not-behind-panel`,
        result.graphView.width < result.graphView.vpWidth - 300,
        `graphW=${result.graphView.width} vpW=${result.graphView.vpWidth}`);
    }
  }
}

async function testBodyOverflow(page, label, url) {
  await page.goto(url);
  await page.waitForTimeout(5000);

  const result = await page.evaluate(() => {
    const body = document.body;
    return {
      bodyWidth: body.offsetWidth,
      bodyScrollWidth: body.scrollWidth,
      vpWidth: window.innerWidth,
      overflows: body.scrollWidth > window.innerWidth + 5,
    };
  });

  check(`${label}/no-horizontal-overflow`, !result.overflows,
    `bodyScrollW=${result.bodyScrollWidth} vpW=${result.vpWidth}`);
}

(async () => {
  const browser = await chromium.launch();

  // Test 1: Color consistency — showcase (5 agents, side panel)
  console.log('\n--- color: showcase ---');
  const p1 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testColorConsistency(p1, 'showcase', `${BASE}?demo=1&data=showcase&theme=minimal`, 15);
  await p1.close();

  // Test 2: Color consistency — diplomacy (7 agents, multi-delib)
  console.log('\n--- color: diplomacy ---');
  const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testColorConsistency(p2, 'diplomacy', `${BASE}?demo=1&data=diplomacy&theme=minimal`, 20);
  await p2.close();

  // Test 3: Color consistency — code-review (3 agents, center panel)
  console.log('\n--- color: code-review ---');
  const p3 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testColorConsistency(p3, 'code-review', `${BASE}?demo=1&data=code-review&theme=minimal`, 10);
  await p3.close();

  // Test 4: Footer panels layout
  console.log('\n--- footer: showcase ---');
  const p4 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testFooterPanels(p4, 'footer-showcase', `${BASE}?demo=1&data=showcase&theme=minimal`);
  await p4.close();

  // Test 5: Side panel layout (showcase has 5 agents = side panel)
  console.log('\n--- side-panel: showcase ---');
  const p5 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testSidePanelLayout(p5, 'side-panel', `${BASE}?demo=1&data=showcase&theme=minimal`);
  await p5.close();

  // Test 6: Body overflow check
  console.log('\n--- overflow ---');
  const p6 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testBodyOverflow(p6, 'overflow-showcase', `${BASE}?demo=1&data=showcase&theme=minimal`);
  await testBodyOverflow(p6, 'overflow-diplomacy', `${BASE}?demo=1&data=diplomacy&theme=minimal`);
  await p6.close();

  // Test 7: MAGI theme color consistency
  console.log('\n--- color: magi ---');
  const p7 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testColorConsistency(p7, 'magi', `${BASE}?demo=1&data=showcase&theme=magi`, 15);
  await p7.close();

  // Test 8: Gastown theme color consistency
  console.log('\n--- color: gastown ---');
  const p8 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await testColorConsistency(p8, 'gastown', `${BASE}?demo=1&data=showcase&theme=gastown`, 15);
  await p8.close();

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
