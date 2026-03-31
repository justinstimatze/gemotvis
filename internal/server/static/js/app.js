// GEMOTVIS — deliberation monitor
// Main application controller

const VOTE_LABELS_MAGI = { 1: '承認', '-1': '否定', 0: '保留' };
const VOTE_LABELS_CLASSIC = { 1: 'YEA', '-1': 'NAY', 0: '—' };
const VOTE_LABELS_MINIMAL = { 1: 'YES', '-1': 'NO', 0: '—' };
let VOTE_LABELS = VOTE_LABELS_CLASSIC; // set by applyTheme()
const VOTE_CLASSES = { 1: 'vote-approve', '-1': 'vote-deny', 0: 'vote-pass' };

const STATUS_LABELS = {
    magi: { online: 'ONLINE', offline: 'OFFLINE', closed: 'CLOSED', analyzing: 'ANALYZING' },
    classic: { online: 'Active', offline: 'Waiting', closed: 'Concluded', analyzing: 'Deliberating' },
    minimal: { online: 'Connected', offline: 'Disconnected', closed: 'Closed', analyzing: 'Analyzing' },
    gastown: { online: 'OPERATIONAL', offline: 'OFFLINE', closed: 'SEALED', analyzing: 'PROCESSING' },
};
let STATUS = STATUS_LABELS.classic; // set by applyTheme()

const PIPELINE_STAGES = ['taxonomy', 'extracting', 'deduplicating', 'crux_detection', 'summarizing', 'complete'];

const CLUSTER_COLORS = ['cluster-0', 'cluster-1', 'cluster-2', 'cluster-3', 'cluster-4', 'cluster-5'];

// State
let state = {
    deliberations: {},
    activeDelibID: null,
    connected: false,
    cyclePaused: false,  // true when user manually clicks a tab
    cycleInterval: 0,    // ms, from server config
    mode: 'live',        // 'demo' | 'replay' | 'live'
    multiView: false,    // true when watching multiple deliberations spatially
    focusedDelibID: null, // which deliberation the camera is focused on (null = overview)
    lastActivity: {},     // delibID -> timestamp of last event
};

let eventSource = null;
let cycleProgressTimer = null;
let previousVotes = {}; // agentID -> vote value, for detecting changes
let knownAgents = new Set(); // for detecting new agents
let focusTimer = null; // timer to return to overview after idle

// Scrubber state
const SCRUBBER_SPEEDS = [1200, 600, 300]; // ms per step: 1x, 2x, 4x
const SCRUBBER_SPEED_LABELS = ['1x', '2x', '4x'];
const scrubber = {
    enabled: false,
    playing: false,
    eventIndex: null, // null = live/latest
    events: [],       // full event list
    filtered: [],     // filtered by type
    playTimer: null,
    speedIdx: 0,
    typeFilter: null, // null = all, or 'position'|'vote'|'analysis'
};

// ===== Safe DOM Helpers =====

function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'className') e.className = v;
            else if (k === 'style') e.style.cssText = v;
            else if (k.startsWith('on')) e[k] = v;
            else if (k === 'dataset') Object.assign(e.dataset, v);
            else e.setAttribute(k, v);
        }
    }
    for (const c of children) {
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
    }
    return e;
}

function clearChildren(parent) {
    while (parent.firstChild) parent.removeChild(parent.firstChild);
}

// ===== SSE Connection =====

function connect() {
    if (eventSource) eventSource.close();

    eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
        state.connected = true;
        updateConnectionStatus();
    };

    eventSource.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            handleEvent(msg);
        } catch (err) {
            console.error('SSE parse error:', err);
        }
    };

    eventSource.onerror = () => {
        state.connected = false;
        updateConnectionStatus();
    };
}

function handleEvent(msg) {
    switch (msg.type) {
        case 'snapshot':
            state.deliberations = msg.data.deliberations || {};
            // Validate activeDelibID still exists in new snapshot
            if (!state.activeDelibID || !state.deliberations[state.activeDelibID]) {
                const ids = Object.keys(state.deliberations);
                if (ids.length > 0) state.activeDelibID = ids[0];
            }
            render();
            break;

        case 'state': {
            const ds = msg.data;
            if (ds && ds.deliberation) {
                const delibID = ds.deliberation.deliberation_id;
                state.deliberations[delibID] = ds;
                onActivity(delibID);
                render();
            }
            break;
        }

        case 'cycle':
            if (!state.cyclePaused && !state.multiView) {
                // Single-view tab cycling (server-driven)
                cycleNext();
                resetCycleProgress();
            }
            // Multi-view uses its own client-side demo loop
            break;

        case 'ping':
            break;
    }
}

// ===== Auto-Cycling =====

function switchToDelib(id) {
    state.activeDelibID = id;
    // Reset animation tracking so entering animations play for new view
    previousVotes = {};
    knownAgents.clear();
    // Reset scrubber to live view for new deliberation
    scrubber.enabled = false;
    scrubber.eventIndex = null;
    stopScrubberPlay();
}

function cycleNext() {
    const ids = Object.keys(state.deliberations);
    if (ids.length <= 1) return;
    const currentIdx = ids.indexOf(state.activeDelibID);
    switchToDelib(ids[(currentIdx + 1) % ids.length]);
    render();
}

function resetCycleProgress() {
    const bar = document.getElementById('cycle-progress');
    if (!bar || state.cycleInterval <= 0) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    // Force reflow then animate
    bar.offsetHeight;
    bar.style.transition = `width ${state.cycleInterval}ms linear`;
    bar.style.width = '100%';
}

async function loadConfig() {
    try {
        const resp = await fetch('/api/config');
        const cfg = await resp.json();
        state.mode = cfg.mode || 'live';
        state.cycleInterval = cfg.cycle_interval || 0;
        state.gemotURL = cfg.gemot_url || '';

        // Show/hide cycle bar
        const cycleBar = document.getElementById('cycle-bar');
        if (cycleBar) {
            if (state.cycleInterval > 0) {
                cycleBar.classList.remove('hidden');
                resetCycleProgress();
            } else {
                cycleBar.classList.add('hidden');
            }
        }
    } catch (e) {
        // Config endpoint optional
    }
}

// ===== Timeline Scrubber =====

function filterToTime(ds, cutoffTime) {
    const cutoff = new Date(cutoffTime).getTime();
    const positions = (ds.positions || []).filter(p => new Date(p.created_at).getTime() <= cutoff);
    const votes = (ds.votes || []).filter(v => new Date(v.created_at).getTime() <= cutoff);
    const visibleAgentIDs = new Set(positions.map(p => p.agent_id));
    const agents = (ds.agents || []).filter(a => visibleAgentIDs.has(a.id));
    const ops = ds.audit_log?.operations || [];
    const hasAnalysis = ops.some(op =>
        (op.method === 'gemot/analyze' || op.method === 'gemot/get_analysis_result') &&
        new Date(op.timestamp).getTime() <= cutoff
    );
    const analysis = hasAnalysis ? ds.analysis : null;
    const filteredAgents = analysis ? agents : agents.map(a => ({ ...a, cluster_id: undefined }));
    const filteredOps = ops.filter(op => new Date(op.timestamp).getTime() <= cutoff);
    return {
        deliberation: ds.deliberation,
        positions,
        votes,
        analysis,
        audit_log: ds.audit_log ? { ...ds.audit_log, operations: filteredOps } : null,
        agents: filteredAgents,
    };
}

function buildTimelineEvents(ds) {
    const ops = ds.audit_log?.operations || [];
    return ops.map((op, i) => {
        const method = op.method || '';
        let type = 'other';
        let label = method.replace('gemot/', '');
        if (method.includes('submit_position')) {
            type = 'position';
            label = `${shortAgentID(op.agent_id || '')} submits position`;
        } else if (method.includes('vote')) {
            type = 'vote';
            label = `${shortAgentID(op.agent_id || '')} votes`;
        } else if (method.includes('analy')) {
            type = 'analysis';
            label = method.includes('complete') || method.includes('result') ? 'Analysis complete' : 'Analysis started';
        }
        return { time: op.timestamp, label, type, index: i };
    }).sort((a, b) => new Date(a.time) - new Date(b.time));
}

function renderScrubber(ds) {
    const bar = document.getElementById('scrubber-bar');
    if (!bar || state.multiView) { bar?.classList.add('hidden'); return; }

    const allEvents = buildTimelineEvents(ds);
    scrubber.events = allEvents;

    if (allEvents.length < 2) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');

    // Update filter button label
    const filterBtn = document.getElementById('scrubber-filter');
    if (filterBtn) {
        filterBtn.textContent = scrubber.typeFilter ? scrubber.typeFilter.toUpperCase() : 'ALL';
    }

    const dots = document.getElementById('scrubber-dots');
    const label = document.getElementById('scrubber-label');
    clearChildren(dots);

    allEvents.forEach((evt, i) => {
        const hidden = scrubber.typeFilter && evt.type !== scrubber.typeFilter;
        const pct = (i / (allEvents.length - 1)) * 100;
        const dot = el('div', {
            className: `scrubber-dot scrubber-dot-${evt.type} ${i === scrubber.eventIndex ? 'active' : ''} ${hidden ? 'scrubber-dot-dimmed' : ''}`,
        });
        dot.style.cssText = `left: ${pct}%`;
        dot.title = evt.label;
        dot.onclick = (e) => { e.stopPropagation(); scrubTo(i); };
        dots.appendChild(dot);
    });

    const idx = scrubber.eventIndex;
    if (idx != null && events[idx]) {
        const t = new Date(events[idx].time);
        const ts = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        label.textContent = `${ts} \u2014 ${events[idx].label}`;
    } else {
        const liveText = state.mode === 'demo' || state.mode === 'replay' ? 'LATEST' : 'LIVE';
        label.textContent = liveText;
        const liveBtn = document.getElementById('scrubber-live');
        if (liveBtn) liveBtn.textContent = liveText;
    }
    updatePlayButton();
}

function scrubTo(index) {
    scrubber.enabled = true;
    scrubber.eventIndex = index;
    state.cyclePaused = true; // pause demo cycling while scrubbing
    render();
}

function scrubToLive() {
    scrubber.enabled = false;
    scrubber.eventIndex = null;
    stopScrubberPlay();
    render();
}

function toggleScrubberPlay() {
    scrubber.playing ? stopScrubberPlay() : startScrubberPlay();
}

function startScrubberPlay() {
    scrubber.playing = true;
    scrubber.enabled = true;
    if (scrubber.eventIndex == null) scrubber.eventIndex = 0;
    scrubber.playTimer = setInterval(() => {
        const next = (scrubber.eventIndex || 0) + 1;
        if (next >= scrubber.events.length) { stopScrubberPlay(); return; }
        scrubber.eventIndex = next;
        render();
    }, SCRUBBER_SPEEDS[scrubber.speedIdx]);
    updatePlayButton();
}

function cycleScrubberFilter() {
    const filters = [null, 'position', 'vote', 'analysis'];
    const idx = filters.indexOf(scrubber.typeFilter);
    scrubber.typeFilter = filters[(idx + 1) % filters.length];
    render();
}

function cycleScrubberSpeed() {
    scrubber.speedIdx = (scrubber.speedIdx + 1) % SCRUBBER_SPEEDS.length;
    const btn = document.getElementById('scrubber-speed');
    if (btn) btn.textContent = SCRUBBER_SPEED_LABELS[scrubber.speedIdx];
    // Restart playback at new speed if currently playing
    if (scrubber.playing) {
        clearInterval(scrubber.playTimer);
        startScrubberPlay();
    }
}

function stopScrubberPlay() {
    scrubber.playing = false;
    clearInterval(scrubber.playTimer);
    scrubber.playTimer = null;
    updatePlayButton();
}

function updatePlayButton() {
    const btn = document.getElementById('scrubber-play');
    if (btn) btn.textContent = scrubber.playing ? '\u23F8' : '\u25B6';
}

// ===== Terrain Decoration (classic theme) =====

let terrainRendered = false;

function renderTerrain() {
    if (terrainRendered || activeTheme !== 'classic') return;
    terrainRendered = true;

    const main = document.getElementById('main');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'terrain-layer');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    svg.setAttribute('viewBox', '0 0 1300 700');

    const ink = '#3B2F20';

    // Dense forest clusters — prominent like a real medieval map
    const treeClusters = [
        // Left edge forests
        { x: 30, y: 130, count: 7, spread: 22 },
        { x: 50, y: 480, count: 6, spread: 24 },
        { x: 120, y: 310, count: 5, spread: 20 },
        // Right edge forests
        { x: 1140, y: 100, count: 8, spread: 22 },
        { x: 1160, y: 440, count: 6, spread: 24 },
        { x: 1100, y: 580, count: 5, spread: 20 },
        // Top/bottom scatter
        { x: 500, y: 80, count: 4, spread: 18 },
        { x: 800, y: 620, count: 5, spread: 20 },
        { x: 350, y: 600, count: 6, spread: 22 },
        { x: 950, y: 90, count: 4, spread: 20 },
        // Interior small groves
        { x: 450, y: 400, count: 3, spread: 16 },
        { x: 750, y: 200, count: 3, spread: 16 },
    ];

    treeClusters.forEach(cluster => {
        for (let i = 0; i < cluster.count; i++) {
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#gi-tree');
            const ox = cluster.x + (i % 4) * cluster.spread - cluster.spread * 0.5;
            const oy = cluster.y + Math.floor(i / 4) * cluster.spread * 0.7 + (i % 2) * 6;
            const size = 20 + (i % 3) * 5;
            use.setAttribute('x', ox);
            use.setAttribute('y', oy);
            use.setAttribute('width', size);
            use.setAttribute('height', size);
            use.setAttribute('fill', ink);
            use.setAttribute('opacity', '0.18');
            svg.appendChild(use);
        }
    });

    // Hill/peak symbols — more and bolder
    const hills = [
        { x: 200, y: 520, w: 70, h: 40 },
        { x: 850, y: 100, w: 80, h: 45 },
        { x: 600, y: 600, w: 60, h: 35 },
        { x: 1050, y: 300, w: 70, h: 40 },
        { x: 100, y: 80, w: 55, h: 30 },
        { x: 700, y: 50, w: 50, h: 28 },
    ];

    hills.forEach(h => {
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#gi-peaks');
        use.setAttribute('x', h.x);
        use.setAttribute('y', h.y);
        use.setAttribute('width', h.w);
        use.setAttribute('height', h.h);
        use.setAttribute('fill', ink);
        use.setAttribute('opacity', '0.12');
        svg.appendChild(use);
    });

    // River — bold wavy blue-grey path with tributary
    const river = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    river.setAttribute('d', 'M-10,180 C100,160 180,260 320,230 S480,310 620,270 S800,340 900,290 S1050,360 1150,310 S1250,370 1320,340');
    river.setAttribute('fill', 'none');
    river.setAttribute('stroke', '#6A7F90');
    river.setAttribute('stroke-width', '5');
    river.setAttribute('opacity', '0.3');
    river.setAttribute('stroke-linecap', 'round');
    svg.appendChild(river);

    // River highlight (lighter inner line)
    const riverHL = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    riverHL.setAttribute('d', 'M-10,180 C100,160 180,260 320,230 S480,310 620,270 S800,340 900,290 S1050,360 1150,310 S1250,370 1320,340');
    riverHL.setAttribute('fill', 'none');
    riverHL.setAttribute('stroke', '#8A9FAF');
    riverHL.setAttribute('stroke-width', '2');
    riverHL.setAttribute('opacity', '0.2');
    riverHL.setAttribute('stroke-linecap', 'round');
    svg.appendChild(riverHL);

    // Tributary stream joining from upper-right
    const trib = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trib.setAttribute('d', 'M1100,60 C1050,100 980,150 900,290');
    trib.setAttribute('fill', 'none');
    trib.setAttribute('stroke', '#6A7F90');
    trib.setAttribute('stroke-width', '2.5');
    trib.setAttribute('opacity', '0.2');
    trib.setAttribute('stroke-linecap', 'round');
    svg.appendChild(trib);

    main.insertBefore(svg, main.firstChild);
}

// ===== Rendering =====

function render() {
    const delibs = state.deliberations;
    const ids = Object.keys(delibs);

    // Multi-view: render all deliberations spatially when in multi-watch mode
    if (state.multiView && ids.length > 1) {
        document.getElementById('delib-nav')?.classList.add('hidden');
        document.getElementById('empty-state')?.classList.add('hidden');

        // Update header for multi-view
        const focused = state.focusedDelibID && delibs[state.focusedDelibID];
        const topicEl = document.querySelector('.topic-label');
        if (focused) {
            topicEl.textContent = focused.deliberation?.topic || 'UNTITLED';
            // Show footer with focused deliberation's detail
            document.getElementById('footer')?.classList.remove('hidden');
            document.getElementById('analysis-bar')?.classList.remove('hidden');
            document.getElementById('scrubber-bar')?.classList.remove('hidden');
            renderHeader(focused);
            renderAnalysisBar(focused);
            renderCruxPanel(focused);
            renderMetrics(focused);
            renderAuditLog(focused);
            renderScrubber(focused);
        } else {
            topicEl.textContent = `${ids.length} Deliberations`;
            document.getElementById('footer')?.classList.add('hidden');
            document.getElementById('analysis-bar')?.classList.add('hidden');
            document.getElementById('scrubber-bar')?.classList.add('hidden');
        }

        renderMultiView();
        // Start demo loop if not already running and cycle is enabled
        if (!demoLoopTimer && state.cycleInterval > 0) {
            startDemoLoop();
        }
        return;
    }

    // Leaving multi-view: restore single-view DOM
    const multiCanvas = document.getElementById('multi-canvas');
    if (multiCanvas) multiCanvas.remove();
    document.getElementById('main').className = '';
    document.getElementById('footer')?.classList.remove('hidden');
    document.getElementById('analysis-bar')?.classList.remove('hidden');

    renderDelibNav(ids, delibs);

    const active = delibs[state.activeDelibID];
    const emptyEl = document.getElementById('empty-state');
    if (!active) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        document.getElementById('agents')?.classList.add('hidden');
        document.getElementById('connections')?.classList.add('hidden');
        document.getElementById('center-panel')?.classList.add('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    document.getElementById('agents')?.classList.remove('hidden');
    document.getElementById('connections')?.classList.remove('hidden');

    // Render terrain decorations (classic theme, once)
    renderTerrain();

    // Apply scrubber time filter if active
    let display = active;
    if (scrubber.enabled && scrubber.eventIndex != null) {
        const cutoff = scrubber.events[scrubber.eventIndex]?.time;
        if (cutoff) display = filterToTime(active, cutoff);
    }

    renderHeader(display);
    renderAnalysisBar(display);
    renderAgents(display);
    renderConnections(display);
    renderCenterPanel(display);
    renderCruxPanel(display);
    renderMetrics(display);
    renderAuditLog(display);
    renderScrubber(active); // always pass full state for timeline dots
}

function renderDelibNav(ids, delibs) {
    const nav = document.getElementById('delib-nav');
    const list = document.getElementById('delib-list');

    if (ids.length <= 1) {
        nav.classList.add('hidden');
        return;
    }

    nav.classList.remove('hidden');
    clearChildren(list);

    ids.forEach(id => {
        const d = delibs[id].deliberation;
        const btn = el('button', {
            className: `delib-tab ${id === state.activeDelibID ? 'active' : ''} ${d.status === 'analyzing' ? 'analyzing' : ''}`,
            dataset: { id },
        }, truncate(d.topic || id, 30));
        btn.onclick = () => {
            switchToDelib(id);
            state.cyclePaused = true; // manual click pauses auto-cycle
            render();
            // Resume cycling after 60s of no interaction
            clearTimeout(cycleProgressTimer);
            cycleProgressTimer = setTimeout(() => {
                state.cyclePaused = false;
                resetCycleProgress();
            }, 60000);
        };
        list.appendChild(btn);
    });
}

function renderHeader(ds) {
    const d = ds.deliberation;
    const screen = document.getElementById('screen');

    document.querySelector('.topic-label').textContent = d.topic || 'UNTITLED';
    document.getElementById('round-display').textContent = `ROUND ${d.round_number}`;
    document.getElementById('template-display').textContent = d.template || d.type || '--';

    // Set scan speed state — drives CSS variable for scan sweep animation
    screen.dataset.state = d.status === 'analyzing' ? 'analyzing' : 'normal';

    // Emergency mode: integrity warnings collapse green/cyan to red
    const hasWarnings = (ds.analysis?.integrity_warnings || []).length > 0;
    screen.classList.toggle('emergency-mode', hasWarnings);

    const status = document.getElementById('connection-status');
    if (d.status === 'analyzing') {
        status.textContent = STATUS.analyzing;
        status.className = 'status-indicator analyzing';
    } else if (state.connected) {
        status.textContent = d.status === 'closed' ? STATUS.closed : STATUS.online;
        status.className = 'status-indicator online';
    } else {
        status.textContent = STATUS.offline;
        status.className = 'status-indicator offline';
    }
}

function renderAnalysisBar(ds) {
    const bar = document.getElementById('analysis-bar');
    const d = ds.deliberation;

    if (d.status !== 'analyzing' || !d.sub_status) {
        bar.classList.add('hidden');
        return;
    }

    bar.classList.remove('hidden');

    const currentIdx = PIPELINE_STAGES.indexOf(d.sub_status);
    document.querySelectorAll('.pipeline-stage').forEach(stage => {
        const stageIdx = PIPELINE_STAGES.indexOf(stage.dataset.stage);
        stage.classList.remove('active', 'done');
        if (stageIdx < currentIdx) stage.classList.add('done');
        else if (stageIdx === currentIdx) stage.classList.add('active');
    });
}

function renderAgents(ds) {
    const container = document.getElementById('agents');
    const agents = ds.agents || [];
    const n = agents.length;

    const main = document.getElementById('main');
    main.className = '';

    // Check if agents have explicit positions (map/geo layout)
    const hasPositions = agents.some(a => a.x != null && a.y != null);

    if (n <= 0) {
        clearChildren(container);
        return;
    } else if (hasPositions) {
        main.classList.add('layout-positioned');
    } else if (n === 2) {
        main.classList.add('layout-bilateral');
    } else if (n === 3) {
        main.classList.add('layout-triangle');
    } else if (n <= 7) {
        main.classList.add('layout-polygon');
    } else {
        main.classList.add('layout-grid');
    }

    const voteMap = buildVoteMap(ds);
    const trustWeights = ds.analysis?.trust_weights || {};
    const integrityWarnings = ds.analysis?.integrity_warnings || [];

    clearChildren(container);

    // Build position lookup for tooltips
    const positionsByAgent = {};
    (ds.positions || []).forEach(p => {
        if (!positionsByAgent[p.agent_id]) positionsByAgent[p.agent_id] = [];
        positionsByAgent[p.agent_id].push(p);
    });

    agents.forEach((agent, i) => {
        const name = shortAgentID(agent.id);
        const vote = voteMap[agent.id];
        const voteLabel = vote !== undefined ? VOTE_LABELS[vote] : '--';
        const voteClass = vote !== undefined ? VOTE_CLASSES[vote] : 'vote-pass';

        const conviction = agent.conviction || 0.5;
        const convClass = conviction > 0.7 ? 'conviction-high' : conviction > 0.3 ? 'conviction-med' : 'conviction-low';

        const clusterClass = agent.cluster_id != null
            ? CLUSTER_COLORS[agent.cluster_id % CLUSTER_COLORS.length] : '';

        const trust = trustWeights[agent.id] || 1;
        const trustClass = trust > 0.8 ? 'trust-high' : trust > 0.4 ? 'trust-med' : 'trust-low';

        const hasWarning = integrityWarnings.some(w => w.toLowerCase().includes(agent.id.toLowerCase()));
        const warningClass = hasWarning ? 'integrity-warning' : '';

        let style = '';
        if (hasPositions && agent.x != null && agent.y != null) {
            style = `left: ${agent.x}%; top: ${agent.y}%;`;
        } else if (n > 3 && n <= 7) {
            const pos = polygonPosition(i, n);
            style = `left: ${pos.x}%; top: ${pos.y}%;`;
        }

        // Build tooltip with position content
        const agentPositions = positionsByAgent[agent.id] || [];
        const tooltipContent = agentPositions.length > 0
            ? agentPositions.map(p => truncate(p.content, 150)).join('\n---\n')
            : 'No position submitted';

        const tooltip = el('div', { className: 'agent-tooltip' },
            el('div', { className: 'tooltip-header' },
                el('span', {}, agent.id),
                el('span', { className: 'tooltip-model' }, agent.model_family || ''),
            ),
            el('div', { className: 'tooltip-body' }, tooltipContent),
            el('div', { className: 'tooltip-footer' },
                el('span', {}, `CONVICTION: ${(conviction * 100).toFixed(0)}%`),
                trust < 1 ? el('span', { className: 'tooltip-trust' }, `TRUST: ${(trust * 100).toFixed(0)}%`) : null,
            ),
        );

        // Detect new agents and vote changes for animations
        const isNew = !knownAgents.has(agent.id);
        const prevVote = previousVotes[agent.id];
        const voteChanged = prevVote !== undefined && prevVote !== vote;
        const animClass = isNew ? ' entering' : (voteChanged ? ' vote-changed' : '');

        knownAgents.add(agent.id);
        previousVotes[agent.id] = vote;

        const node = el('div', {
            className: `agent-node ${trustClass} ${warningClass}${animClass}`,
            style,
        },
            el('div', { className: `diamond ${convClass} ${clusterClass}` },
                // Classic theme: render SVG settlement icon inside diamond
                activeTheme === 'classic' ? (() => {
                    const icons = ['gi-castle', 'gi-village'];
                    const iconId = icons[i % icons.length];
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svg.setAttribute('viewBox', '0 0 512 512');
                    svg.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;';
                    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                    use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + iconId);
                    use.setAttribute('fill', '#3B2F20');
                    use.setAttribute('fill-rule', 'evenodd');
                    svg.appendChild(use);
                    return svg;
                })() : null,
            ),
            el('div', { className: 'diamond-vote' },
                el('span', { className: `agent-vote ${voteClass}` }, voteLabel),
            ),
            el('div', { className: 'agent-label' },
                el('span', { className: 'agent-name' }, name),
                el('span', { className: 'agent-model' }, agent.model_family || '?'),
            ),
            tooltip,
        );

        // Remove animation class after it plays so it can re-trigger
        if (animClass) {
            node.addEventListener('animationend', () => {
                node.classList.remove('entering', 'vote-changed');
            }, { once: true });
        }

        container.appendChild(node);
    });
}

// Create a slightly wavy SVG path between two points (hand-drawn road effect).
// Seed makes the waviness stable across re-renders for the same agent pair.
function createRoadPath(x1, y1, x2, y2, seed) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    // Perpendicular unit vector
    const px = -dy / len, py = dx / len;
    // Seeded pseudo-random offsets (deterministic per pair)
    const r1 = ((seed * 7919 + 1) % 97) / 97 - 0.5; // -0.5..0.5
    const r2 = ((seed * 6271 + 3) % 89) / 89 - 0.5;
    const wobble = Math.min(len * 0.4, 80); // dramatically winding medieval roads
    // Two control points at 1/3 and 2/3 along the line, offset perpendicular
    const cx1 = x1 + dx * 0.33 + px * r1 * wobble;
    const cy1 = y1 + dy * 0.33 + py * r1 * wobble;
    const cx2 = x1 + dx * 0.66 + px * r2 * wobble;
    const cy2 = y1 + dy * 0.66 + py * r2 * wobble;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`);
    return path;
}

function renderConnections(ds) {
    const svg = document.getElementById('connections');
    const agents = ds.agents || [];
    const n = agents.length;

    // Clear existing lines
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const hasPositions = agents.some(a => a.x != null && a.y != null);
    if (n < 2 || (!hasPositions && n > 7)) return;

    const main = document.getElementById('main');
    const rect = main.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);

    const positions = [];
    if (hasPositions) {
        agents.forEach(a => {
            positions.push({ x: (a.x || 50) / 100, y: (a.y || 50) / 100 });
        });
    } else if (n === 2) {
        positions.push({ x: 0.30, y: 0.45 }, { x: 0.70, y: 0.45 });
    } else if (n === 3) {
        positions.push({ x: 0.50, y: 0.26 }, { x: 0.25, y: 0.68 }, { x: 0.75, y: 0.68 });
    } else {
        agents.forEach((_, i) => {
            const p = polygonPosition(i, n);
            positions.push({ x: p.x / 100, y: p.y / 100 });
        });
    }

    const pairScores = buildPairwiseRelationship(ds);

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const key = `${agents[i].id}|${agents[j].id}`;
            const rel = pairScores[key] || 'neutral';
            const x1 = positions[i].x * rect.width;
            const y1 = positions[i].y * rect.height;
            const x2 = positions[j].x * rect.width;
            const y2 = positions[j].y * rect.height;
            if (activeTheme === 'classic') {
                // Wavy bezier road path with waypoint dot
                const road = createRoadPath(x1, y1, x2, y2, i * n + j);
                road.setAttribute('class', `connection-line connection-${rel}`);
                svg.appendChild(road);

                if (rel !== 'neutral') {
                    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    dot.setAttribute('cx', (x1 + x2) / 2);
                    dot.setAttribute('cy', (y1 + y2) / 2);
                    dot.setAttribute('r', '2.5');
                    dot.setAttribute('class', 'road-waypoint');
                    svg.appendChild(dot);
                }
            } else if (activeTheme === 'gastown') {
                // Industrial pipe: thick outer + thin inner highlight
                const pipe = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                pipe.setAttribute('x1', x1); pipe.setAttribute('y1', y1);
                pipe.setAttribute('x2', x2); pipe.setAttribute('y2', y2);
                pipe.setAttribute('class', `connection-line connection-${rel}`);
                svg.appendChild(pipe);

                // Inner highlight (lighter, thinner)
                if (rel !== 'neutral') {
                    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    inner.setAttribute('x1', x1); inner.setAttribute('y1', y1);
                    inner.setAttribute('x2', x2); inner.setAttribute('y2', y2);
                    inner.setAttribute('class', 'pipe-inner');
                    svg.appendChild(inner);
                }

                // Pipe joint circles at endpoints
                for (const [px, py] of [[x1, y1], [x2, y2]]) {
                    const joint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    joint.setAttribute('cx', px); joint.setAttribute('cy', py);
                    joint.setAttribute('r', '4');
                    joint.setAttribute('class', 'pipe-joint');
                    svg.appendChild(joint);
                }
            } else {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x1);
                line.setAttribute('y1', y1);
                line.setAttribute('x2', x2);
                line.setAttribute('y2', y2);
                line.setAttribute('class', `connection-line connection-${rel}`);
                svg.appendChild(line);
            }
        }
    }
}

function renderCenterPanel(ds) {
    const panel = document.getElementById('center-panel');
    const content = document.getElementById('center-content');
    const analysis = ds.analysis;

    if (!analysis) {
        panel.classList.add('hidden');
        return;
    }

    const consensus = analysis.consensus_statements || [];
    const bridging = analysis.bridging_statements || [];

    if (consensus.length === 0 && bridging.length === 0 && !analysis.compromise_proposal) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');
    clearChildren(content);

    if (consensus.length > 0) {
        content.appendChild(el('div', { className: 'panel-label panel-label-consensus' }, 'CONSENSUS'));
        consensus.forEach(c => {
            content.appendChild(el('div', { className: 'panel-text' }, truncate(c.content, 120)));
        });
    }
    if (bridging.length > 0) {
        content.appendChild(el('div', { className: 'panel-label panel-label-bridging' }, 'BRIDGING'));
        bridging.forEach(b => {
            const pct = b.bridging_score != null ? `${(b.bridging_score * 100).toFixed(0)}%` : '';
            const score = el('span', { className: 'text-dim' }, pct ? ` (${pct})` : '');
            const div = el('div', { className: 'panel-text' }, truncate(b.content, 100));
            div.appendChild(score);
            content.appendChild(div);
        });
    }
    if (analysis.compromise_proposal) {
        content.appendChild(el('div', { className: 'panel-label panel-label-compromise' }, 'COMPROMISE'));
        content.appendChild(el('div', { className: 'panel-text' }, truncate(analysis.compromise_proposal, 200)));
    }
}

function renderCruxPanel(ds) {
    const list = document.getElementById('crux-list');
    const cruxes = ds.analysis?.cruxes || [];
    clearChildren(list);

    if (cruxes.length === 0) {
        list.appendChild(el('div', { className: 'empty-message' }, 'NO CRUXES DETECTED'));
        return;
    }

    cruxes.forEach(c => {
        const controversyFill = el('span', {
            className: 'controversy-fill',
            style: `width:${((c.controversy_score || 0) * 100)}%`,
        });
        const controversyBar = el('span', { className: 'controversy-bar' }, controversyFill);

        const meta = el('div', { className: 'crux-meta' },
            el('span', {}, c.crux_type || 'mixed'),
            el('span', {}, ''),
            el('span', { className: 'crux-agree' }, `+${(c.agree_agents || []).length}`),
            el('span', { className: 'crux-disagree' }, `-${(c.disagree_agents || []).length}`),
        );
        // Insert controversy bar after type
        meta.children[1].appendChild(controversyBar);
        meta.children[1].appendChild(document.createTextNode(` ${((c.controversy_score || 0) * 100).toFixed(0)}%`));

        const item = el('div', { className: 'crux-item' },
            el('div', { className: 'crux-claim' }, truncate(c.crux_claim, 80)),
            meta,
        );
        list.appendChild(item);
    });
}

function renderMetrics(ds) {
    const grid = document.getElementById('metrics-content');
    const a = ds.analysis;
    clearChildren(grid);

    const metrics = [
        { value: String((ds.agents || []).length), label: 'AGENTS' },
        { value: String((ds.positions || []).length), label: 'POSITIONS' },
        { value: String((ds.votes || []).length), label: 'VOTES' },
        { value: a ? String((a.cruxes || []).length) : '--', label: 'CRUXES' },
        { value: a?.participation_rate != null ? `${(a.participation_rate * 100).toFixed(0)}%` : '--', label: 'PARTICIPATION' },
        { value: a?.perspective_diversity != null ? `${(a.perspective_diversity * 100).toFixed(0)}%` : '--', label: 'DIVERSITY' },
    ];

    metrics.forEach(m => {
        grid.appendChild(el('div', { className: 'metric' },
            el('div', { className: 'metric-value' }, m.value),
            el('div', { className: 'metric-label' }, m.label),
        ));
    });
}

function renderAuditLog(ds) {
    const log = document.getElementById('audit-log');
    const ops = ds.audit_log?.operations || [];
    const prevCount = log.children.length;
    clearChildren(log);

    if (ops.length === 0) {
        log.appendChild(el('div', { className: 'empty-message' }, 'NO EVENTS'));
        return;
    }

    const isFirstRender = prevCount === 0;
    ops.slice(0, 30).forEach((op, i) => {
        // Cascade animation: new entries type in sequentially
        const cascadeClass = isFirstRender && i < 5 ? ` new cascade-${i + 1}` : '';
        const entry = el('div', { className: `audit-entry${cascadeClass}` },
            el('span', { className: 'timestamp' }, formatTime(op.timestamp)),
            el('span', { className: 'method' }, op.method || ''),
            document.createTextNode(' '),
            el('span', { className: 'agent' }, shortAgentID(op.agent_id || '')),
        );
        log.appendChild(entry);
    });
}

// ===== Helpers =====

function shortAgentID(id) {
    if (!id) return '?';
    const parts = id.split(':');
    const name = parts[parts.length - 1];
    return name.length > 18 ? name.slice(0, 16) + '..' : name;
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '...' : s;
}

function formatTime(ts) {
    if (!ts) return '--:--';
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return ts;
    }
}

function polygonPosition(i, n) {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    // Scale radius with agent count to reduce overlap
    const rx = n <= 4 ? 30 : n <= 5 ? 34 : 38;
    const ry = n <= 4 ? 28 : n <= 5 ? 32 : 36;
    return {
        x: 50 + rx * Math.cos(angle),
        y: 46 + ry * Math.sin(angle),
    };
}

function buildVoteMap(ds) {
    const votes = ds.votes || [];
    const agentVotes = {};

    votes.forEach(v => {
        if (!agentVotes[v.agent_id]) agentVotes[v.agent_id] = [];
        agentVotes[v.agent_id].push(v.value);
    });

    const result = {};
    for (const [agent, vals] of Object.entries(agentVotes)) {
        const sum = vals.reduce((a, b) => a + b, 0);
        result[agent] = sum > 0 ? 1 : sum < 0 ? -1 : 0;
    }
    return result;
}

function buildPairwiseRelationship(ds) {
    const votes = ds.votes || [];
    const byPosition = {};

    votes.forEach(v => {
        if (!byPosition[v.position_id]) byPosition[v.position_id] = {};
        byPosition[v.position_id][v.agent_id] = v.value;
    });

    const agents = (ds.agents || []).map(a => a.id);
    const pairScores = {};

    for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
            let agree = 0, disagree = 0;
            for (const posVotes of Object.values(byPosition)) {
                const vi = posVotes[agents[i]];
                const vj = posVotes[agents[j]];
                if (vi !== undefined && vj !== undefined) {
                    if (vi === vj) agree++;
                    else if (vi === -vj) disagree++;
                }
            }
            const key = `${agents[i]}|${agents[j]}`;
            if (agree > disagree) pairScores[key] = 'agree';
            else if (disagree > agree) pairScores[key] = 'disagree';
            else pairScores[key] = 'neutral';
        }
    }

    return pairScores;
}

// ===== Multi-View Spatial Viewport =====

const OVERVIEW_RETURN_DELAY = 8000; // ms before returning to overview
const FOCUS_TRANSITION_MS = 800;

// Compute layout positions for multiple deliberations on the canvas.
// Returns { [delibID]: { x, y, w, h } } in percentage coordinates.
function computeCanvasLayout(delibIDs) {
    const n = delibIDs.length;
    if (n <= 1) return {};

    const regions = {};

    // Grid layout: compute rows/cols
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = 100 / cols;
    const cellH = 100 / rows;
    const pad = 2; // padding in percent

    delibIDs.forEach((id, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        regions[id] = {
            x: col * cellW + pad,
            y: row * cellH + pad,
            w: cellW - pad * 2,
            h: cellH - pad * 2,
        };
    });

    return regions;
}

// Render all deliberations simultaneously on a spatial canvas.
function renderMultiView() {
    const delibs = state.deliberations;
    const ids = Object.keys(delibs);
    if (ids.length <= 1) return;

    const main = document.getElementById('main');
    main.className = 'multi-view';

    // Hide single-view elements, show multi-view canvas
    document.getElementById('agents')?.classList.add('hidden');
    document.getElementById('connections')?.classList.add('hidden');
    document.getElementById('center-panel')?.classList.add('hidden');
    document.getElementById('scrubber-bar')?.classList.add('hidden');

    let canvas = document.getElementById('multi-canvas');
    if (!canvas) {
        canvas = el('div', { className: 'multi-canvas', id: 'multi-canvas' });
        main.appendChild(canvas);
    }

    const regions = computeCanvasLayout(ids);
    clearChildren(canvas);

    ids.forEach(id => {
        const ds = delibs[id];
        const region = regions[id];
        if (!ds || !region) return;

        const d = ds.deliberation;
        const agents = ds.agents || [];
        const n = agents.length;
        const voteMap = buildVoteMap(ds);
        const isActive = state.focusedDelibID === id;
        const hasRecentActivity = state.lastActivity[id] && (Date.now() - state.lastActivity[id] < 5000);

        // Region container
        const regionEl = el('div', {
            className: `multi-region ${isActive ? 'focused' : ''} ${hasRecentActivity ? 'active-pulse' : ''}`,
            style: `left:${region.x}%; top:${region.y}%; width:${region.w}%; height:${region.h}%;`,
            dataset: { delibId: id },
        });

        // Title bar
        regionEl.appendChild(el('div', { className: 'multi-region-title' },
            el('span', { className: 'multi-region-topic' }, truncate(d.topic, 40)),
            el('span', { className: 'multi-region-meta' },
                `${n} AGENTS · R${d.round_number} · ${(d.template || d.type || '').toUpperCase()}`),
        ));

        // Mini agent visualization
        const agentArea = el('div', { className: 'multi-region-agents' });

        // SVG connections
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'multi-region-connections');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');

        // Compute positions for agents within this region
        const agentPositions = [];
        const hasGeoPositions = agents.some(a => a.x != null && a.y != null);

        agents.forEach((agent, i) => {
            let ax, ay;
            if (hasGeoPositions && agent.x != null && agent.y != null) {
                ax = agent.x;
                ay = agent.y;
            } else if (n === 2) {
                ax = i === 0 ? 30 : 70;
                ay = 50;
            } else if (n === 3) {
                const positions3 = [{ x: 50, y: 20 }, { x: 25, y: 70 }, { x: 75, y: 70 }];
                ax = positions3[i].x;
                ay = positions3[i].y;
            } else {
                const angle = (2 * Math.PI * i / n) - Math.PI / 2;
                ax = 50 + 30 * Math.cos(angle);
                ay = 50 + 30 * Math.sin(angle);
            }
            agentPositions.push({ x: ax, y: ay });

            const vote = voteMap[agent.id];
            const voteClass = vote !== undefined ? VOTE_CLASSES[vote] : 'vote-pass';
            const clusterClass = agent.cluster_id != null
                ? CLUSTER_COLORS[agent.cluster_id % CLUSTER_COLORS.length] : '';

            const node = el('div', {
                className: `multi-agent ${clusterClass}`,
                style: `left:${ax}%; top:${ay}%;`,
                title: agent.id,
            },
                el('span', { className: `multi-agent-vote ${voteClass}` },
                    vote !== undefined ? VOTE_LABELS[vote] : '--'),
                el('span', { className: 'multi-agent-name' }, shortAgentID(agent.id)),
            );
            agentArea.appendChild(node);
        });

        // Draw connections
        const pairScores = buildPairwiseRelationship(ds);
        for (let i = 0; i < agents.length; i++) {
            for (let j = i + 1; j < agents.length; j++) {
                const key = `${agents[i].id}|${agents[j].id}`;
                const rel = pairScores[key] || 'neutral';
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', agentPositions[i].x);
                line.setAttribute('y1', agentPositions[i].y);
                line.setAttribute('x2', agentPositions[j].x);
                line.setAttribute('y2', agentPositions[j].y);
                line.setAttribute('class', `connection-line connection-${rel}`);
                svg.appendChild(line);
            }
        }

        agentArea.appendChild(svg);
        regionEl.appendChild(agentArea);

        // Status indicator
        if (d.status === 'analyzing') {
            regionEl.appendChild(el('div', { className: 'multi-region-status analyzing' }, STATUS.analyzing));
        }

        // Crux count
        const cruxCount = (ds.analysis?.cruxes || []).length;
        if (cruxCount > 0) {
            regionEl.appendChild(el('div', { className: 'multi-region-status' }, `${cruxCount} CRUXES`));
        }

        // Click handled via delegation on #main (see below)

        canvas.appendChild(regionEl);
    });

    // Apply camera after rendering
    updateCamera();
}

function applyCameraFocus(canvas, region) {
    const parent = canvas.parentElement;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;

    // Region in pixel coords
    const rx = (region.x / 100) * pw;
    const ry = (region.y / 100) * ph;
    const rw = (region.w / 100) * pw;
    const rh = (region.h / 100) * ph;

    // Scale to fill ~85% of viewport
    const scale = Math.min(pw / rw, ph / rh) * 0.85;

    // Translate so region center aligns with viewport center
    const rcx = rx + rw / 2;
    const rcy = ry + rh / 2;
    const tx = pw / 2 - rcx * scale;
    const ty = ph / 2 - rcy * scale;

    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function focusOnDelib(delibID) {
    state.focusedDelibID = delibID;

    // Flash the scan sweep
    const screen = document.getElementById('screen');
    screen.dataset.state = 'focusing';
    setTimeout(() => {
        const active = state.deliberations[state.activeDelibID];
        screen.dataset.state = active?.deliberation?.status === 'analyzing' ? 'analyzing' : 'normal';
    }, FOCUS_TRANSITION_MS);

    // Apply camera and update detail panels for focused deliberation
    updateCamera();
    render(); // re-render to populate footer with focused delib's data

    // Set timer to return to overview
    clearTimeout(focusTimer);
    focusTimer = setTimeout(zoomToOverview, OVERVIEW_RETURN_DELAY);
}

function zoomToOverview() {
    state.focusedDelibID = null;
    updateCamera();
    // Clear focused highlight from all regions
    document.querySelectorAll('.multi-region.focused').forEach(r => r.classList.remove('focused'));
    render(); // re-render to hide footer and update header
}

function updateCamera() {
    const canvas = document.getElementById('multi-canvas');
    if (!canvas) return;

    const ids = Object.keys(state.deliberations);
    const regions = computeCanvasLayout(ids);

    canvas.querySelectorAll('.multi-region').forEach(r => {
        const id = r.dataset.delibId;
        r.classList.toggle('focused', id === state.focusedDelibID);
    });

    if (state.focusedDelibID && regions[state.focusedDelibID]) {
        applyCameraFocus(canvas, regions[state.focusedDelibID]);
    } else {
        canvas.style.transform = '';
    }
}

// Called when an SSE event indicates activity in a deliberation
function onActivity(delibID) {
    if (!state.multiView) return;
    state.lastActivity[delibID] = Date.now();

    // Don't interrupt if user manually focused (click)
    if (state.cyclePaused) return;

    // Stop demo loop while we focus on real activity
    stopDemoLoop();
    focusOnDelib(delibID);
}

// ===== Demo Loop (multi-view) =====
// Cycles focus through each deliberation, then overview, in a loop.
// Used for ambient display / conference demo mode.

let demoLoopTimer = null;
let demoLoopIndex = 0;

function startDemoLoop() {
    if (!state.multiView || state.cycleInterval <= 0) return;

    const ids = Object.keys(state.deliberations);
    if (ids.length <= 1) return;

    // Sequence: overview, delib1, overview, delib2, overview, delib3, ...
    // Each step gets cycleInterval ms
    function step() {
        if (state.cyclePaused) return;

        const ids = Object.keys(state.deliberations);
        const totalSteps = ids.length * 2; // zoom + overview for each
        const stepInCycle = demoLoopIndex % totalSteps;

        if (stepInCycle % 2 === 0) {
            // Zoom into a deliberation
            const delibIdx = Math.floor(stepInCycle / 2);
            focusOnDelib(ids[delibIdx]);
            // Override the auto-zoom-out timer — the loop handles timing
            clearTimeout(focusTimer);
        } else {
            // Return to overview
            zoomToOverview();
        }

        demoLoopIndex++;
        demoLoopTimer = setTimeout(step, state.cycleInterval);
    }

    // Start with overview, first step after one interval
    zoomToOverview();
    demoLoopTimer = setTimeout(step, state.cycleInterval);
}

function stopDemoLoop() {
    clearTimeout(demoLoopTimer);
    demoLoopTimer = null;
}

function updateConnectionStatus() {
    const status = document.getElementById('connection-status');
    if (state.connected) {
        status.textContent = STATUS.online;
        status.className = 'status-indicator online';
    } else {
        status.textContent = STATUS.offline;
        status.className = 'status-indicator offline';
    }
}

// ===== Watch Mode (join codes) =====

function getWatchCodes() {
    const match = window.location.pathname.match(/^\/watch\/([a-z0-9-]+)\/?$/);
    if (!match) return [];
    const codes = [match[1]];
    // Additional codes via ?also= param
    const also = new URLSearchParams(window.location.search).get('also');
    if (also) {
        also.split(',').forEach(c => {
            const trimmed = c.trim();
            if (/^[a-z0-9-]{5,100}$/.test(trimmed)) codes.push(trimmed);
        });
    }
    return codes;
}

// ===== Group Mode (shared link viewing) =====

function getGroupID() {
    const match = window.location.pathname.match(/^\/g\/([a-zA-Z0-9_-]{5,200})\/?$/);
    return match ? match[1] : null;
}

function connectGroup(groupID) {
    state.multiView = true;
    if (eventSource) eventSource.close();

    fetch(`/api/g/${groupID}/state`)
        .then(r => {
            if (!r.ok) throw new Error(`Group not found (${r.status})`);
            return r.json();
        })
        .then(snap => {
            state.deliberations = snap.deliberations || {};
            render();
        })
        .catch(err => {
            console.error('Group fetch error:', err);
            const main = document.getElementById('main');
            if (main) main.textContent = `Group not found: ${groupID}`;
        });

    eventSource = new EventSource(`/api/g/${groupID}/events`);
    eventSource.onopen = () => { state.connected = true; updateConnectionStatus(); };
    eventSource.onerror = () => { state.connected = false; updateConnectionStatus(); };
    eventSource.onmessage = (e) => {
        try { handleEvent(JSON.parse(e.data)); } catch (_) { /* ignore */ }
    };

    const sysLabel = document.querySelector('.system-label');
    if (sysLabel) sysLabel.textContent = `GROUP: ${groupID.substring(0, 20)}`;
}

// ===== Dashboard Mode =====

function isDashboard() {
    return window.location.pathname.startsWith('/dashboard');
}

function showLoginForm() {
    const main = document.getElementById('main');
    // Hide persistent elements instead of destroying them
    document.getElementById('agents')?.classList.add('hidden');
    document.getElementById('connections')?.classList.add('hidden');
    document.getElementById('center-panel')?.classList.add('hidden');
    document.getElementById('empty-state')?.classList.add('hidden');
    document.getElementById('scrubber-bar')?.classList.add('hidden');
    // Remove any previous login form
    document.getElementById('login-form-container')?.remove();

    const form = el('div', { className: 'login-form', id: 'login-form-container' },
        el('div', { className: 'login-title' }, 'AGENT DASHBOARD'),
        el('div', { className: 'login-subtitle' }, 'ENTER YOUR GEMOT.DEV API KEY TO MONITOR YOUR DELIBERATIONS'),
        el('input', {
            className: 'login-input',
            type: 'password',
            placeholder: 'gmt_...',
            id: 'api-key-input',
        }),
        el('button', {
            className: 'login-button',
            id: 'login-btn',
        }, 'CONNECT'),
        el('div', { className: 'login-error', id: 'login-error' }),
    );

    main.appendChild(form);

    const input = document.getElementById('api-key-input');
    const btn = document.getElementById('login-btn');
    const errDiv = document.getElementById('login-error');

    async function doLogin() {
        const key = input.value.trim();
        if (!key) return;
        btn.textContent = 'CONNECTING...';
        errDiv.textContent = '';
        try {
            const resp = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: key }),
            });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(text || 'Authentication failed');
            }
            // Session cookie is set by server. Connect to dashboard SSE.
            connectDashboard();
        } catch (e) {
            errDiv.textContent = e.message.toUpperCase();
            btn.textContent = 'CONNECT';
        }
    }

    btn.onclick = doLogin;
    input.onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
    input.focus();
}

function connectDashboard() {
    if (eventSource) eventSource.close();

    // Remove login form, restore visualization elements
    document.getElementById('login-form-container')?.remove();

    const sysLabel = document.querySelector('.system-label');
    if (sysLabel) sysLabel.textContent = 'DASHBOARD';

    eventSource = new EventSource('/api/dashboard/events');

    eventSource.onopen = () => {
        state.connected = true;
        updateConnectionStatus();
    };

    eventSource.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            handleEvent(msg);
        } catch (err) {
            console.error('SSE parse error:', err);
        }
    };

    eventSource.onerror = () => {
        state.connected = false;
        updateConnectionStatus();
        // If we get a 401, show login form again
        if (eventSource.readyState === EventSource.CLOSED) {
            showLoginForm();
        }
    };
}

// ===== Theme =====

const VALID_THEMES = ['classic', 'magi', 'minimal', 'gastown'];

function applyTheme() {
    const params = new URLSearchParams(window.location.search);
    const theme = params.get('theme');
    const screen = document.getElementById('screen');
    const active = (theme && VALID_THEMES.includes(theme)) ? theme : 'classic';

    // Apply theme class to #screen and body (body class for boot overlay styling)
    screen.classList.add(`theme-${active}`);
    document.body.classList.add(`boot-${active}`);

    VOTE_LABELS = active === 'magi' ? VOTE_LABELS_MAGI
                : active === 'minimal' ? VOTE_LABELS_MINIMAL
                : VOTE_LABELS_CLASSIC; // classic and gastown both use YEA/NAY
    STATUS = STATUS_LABELS[active] || STATUS_LABELS.classic;

    // Load web fonts per theme
    if (active === 'classic' || !theme) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=Cinzel:wght@400;700;900&display=swap';
        document.head.appendChild(link);
    } else if (active === 'gastown') {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Crimson+Text:ital@0;1&display=swap';
        document.head.appendChild(link);
    }

    // Populate boot overlay per theme
    const boot = document.getElementById('boot');
    if (boot) {
        const BOOT_CONTENT = {
            magi: [
                'NERV SYSTEMS INTERFACE v3.1',
                'LOADING MAGI CORE...',
                'MELCHIOR-1 / BALTHASAR-2 / CASPER-3',
                'DELIBERATION ENGINE: ONLINE',
                'SSE LINK: ESTABLISHED',
                'GEMOT READY',
            ],
            classic: [
                '\u2726',
                'Gemot',
                'Deliberation Monitor',
            ],
            minimal: [
                'Gemot',
            ],
            gastown: [
                '-- GEMOT --',
                'WASTELAND DISPATCH',
                'DELIBERATION ENGINE ONLINE',
            ],
        };
        const lines = BOOT_CONTENT[active] || BOOT_CONTENT.classic;
        lines.forEach(text => {
            const div = document.createElement('div');
            div.className = 'boot-text';
            div.textContent = text;
            boot.appendChild(div);
        });
    }

    return active;
}

const activeTheme = applyTheme();

// Update page title per theme
if (activeTheme === 'magi') {
    document.title = 'GEMOT // MAGI';
} else if (activeTheme === 'gastown') {
    document.title = 'GEMOT // WASTELAND';
} else if (activeTheme === 'minimal') {
    document.title = 'Gemot';
} else {
    document.title = 'Gemot \u2014 Deliberation Monitor';
}
if (activeTheme !== 'magi') {
    const centerHeader = document.querySelector('#center-panel .panel-header');
    if (centerHeader) centerHeader.textContent = activeTheme === 'gastown' ? 'DISPATCH' : 'ANALYSIS';
}

// ===== Init =====

// Remove boot overlay after animation completes
const bootDelay = activeTheme === 'magi' ? 3200 : activeTheme === 'classic' ? 2200 : activeTheme === 'gastown' ? 2000 : 1200;
setTimeout(() => {
    const boot = document.getElementById('boot');
    if (boot) boot.classList.add('done');
}, bootDelay);

const watchCodes = getWatchCodes();
const groupID = getGroupID();

// Multi-view can also be activated via ?multi=true on any mode (for demo/testing)
const forceMulti = new URLSearchParams(window.location.search).get('multi') === 'true';

loadConfig().then(() => {
    if (groupID) {
        connectGroup(groupID);
    } else if (watchCodes.length > 1) {
        state.multiView = true;
        connectWatch(watchCodes);
    } else if (watchCodes.length === 1) {
        connectWatch(watchCodes);
    } else if (isDashboard()) {
        // Try connecting with existing session cookie first
        fetch('/api/dashboard/state').then(r => {
            if (r.ok) {
                connectDashboard();
            } else {
                showLoginForm();
            }
        }).catch(() => showLoginForm());
    } else {
        if (forceMulti) state.multiView = true;
        // Show landing page on root demo, or connect directly if ?demo param
        const isExplicitDemo = new URLSearchParams(window.location.search).has('demo');
        if (!isExplicitDemo && window.location.pathname === '/') {
            showLanding();
        }
        connect(); // start demo SSE in background either way
    }
});

function showLanding() {
    const main = document.getElementById('main');
    // Hide everything — landing page takes the full screen
    document.getElementById('agents')?.classList.add('hidden');
    document.getElementById('connections')?.classList.add('hidden');
    document.getElementById('center-panel')?.classList.add('hidden');
    document.getElementById('empty-state')?.classList.add('hidden');
    document.getElementById('footer')?.classList.add('hidden');
    document.getElementById('analysis-bar')?.classList.add('hidden');
    document.getElementById('scrubber-bar')?.classList.add('hidden');
    document.getElementById('delib-nav')?.classList.add('hidden');
    document.getElementById('cycle-bar')?.classList.add('hidden');
    document.querySelector('header')?.classList.add('hidden');

    document.getElementById('landing-overlay')?.remove();

    const themes = [
        { id: 'classic', label: 'Classic', desc: 'Medieval map' },
        { id: 'magi', label: 'MAGI', desc: 'CRT / EVA' },
        { id: 'minimal', label: 'Minimal', desc: 'Clean modern' },
        { id: 'gastown', label: 'Gastown', desc: 'Steampunk' },
    ];

    const themeSelect = document.createElement('select');
    themeSelect.className = 'landing-select';
    themes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.label} — ${t.desc}`;
        if (t.id === activeTheme) opt.selected = true;
        themeSelect.appendChild(opt);
    });

    const demoBtn = el('button', {
        className: 'landing-go-btn landing-demo-btn',
        onclick: () => {
            const url = new URL(window.location);
            const theme = themeSelect.value;
            if (theme === 'classic') url.searchParams.delete('theme');
            else url.searchParams.set('theme', theme);
            url.searchParams.set('demo', '1');
            window.location.href = url.toString();
        },
    }, 'Start Demo');

    const overlay = el('div', { className: 'landing-overlay', id: 'landing-overlay' },
        el('div', { className: 'landing-content' },
            el('div', { className: 'landing-title' }, 'Gemot'),
            el('div', { className: 'landing-subtitle' }, 'Deliberation Visualizer'),
            el('div', { className: 'landing-section' },
                el('div', { className: 'landing-section-label' }, 'Try the demo'),
                el('div', { className: 'landing-demo-row' }, themeSelect, demoBtn),
            ),
            el('div', { className: 'landing-section' },
                el('div', { className: 'landing-section-label' }, 'Watch a deliberation'),
                el('div', { className: 'landing-watch-row' },
                    el('input', {
                        className: 'landing-input',
                        type: 'text',
                        placeholder: 'Enter join code...',
                        id: 'landing-code-input',
                    }),
                    el('button', {
                        className: 'landing-go-btn',
                        onclick: () => {
                            const code = document.getElementById('landing-code-input')?.value.trim();
                            if (code) window.location.href = `/watch/${code}${window.location.search}`;
                        },
                    }, 'Watch'),
                ),
            ),
            el('div', { className: 'landing-links' },
                el('a', { href: '/dashboard' + window.location.search, className: 'landing-link' }, 'Agent Dashboard'),
                el('span', { className: 'landing-link-sep' }, '\u00b7'),
                el('a', { href: 'https://gemot.dev', className: 'landing-link' }, 'gemot.dev'),
            ),
        ),
    );

    main.appendChild(overlay);

    document.getElementById('landing-code-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const code = e.target.value.trim();
            if (code) window.location.href = `/watch/${code}${window.location.search}`;
        }
    });
}

let extraWatchSources = []; // module-level to allow cleanup on reconnection

function connectWatch(codes) {
    // Close previous extra sources to prevent leaks on reconnection
    extraWatchSources.forEach(es => es.close());
    extraWatchSources = [];

    const primary = codes[0];
    if (eventSource) eventSource.close();

    // Use direct gemot SSE if available (lower latency), fall back to vis proxy
    const gemotSSE = state.gemotURL ? `${state.gemotURL}/events?join_code=${primary}` : null;
    const sseURL = gemotSSE || `/api/watch/${primary}/events`;

    eventSource = new EventSource(sseURL);

    eventSource.onopen = () => {
        state.connected = true;
        updateConnectionStatus();
    };

    eventSource.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            // Direct gemot SSE sends lightweight events — trigger a state re-fetch
            if (gemotSSE && msg.type !== 'ping' && msg.type !== 'connected') {
                fetch(`/api/watch/${primary}/state`)
                    .then(r => r.json())
                    .then(snap => {
                        if (snap.deliberations) {
                            Object.assign(state.deliberations, snap.deliberations);
                            render();
                        }
                    })
                    .catch(() => {}); // silent — state will refresh on next event
            } else {
                handleEvent(msg);
            }
        } catch (err) {
            console.error('SSE parse error:', err);
        }
    };

    eventSource.onerror = () => {
        state.connected = false;
        updateConnectionStatus();
        // If direct gemot SSE fails, fall back to vis proxy
        if (gemotSSE && eventSource.readyState === EventSource.CLOSED) {
            console.log('Direct SSE failed, falling back to proxy');
            eventSource = new EventSource(`/api/watch/${primary}/events`);
            eventSource.onopen = () => { state.connected = true; updateConnectionStatus(); };
            eventSource.onmessage = (e) => {
                try { handleEvent(JSON.parse(e.data)); } catch (_) {}
            };
            eventSource.onerror = () => { state.connected = false; updateConnectionStatus(); };
        }
    };

    // Update header to show watch mode
    const sysLabel = document.querySelector('.system-label');
    if (sysLabel) sysLabel.textContent = `WATCHING`;

    // For multi-code: fetch additional codes' state and start their SSE streams
    if (codes.length > 1) {
        codes.slice(1).forEach(code => {
            fetch(`/api/watch/${code}/state`)
                .then(r => r.json())
                .then(snap => {
                    if (snap.deliberations) {
                        Object.assign(state.deliberations, snap.deliberations);
                        render();
                    }
                })
                .catch(err => console.error(`Watch ${code}:`, err));

            const extra = new EventSource(`/api/watch/${code}/events`);
            extra.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'state' && msg.data?.deliberation) {
                        state.deliberations[msg.data.deliberation.deliberation_id] = msg.data;
                        onActivity(msg.data.deliberation.deliberation_id);
                        render();
                    } else if (msg.type === 'snapshot' && msg.data?.deliberations) {
                        Object.assign(state.deliberations, msg.data.deliberations);
                        render();
                    }
                } catch (err) {
                    // ignore parse errors on secondary streams
                }
            };
            extraWatchSources.push(extra);
        });
    }
}

// Clean up all extra SSE connections on page unload
window.addEventListener('beforeunload', () => {
    extraWatchSources.forEach(es => es.close());
});

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
});

// Scrubber controls
document.getElementById('scrubber-play')?.addEventListener('click', toggleScrubberPlay);
document.getElementById('scrubber-speed')?.addEventListener('click', cycleScrubberSpeed);
document.getElementById('scrubber-filter')?.addEventListener('click', cycleScrubberFilter);
document.getElementById('scrubber-live')?.addEventListener('click', scrubToLive);

// Click on track to jump to nearest event
document.getElementById('scrubber-track')?.addEventListener('click', (e) => {
    if (!scrubber.events.length) return;
    const track = e.currentTarget;
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(pct * (scrubber.events.length - 1));
    scrubTo(Math.max(0, Math.min(idx, scrubber.events.length - 1)));
});

document.addEventListener('keydown', (e) => {
    if (!scrubber.events.length) return;
    if (e.target.tagName === 'INPUT') return; // don't hijack form input
    if (e.key === 'ArrowRight') {
        e.preventDefault();
        scrubTo(Math.min((scrubber.eventIndex ?? -1) + 1, scrubber.events.length - 1));
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scrubTo(Math.max((scrubber.eventIndex ?? 1) - 1, 0));
    } else if (e.key === ' ' && scrubber.enabled) {
        e.preventDefault();
        toggleScrubberPlay();
    }
});

// Delegated click handler for multi-view regions (survives DOM rebuilds)
document.getElementById('main').addEventListener('click', (e) => {
    const region = e.target.closest('.multi-region');
    if (region && state.multiView) {
        const delibId = region.dataset.delibId;
        if (delibId) {
            // Pause demo loop on manual click
            state.cyclePaused = true;
            stopDemoLoop();
            focusOnDelib(delibId);

            // Resume demo loop after 60s of no interaction
            clearTimeout(cycleProgressTimer);
            cycleProgressTimer = setTimeout(() => {
                state.cyclePaused = false;
                startDemoLoop();
            }, 60000);
        }
    }
});
