// GEMOTVIS — deliberation monitor
// Main application controller

const VOTE_LABELS_MAGI = { 1: '承認', '-1': '否定', 0: '保留' };
const VOTE_LABELS_MINIMAL = { 1: 'YES', '-1': 'NO', 0: '—' };
let VOTE_LABELS = VOTE_LABELS_MINIMAL; // set by applyTheme()
const VOTE_CLASSES = { 1: 'vote-approve', '-1': 'vote-deny', 0: 'vote-pass' };

const STATUS_LABELS = {
    magi: { online: 'ONLINE', offline: 'OFFLINE', closed: 'CLOSED', analyzing: 'ANALYZING' },
    minimal: { online: 'Connected', offline: 'Disconnected', closed: 'Closed', analyzing: 'Analyzing' },
    gastown: { online: 'OPERATIONAL', offline: 'OFFLINE', closed: 'SEALED', analyzing: 'PROCESSING' },
};
let STATUS = STATUS_LABELS.minimal; // set by applyTheme()

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
    focusedDelibID: null,    // which deliberation the camera is focused on (null = overview)
    scrubActiveDelibID: null, // which card owns the current scrub event (highlight, no zoom)
    lastActivity: {},        // delibID -> timestamp of last event
};

let eventSource = null;
let cycleProgressTimer = null;
let renderDebounce = null;
let directSSEFetchTimer = null;
let previousVotes = {}; // agentID -> vote value, for detecting changes
let knownAgents = new Set(); // for detecting new agents
let focusTimer = null; // timer to return to overview after idle
let typingTimer = null; // current word-reveal animation

// Scrubber state
const SCRUBBER_SPEEDS = [12000, 7000, 4000, 2000]; // ms per new-message pause
const SCRUBBER_SPEED_LABELS = ['1x', '2x', '3x', '5x'];
const scrubber = {
    enabled: false,
    playing: false,
    eventIndex: null, // null = live/latest
    events: [],       // full event list
    filtered: [],     // filtered by type
    playTimer: null,
    speedIdx: 0,
    typeFilter: null, // null = all, or 'position'|'vote'|'analysis'
    autoplayStarted: false, // true after first multi-view autoplay
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

// Trim audit logs and positions to prevent memory bloat on long sessions
const MAX_AUDIT_ENTRIES = 200;
const MAX_POSITIONS = 100;
function trimLargeData(delibs) {
    for (const ds of Object.values(delibs)) {
        if (ds.audit_log?.operations?.length > MAX_AUDIT_ENTRIES) {
            ds.audit_log.operations = ds.audit_log.operations.slice(-MAX_AUDIT_ENTRIES);
        }
        if (ds.positions?.length > MAX_POSITIONS) {
            ds.positions = ds.positions.slice(-MAX_POSITIONS);
        }
    }
}

function handleEvent(msg) {
    switch (msg.type) {
        case 'snapshot':
            state.deliberations = msg.data.deliberations || {};
            trimLargeData(state.deliberations);
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
                trimLargeData(state.deliberations);
                onActivity(delibID);
                // Debounce render — multiple state events arrive in rapid succession
                clearTimeout(renderDebounce);
                renderDebounce = setTimeout(render, 100);
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

// Filter deliberation state to show only events the scrubber has revealed.
//
// Ops are sorted chronologically with sequence numbers. For the focused delib,
// we count how many of its ops the global scrubber has stepped through.
// For background delibs, we use timestamp-based cutoff (coarse but sufficient).
function filterToTime(ds, cutoffTime) {
    const ops = ds.audit_log?.operations || []; // already sorted chronologically with sequence
    const delibID = ds.deliberation?.deliberation_id;

    let filteredOps;
    const isFocused = delibID && (graphState.activeEdge === delibID ||
        state.focusedDelibID === delibID || state.activeDelibID === delibID);

    if (scrubber.enabled && scrubber.eventIndex != null && isFocused) {
        // Focused: count how many of this delib's events the scrubber has passed
        let count = 0;
        for (let i = 0; i <= scrubber.eventIndex; i++) {
            if (scrubber.events[i]?.delibID === delibID) count++;
        }
        filteredOps = ops.slice(0, count);
    } else if (scrubber.enabled && scrubber.eventIndex != null) {
        // Background: use timestamp cutoff
        const cutoff = new Date(cutoffTime).getTime();
        filteredOps = ops.filter(op => new Date(op.timestamp).getTime() <= cutoff);
    } else {
        filteredOps = ops;
    }

    // Count revealed events by type
    let posOpsCount = 0, voteOpsCount = 0, hasAnalysisOp = false;
    filteredOps.forEach(op => {
        const m = (op.method || '').replace('gemot/', '');
        if (m.includes('submit_position')) posOpsCount++;
        else if (m.includes('vote')) voteOpsCount++;
        else if (m.includes('analy') || m.includes('get_analysis_result')) hasAnalysisOp = true;
    });

    // Positions and votes are already sorted chronologically in the fixed data
    const positions = (ds.positions || []).slice(0, posOpsCount);
    const votes = (ds.votes || []).slice(0, voteOpsCount);

    const visibleAgentIDs = new Set(positions.map(p => p.agent_id));
    const agents = (ds.agents || []).filter(a => visibleAgentIDs.has(a.id));

    // Show analysis only after its op has been revealed
    const analysis = hasAnalysisOp ? ds.analysis : null;
    const filteredAgents = analysis ? agents : agents.map(a => ({ ...a, cluster_id: undefined }));

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
        const method = (op.method || '').replace('gemot/', ''); // normalize: strip prefix if present
        let type = 'other';
        let label = method;
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

// Build a global timeline from ALL deliberations (for multi-view replay)
function buildGlobalTimeline(delibs) {
    const events = [];
    for (const [delibID, ds] of Object.entries(delibs)) {
        const topic = ds.deliberation?.topic || delibID;
        const shortTopic = topic.length > 30 ? topic.slice(0, 28) + '..' : topic;
        const ops = ds.audit_log?.operations || [];
        ops.forEach((op, i) => {
            const method = (op.method || '').replace('gemot/', '');
            let type = 'other';
            let action = method;
            if (method.includes('submit_position')) {
                type = 'position';
                action = `${shortAgentID(op.agent_id || '')} submits position`;
            } else if (method.includes('vote')) {
                type = 'vote';
                action = `${shortAgentID(op.agent_id || '')} votes`;
            } else if (method.includes('analy')) {
                type = 'analysis';
                action = method.includes('complete') || method.includes('result') ? 'Analysis complete' : 'Analysis started';
            }
            events.push({
                time: op.timestamp,
                label: `${shortTopic}: ${action}`,
                type,
                delibID,
                index: i,
            });
        });
    }
    return events.sort((a, b) => new Date(a.time) - new Date(b.time));
}

function renderScrubber(ds) {
    const bar = document.getElementById('scrubber-bar');
    if (!bar) return;

    // In multi-view: build global timeline across all deliberations
    // In single-view: build timeline for the active deliberation
    const isGlobal = state.multiView || !ds;
    let allEvents;
    if (isGlobal) {
        allEvents = buildGlobalTimeline(state.deliberations);
    } else {
        allEvents = buildTimelineEvents(ds);
    }

    // Pin scrubber to bottom in global mode
    bar.classList.toggle('scrubber-global', isGlobal);
    scrubber.events = allEvents;

    if (allEvents.length < 2) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');

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

    // Playhead line (vertical indicator at current position)
    let playhead = dots.parentElement.querySelector('.scrubber-playhead');
    if (scrubber.eventIndex != null && allEvents.length > 1) {
        const pct = (scrubber.eventIndex / (allEvents.length - 1)) * 100;
        if (!playhead) {
            playhead = el('div', { className: 'scrubber-playhead' });
            dots.parentElement.appendChild(playhead);
        }
        playhead.style.cssText = `left: ${pct}%`;
        playhead.classList.remove('hidden');
    } else if (playhead) {
        playhead.classList.add('hidden');
    }

    const idx = scrubber.eventIndex;
    if (idx != null && allEvents[idx]) {
        const t = new Date(allEvents[idx].time);
        const ts = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        label.textContent = `${ts} \u2014 ${allEvents[idx].label}`;
    } else {
        const liveText = state.mode === 'demo' || state.mode === 'replay' ? 'LATEST' : 'LIVE';
        label.textContent = liveText;
        const liveBtn = document.getElementById('scrubber-live');
        if (liveBtn) liveBtn.textContent = liveText;
    }
    updatePlayButton();
}

function scrubTo(index, fromPlay) {
    scrubber.enabled = true;
    scrubber.eventIndex = index;
    if (!fromPlay) state.cyclePaused = true;
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }

    // Update URL for deep linking (throttled to avoid history spam)
    if (!fromPlay || index % 10 === 0) {
        const url = new URL(window.location);
        url.searchParams.set('t', index);
        history.replaceState(null, '', url);
    }

    if (state.multiView && scrubber.events[index]?.delibID) {
        stopDemoLoop();
        clearTimeout(focusTimer);
        state.scrubActiveDelibID = scrubber.events[index].delibID;

        // In graph mode: don't zoom to single-view, just track active edge
        const graph = buildGraphFromDelibs(state.deliberations);
        if (graph) {
            // Graph mode: set activeEdge for bilateral events, clear for group events
            const evtDelib = state.deliberations[scrubber.events[index].delibID];
            if (evtDelib && (evtDelib.agents || []).length === 2) {
                graphState.activeEdge = scrubber.events[index].delibID;
            }
            // Don't set focusedDelibID — stay in graph view
        } else if (fromPlay) {
            // Card mode: zoom to the active deliberation (filmstrip replay)
            state.focusedDelibID = scrubber.events[index].delibID;
        }
        // Manual dot-click: stay in overview (synchronized view)
    }
    render();
}

function scrubToLive() {
    scrubber.enabled = false;
    scrubber.eventIndex = null;
    state.scrubActiveDelibID = null;
    stopScrubberPlay();
    render();
}

function toggleScrubberPlay() {
    scrubber.playing ? stopScrubberPlay() : startScrubberPlay();
}

function startScrubberPlay() {
    if (scrubber.playTimer) clearTimeout(scrubber.playTimer);
    scrubber.playing = true;
    scrubber.enabled = true;
    if (scrubber.eventIndex == null) scrubber.eventIndex = 0;

    function advance() {
        let next = (scrubber.eventIndex || 0) + 1;
        if (next >= scrubber.events.length) { stopScrubberPlay(); return; }

        // Skip non-visual events (create_deliberation, set_template, etc.)
        // but keep ALL position and vote events including group deliberations
        while (next < scrubber.events.length) {
            const e = scrubber.events[next];
            if (e.type === 'position' || e.type === 'vote') break;
            next++;
        }
        if (next >= scrubber.events.length) { stopScrubberPlay(); return; }

        const evt = scrubber.events[next];
        scrubTo(next, true);

        let delay = SCRUBBER_SPEEDS[scrubber.speedIdx];

        // Find the next visual event to check if we're about to switch deliberations
        let nextVisual = next + 1;
        while (nextVisual < scrubber.events.length) {
            const ne = scrubber.events[nextVisual];
            if (ne.type === 'position' || ne.type === 'vote') break;
            nextVisual++;
        }
        const nextVisEvent = scrubber.events[nextVisual];
        const switchingEdge = nextVisEvent && nextVisEvent.delibID !== evt.delibID;

        if (switchingEdge) {
            delay += SCRUBBER_SPEEDS[scrubber.speedIdx] * 0.5;
            const edgeAtSwitch = graphState.activeEdge; // capture for closure

            // Show thinking dots + end marker after typing finishes
            setTimeout(() => {
                if (graphState.activeEdge !== edgeAtSwitch) return; // edge already switched
                const thread = document.querySelector('.chat-thread');
                const content = document.getElementById('center-content');
                if (thread && scrubber.playing) {
                    const indicator = el('div', { className: 'chat-thinking' },
                        el('span', { className: 'thinking-dots' },
                            el('span', { className: 'thinking-dot' }),
                            el('span', { className: 'thinking-dot' }),
                            el('span', { className: 'thinking-dot' })));
                    thread.appendChild(indicator);
                    if (content) content.scrollTop = content.scrollHeight;
                }
                if (content && !content.querySelector('.chat-end-marker')) {
                    setTimeout(() => {
                        if (graphState.activeEdge !== edgeAtSwitch) return; // stale
                        if (content.isConnected && scrubber.playing) {
                            content.appendChild(el('div', { className: 'chat-end-marker' }, 'End of negotiation'));
                            content.scrollTop = content.scrollHeight;
                        }
                    }, SCRUBBER_SPEEDS[scrubber.speedIdx] * 0.3);
                }
            }, SCRUBBER_SPEEDS[scrubber.speedIdx] * 0.7);
        }

        scrubber.playTimer = setTimeout(advance, delay);
    }

    scrubber.playTimer = setTimeout(advance, SCRUBBER_SPEEDS[scrubber.speedIdx]);
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
        clearTimeout(scrubber.playTimer);
        startScrubberPlay();
    }
}

function stopScrubberPlay() {
    scrubber.playing = false;
    clearTimeout(scrubber.playTimer);
    scrubber.playTimer = null;
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    updatePlayButton();
}

function updatePlayButton() {
    const btn = document.getElementById('scrubber-play');
    if (btn) btn.textContent = scrubber.playing ? '\u23F8' : '\u25B6';
}



// ===== Rendering =====

function render() {
    const delibs = state.deliberations;
    const ids = Object.keys(delibs);

    // Multi-view: render all deliberations as a unified graph
    if (state.multiView && ids.length > 1) {
        document.getElementById('delib-nav')?.classList.add('hidden');
        document.getElementById('empty-state')?.classList.add('hidden');

        const graph = buildGraphFromDelibs(delibs);
        const focused = state.focusedDelibID && delibs[state.focusedDelibID];

        // Remove stale overview button if it exists
        document.getElementById('overview-btn')?.remove();

        // Zoomed into a specific deliberation for full single-view
        if (focused) {
            document.getElementById('graph-canvas')?.classList.add('hidden');
            document.getElementById('agents')?.classList.remove('hidden');
            document.getElementById('connections')?.classList.remove('hidden');
            document.getElementById('footer')?.classList.remove('hidden');
            document.getElementById('analysis-bar')?.classList.remove('hidden');
            document.getElementById('scrubber-bar')?.classList.remove('hidden');
            document.getElementById('main').className = '';

            let display = focused;
            if (scrubber.enabled && scrubber.eventIndex != null) {
                const evt = scrubber.events[scrubber.eventIndex];
                if (evt?.time) display = filterToTime(focused, evt.time);
            }

            renderHeader(display);
            renderAnalysisBar(display);
            renderAgents(display);
            renderConnections(display);
            renderCenterPanel(display);
            renderCruxPanel(display);
            renderMetrics(display);
            renderAuditLog(display);
            renderScrubber(null);
            return;
        }

        // Graph overview
        document.getElementById('scrubber-bar')?.classList.remove('hidden');
        renderScrubber(null);

        // During autoplay, track which deliberation is active
        if (scrubber.playing && scrubber.eventIndex != null) {
            const evt = scrubber.events[scrubber.eventIndex];
            if (evt?.delibID) {
                const newEdge = evt.delibID;
                const prevEdge = graphState.activeEdge;
                if (newEdge !== prevEdge) {
                    // Force full center panel rebuild on delib switch
                    renderCenterPanel._delibID = null;
                    renderCenterPanel._posCount = 0;
                    renderCenterPanel._hadAnalysis = false;
                    renderCenterPanel._thread = null;
                    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
                    const cp = document.getElementById('center-content');
                    if (cp) clearChildren(cp);
                    document.getElementById('center-panel')?.classList.add('hidden');
                }
                graphState.activeEdge = newEdge;
            }
        }

        renderGraphView(graph);

        if (!scrubber.playing && !scrubber.autoplayStarted && scrubber.events.length > 2) {
            scrubber.autoplayStarted = true;

            // Restore deep link position if ?t= param exists
            const tParam = new URLSearchParams(window.location.search).get('t');
            if (tParam != null) {
                const idx = Math.min(parseInt(tParam, 10) || 0, scrubber.events.length - 1);
                scrubTo(idx, true);
                startScrubberPlay();
                return;
            }

            // Show a "beginning" indicator before autoplay launches
            const gc = document.getElementById('graph-canvas');
            if (gc) {
                let readyEl = gc.querySelector('.graph-ready-indicator');
                if (!readyEl) {
                    readyEl = el('div', { className: 'graph-ready-indicator' },
                        el('div', { className: 'graph-ready-text' }, 'Replaying deliberation'),
                        el('div', { className: 'graph-ready-dots' },
                            el('span', { className: 'thinking-dot' }),
                            el('span', { className: 'thinking-dot' }),
                            el('span', { className: 'thinking-dot' })),
                    );
                    gc.appendChild(readyEl);
                }

                // Start playback after a pause, keep indicator visible well into playback
                setTimeout(() => {
                    startScrubberPlay();
                }, 3000);
                setTimeout(() => {
                    if (readyEl.isConnected) readyEl.classList.add('fading');
                    setTimeout(() => { if (readyEl.isConnected) readyEl.remove(); }, 1200);
                }, 12000);
            } else {
                startScrubberPlay();
            }
        }
        return;
    }

    // Leaving multi-view: restore single-view DOM
    const graphCanvas = document.getElementById('graph-canvas');
    if (graphCanvas) graphCanvas.remove();
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
        const agents = delibs[id].agents || [];
        // Compact label: show agent names for small groups, topic for larger ones
        const label = agents.length > 0 && agents.length <= 3
            ? agents.map(a => shortAgentID(a.id)).join('–')
            : truncate(d.topic || id, 25);
        const btn = el('button', {
            className: `delib-tab ${id === state.activeDelibID ? 'active' : ''} ${d.status === 'analyzing' ? 'analyzing' : ''}`,
            dataset: { id },
        }, label);
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
            el('div', { className: `diamond ${convClass} ${clusterClass}` }),
            el('div', { className: 'diamond-vote' },
                // Only show vote if votes exist in this deliberation
                (ds.votes && ds.votes.length > 0)
                    ? el('span', { className: `agent-vote ${voteClass}` }, voteLabel)
                    : null,
            ),
            el('div', { className: 'agent-label' },
                el('span', { className: 'agent-name' }, name),
                agent.model_family ? el('span', { className: 'agent-model' }, agent.model_family) : null,
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
            if (activeTheme === 'gastown') {
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
    const panelHeader = panel.querySelector('.panel-header');
    const analysis = ds.analysis;

    const positions = ds.positions || [];
    const agents = ds.agents || [];
    const agentIDs = agents.map(a => a.id);

    // Set header based on content being shown
    if (panelHeader) {
        if (positions.length > 0 && !analysis) {
            panelHeader.textContent = 'Negotiation';
        } else if (positions.length > 0 && analysis) {
            panelHeader.textContent = 'Negotiation & Analysis';
        } else if (analysis) {
            panelHeader.textContent = 'Analysis';
        } else {
            panelHeader.textContent = '';
        }
    }

    if (!analysis && positions.length === 0) {
        panel.classList.add('hidden');
        return;
    }

    // Incremental rendering: track what's already in the DOM and only add new content.
    // This prevents destroying in-progress typing animations.
    const delibID = ds.deliberation?.deliberation_id;
    const prevDelib = renderCenterPanel._delibID;
    const prevPosCount = renderCenterPanel._posCount || 0;
    const prevHadAnalysis = renderCenterPanel._hadAnalysis || false;

    // Full rebuild if switching deliberation
    if (delibID !== prevDelib) {
        clearChildren(content);
        renderCenterPanel._posCount = 0;
        renderCenterPanel._hadAnalysis = false;
        renderCenterPanel._thread = null;
    }
    renderCenterPanel._delibID = delibID;

    // If typing is in progress and nothing new to add, skip entirely
    // (don't touch panel visibility — let previous state stand)
    if (typingTimer && positions.length === prevPosCount && (!!analysis === prevHadAnalysis)) {
        return;
    }

    panel.classList.remove('hidden');

    if (positions.length > 0) {
        // Get or create chat thread
        let thread = renderCenterPanel._thread;
        if (!thread || !thread.isConnected) {
            thread = el('div', { className: 'chat-thread' });
            content.appendChild(thread);
            renderCenterPanel._thread = thread;
        }

        // Remove previous "chat-new" class and end marker
        thread.querySelector('.chat-new')?.classList.remove('chat-new');
        content.querySelector('.chat-end-marker')?.remove();

        // Only render NEW positions (after prevPosCount)
        const newPositions = positions.slice(prevPosCount);
        newPositions.forEach((p, idx) => {
            const isLeft = agentIDs.indexOf(p.agent_id) <= 0;
            const isNewest = (prevPosCount + idx) === positions.length - 1;

            const textNode = el('div', { className: 'chat-text' });
            if (!isNewest || !scrubber.playing) {
                const text = p.content;
                const paragraphs = text.split(/\n\n+/);
                if (paragraphs.length > 1) {
                    paragraphs.forEach(para => {
                        if (para.trim()) {
                            const pEl = el('p', { className: 'chat-para' });
                            pEl.appendChild(renderTextWithMentions(para.trim(), agentIDs));
                            textNode.appendChild(pEl);
                        }
                    });
                } else {
                    textNode.appendChild(renderTextWithMentions(text, agentIDs));
                }
            }

            const bubble = el('div', {
                className: `chat-bubble ${isLeft ? 'chat-left' : 'chat-right'} ${isNewest ? 'chat-new' : ''}`,
            },
                el('div', { className: 'chat-name' }, shortAgentID(p.agent_id)),
                textNode,
            );
            thread.appendChild(bubble);

            if (isNewest && scrubber.playing) {
                requestAnimationFrame(() => typeReveal(textNode, p.content));
            }
        });

        renderCenterPanel._posCount = positions.length;
        requestAnimationFrame(() => { content.scrollTop = content.scrollHeight; });
    }

    // Show "end of negotiation" marker only when all positions were already rendered
    // on a PREVIOUS call (meaning the last message typing has completed)
    if (!analysis && positions.length > 0) {
        const totalPos = (ds.positions || []).length;
        const allRevealed = positions.length >= totalPos && totalPos > 0;
        const lastMsgAlreadyRendered = prevPosCount >= totalPos;
        if (allRevealed && lastMsgAlreadyRendered && !typingTimer) {
            if (!content.querySelector('.chat-end-marker')) {
                content.appendChild(el('div', { className: 'chat-end-marker' }, 'End of negotiation'));
            }
        }
        return;
    }
    if (!analysis) return;

    // Skip if analysis already rendered for this delib
    if (prevHadAnalysis) return;
    renderCenterPanel._hadAnalysis = true;

    // Remove end marker before adding analysis
    content.querySelector('.chat-end-marker')?.remove();

    // Separator
    if (positions.length > 0) {
        content.appendChild(el('hr', { className: 'chat-divider' }));
    }

    const consensus = analysis.consensus_statements || [];
    const bridging = analysis.bridging_statements || [];
    const cruxes = analysis.cruxes || [];

    if (consensus.length === 0 && bridging.length === 0 && !analysis.compromise_proposal && cruxes.length === 0) {
        if (positions.length === 0) { panel.classList.add('hidden'); return; }
        // Chat thread already rendered, just auto-scroll
        requestAnimationFrame(() => { content.scrollTop = content.scrollHeight; });
        return;
    }

    panel.classList.remove('hidden');

    // Collect all analysis items to render, then type-reveal them sequentially
    const analysisItems = [];

    if (consensus.length > 0) {
        analysisItems.push({ label: 'CONSENSUS', labelClass: 'panel-label-consensus' });
        consensus.forEach(c => analysisItems.push({ text: c.content }));
    }
    if (bridging.length > 0) {
        analysisItems.push({ label: 'BRIDGING', labelClass: 'panel-label-bridging' });
        bridging.forEach(b => {
            const pct = b.bridging_score != null ? ` (${(b.bridging_score * 100).toFixed(0)}%)` : '';
            analysisItems.push({ text: b.content + pct });
        });
    }
    if (analysis.compromise_proposal) {
        analysisItems.push({ label: 'COMPROMISE', labelClass: 'panel-label-compromise' });
        analysisItems.push({ text: analysis.compromise_proposal });
    }
    if (analysisItems.length === 0 && cruxes.length > 0) {
        analysisItems.push({ label: `${cruxes.length} CRUXES` });
        cruxes.forEach(c => {
            analysisItems.push({ text: c.claim || c.crux_claim || '' });
        });
    }

    analysisItems.forEach((item, idx) => {
        if (item.label) {
            content.appendChild(el('div', { className: `panel-label ${item.labelClass || ''}` }, item.label));
        }
        if (item.text) {
            const li = el('li', { className: 'analysis-item' });
            const textEl = el('span', { className: 'analysis-item-text' });
            li.appendChild(textEl);
            content.appendChild(li);
            if (scrubber.playing) {
                const delay = idx * 800;
                setTimeout(() => {
                    if (textEl.isConnected) typeReveal(textEl, item.text);
                }, delay);
            } else {
                textEl.textContent = item.text;
            }
        }
    });
}

function renderCruxPanel(ds) {
    const list = document.getElementById('crux-list');
    const analysis = ds.analysis;
    const cruxes = analysis?.cruxes || [];
    clearChildren(list);

    if (cruxes.length === 0) {
        list.appendChild(el('div', { className: 'empty-message' }, 'NO CRUXES YET'));
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

        const claimText = c.crux_claim || c.claim || '';
        const claimEl = el('div', { className: 'crux-claim crux-collapsed' }, claimText);
        const item = el('div', { className: 'crux-item' },
            claimEl,
            meta,
        );
        item.onclick = () => claimEl.classList.toggle('crux-collapsed');
        item.style.cursor = 'pointer';
        list.appendChild(item);
    });
}

function renderMetrics(ds) {
    const grid = document.getElementById('metrics-content');
    const a = ds.analysis;
    clearChildren(grid);

    const positions = ds.positions || [];
    const agents = ds.agents || [];
    const delibs = state.deliberations;
    const activeEdgeDelib = graphState.activeEdge;

    if (positions.length === 0 && !a) {
        grid.appendChild(el('div', { className: 'empty-message' }, 'WAITING'));
        return;
    }

    // Turn-taking flow — colored blocks showing who spoke in sequence
    if (positions.length > 0 && agents.length > 0) {
        const agentIDs = agents.map(ag => ag.id);
        const flow = el('div', { className: 'metrics-flow' });
        const flowLabel = el('div', { className: 'metrics-section-label' }, 'TURNS');
        flow.appendChild(flowLabel);
        const flowTrack = el('div', { className: 'metrics-flow-track' });
        positions.forEach(p => {
            const idx = agentIDs.indexOf(p.agent_id);
            const block = el('div', { className: 'metrics-flow-block', style: `background:${agentColor(idx, agentIDs.length)}` });
            block.title = shortAgentID(p.agent_id);
            flowTrack.appendChild(block);
        });
        flow.appendChild(flowTrack);
        grid.appendChild(flow);
    }

    // Per-agent stats: messages, avg word count
    if (agents.length > 0 && positions.length > 0) {
        const agentStats = agents.map(ag => {
            const msgs = positions.filter(p => p.agent_id === ag.id);
            const words = msgs.reduce((sum, p) => sum + (p.content || '').split(/\s+/).length, 0);
            return { name: shortAgentID(ag.id), msgs: msgs.length, words, avgWords: msgs.length ? Math.round(words / msgs.length) : 0 };
        });

        const statsSection = el('div', { className: 'metrics-agent-stats' });
        agentStats.forEach((s, i) => {
            statsSection.appendChild(el('div', { className: 'metrics-agent-row', style: `border-left-color:${agentColor(i, agentStats.length)}` },
                el('span', { className: 'metrics-agent-name' }, s.name),
                el('span', { className: 'metrics-agent-detail' },
                    `${s.msgs} msg · ${s.words} words · avg ${s.avgWords} w/msg`),
            ));
        });
        grid.appendChild(statsSection);
    }

    // Network context: how many other bilaterals each agent participates in
    if (activeEdgeDelib && agents.length > 0) {
        const graph = buildGraphFromDelibs(delibs);
        const ctx = el('div', { className: 'metrics-network' });
        ctx.appendChild(el('div', { className: 'metrics-section-label' }, 'NETWORK'));
        agents.forEach(ag => {
            const otherEdges = graph.edges.filter(e =>
                (e.a === ag.id || e.b === ag.id) && e.delibID !== activeEdgeDelib);
            if (otherEdges.length > 0) {
                const others = otherEdges.map(e => shortAgentID(e.a === ag.id ? e.b : e.a)).join(', ');
                ctx.appendChild(el('div', { className: 'metrics-network-row' },
                    el('span', { className: 'metrics-agent-name' }, shortAgentID(ag.id)),
                    el('span', { className: 'metrics-network-detail' }, `also talking to ${others}`),
                ));
            }
        });
        grid.appendChild(ctx);
    }
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
    ops.slice(0, 40).forEach((op, i) => {
        const cascadeClass = isFirstRender && i < 5 ? ` new cascade-${i + 1}` : '';
        const method = (op.method || '').replace('gemot/', '');
        const agent = op.agent_id ? shortAgentID(op.agent_id) : '';
        // Verbose description for confidence
        let desc;
        if (method === 'submit_position' && agent) {
            desc = `${agent} submitted a position`;
        } else if (method === 'analyze') {
            desc = 'Analysis engine processing deliberation';
        } else if (method === 'get_analysis_result') {
            desc = 'Analysis results retrieved';
        } else if (method === 'vote' && agent) {
            desc = `${agent} cast a vote`;
        } else if (method === 'create_deliberation') {
            desc = 'Deliberation created';
        } else if (method === 'set_template') {
            desc = 'Template configured';
        } else {
            desc = agent ? `${method} by ${agent}` : method;
        }
        const entry = el('div', { className: `audit-entry${cascadeClass}` },
            el('span', { className: 'timestamp' }, formatTime(op.timestamp)),
            el('span', { className: 'audit-desc' }, desc),
        );
        log.appendChild(entry);
    });
}

// ===== Helpers =====

// Generate a distinct color for agent index i out of n total agents.
// Uses evenly spaced hues with consistent saturation/lightness.
function agentColor(i, n) {
    const hue = (i * 360 / Math.max(n, 1) + 210) % 360; // start at blue, rotate
    return `hsl(${hue}, 65%, 50%)`;
}

function shortAgentID(id) {
    if (!id) return '?';
    const parts = id.split(':');
    let name = parts[parts.length - 1];
    // Strip common suffixes that add noise
    name = name.replace(/-agent$/, '').replace(/_agent$/, '');
    return name.length > 18 ? name.slice(0, 16) + '..' : name;
}

// Render text with agent names highlighted (bold mentions).
// Returns a DocumentFragment with text nodes and strong spans.
function renderTextWithMentions(text, agentIDs) {
    const names = agentIDs.map(id => shortAgentID(id)).filter(n => n.length > 2);
    if (names.length === 0) return document.createTextNode(text);

    const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi');
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const strong = document.createElement('strong');
        strong.className = 'agent-mention';
        strong.textContent = match[0];
        frag.appendChild(strong);
        lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    return frag;
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '...' : s;
}

// Word-by-word typing reveal on an element. Fills text progressively.
// Speed adapts to fit within the scrubber interval.
function typeReveal(textEl, fullText) {
    if (typingTimer) clearInterval(typingTimer);
    const words = fullText.split(/(\s+)/); // preserve whitespace
    let shown = 0;
    textEl.textContent = '';
    const speed = Math.max(15, Math.min(40, SCRUBBER_SPEEDS[scrubber.speedIdx] * 0.7 / words.length));
    typingTimer = setInterval(() => {
        shown++;
        textEl.textContent = words.slice(0, shown).join('');
        // Auto-scroll parent panel to keep new text visible
        const panel = textEl.closest('.panel-content');
        if (panel) panel.scrollTop = panel.scrollHeight;
        if (shown >= words.length) {
            clearInterval(typingTimer);
            typingTimer = null;
        }
    }, speed);
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

// ===== Graph View =====
// All multi-view deliberations render as a unified graph.
// Bilaterals become edges, group delibs become clustered node groups,
// unrelated delibs become islands in the same canvas.

// Build graph from all deliberations.
// Returns { nodes: [agentID...], edges: [{a, b, delibID}...], groupDelibID: string|null, groups: [{delibID, agents}...] }
function buildGraphFromDelibs(delibs) {
    const ids = Object.keys(delibs);
    const allAgents = new Set();
    const edges = [];
    const groups = []; // deliberations with 3+ agents (rendered as node clusters)
    let groupDelibID = null;

    for (const id of ids) {
        const agents = (delibs[id]?.agents || []).map(a => a.id);
        agents.forEach(a => allAgents.add(a));

        if (agents.length === 2) {
            edges.push({ a: agents[0], b: agents[1], delibID: id });
        } else if (agents.length >= 3) {
            groups.push({ delibID: id, agents });
        }
        // Single-agent deliberations: agent appears as an isolated node
    }

    // Find a group deliberation whose agents are a superset of bilateral agents
    const bilateralAgents = new Set();
    edges.forEach(e => { bilateralAgents.add(e.a); bilateralAgents.add(e.b); });
    for (const g of groups) {
        const gSet = new Set(g.agents);
        if ([...bilateralAgents].every(a => gSet.has(a))) {
            groupDelibID = g.delibID;
            break;
        }
    }

    return {
        nodes: [...allAgents].sort(),
        edges,
        groupDelibID,
        groups,
    };
}

// State for graph view
let graphState = {
    activeEdge: null,    // delibID of the currently focused bilateral
    activeNode: null,    // agentID if viewing the group delib from a node's perspective
    hoverEdge: null,     // delibID being hovered
};

// Fixed positions for 7 Diplomacy powers (roughly matches a Europe map layout)
const DIPLOMACY_POSITIONS = {
    'england-agent':  { x: 22, y: 16 },
    'france-agent':   { x: 24, y: 52 },
    'germany-agent':  { x: 44, y: 24 },
    'italy-agent':    { x: 46, y: 64 },
    'austria-agent':  { x: 60, y: 42 },
    'russia-agent':   { x: 80, y: 24 },
    'turkey-agent':   { x: 82, y: 60 },
};

function getGraphNodePositions(graph) {
    const nodes = graph.nodes;
    const edges = graph.edges;

    // Check if all nodes match known Diplomacy powers
    const allDiplomacy = nodes.every(n => DIPLOMACY_POSITIONS[n]);
    if (allDiplomacy) return nodes.map(n => ({ id: n, ...DIPLOMACY_POSITIONS[n] }));

    // Check if agents have explicit x,y coordinates
    const delibs = state.deliberations;
    for (const ds of Object.values(delibs)) {
        const agents = ds.agents || [];
        if (agents.some(a => a.x != null && a.y != null)) {
            const posMap = {};
            agents.forEach(a => { if (a.x != null && a.y != null) posMap[a.id] = { x: a.x, y: a.y }; });
            if (nodes.every(n => posMap[n])) {
                return nodes.map(n => ({ id: n, ...posMap[n] }));
            }
        }
    }

    // Find connected components (islands) via union-find
    const parent = {};
    nodes.forEach(n => { parent[n] = n; });
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(a, b) { parent[find(a)] = find(b); }

    edges.forEach(e => union(e.a, e.b));
    // Also connect agents within the same group deliberation
    (graph.groups || []).forEach(g => {
        for (let i = 1; i < g.agents.length; i++) {
            if (parent[g.agents[i]] !== undefined) union(g.agents[0], g.agents[i]);
        }
    });

    // Group nodes by component
    const components = {};
    nodes.forEach(n => {
        const root = find(n);
        if (!components[root]) components[root] = [];
        components[root].push(n);
    });
    const islands = Object.values(components).sort((a, b) => b.length - a.length);

    // Single island: use centered polygon
    if (islands.length === 1) {
        return nodes.map((id, i) => {
            const pos = polygonPosition(i, nodes.length);
            return { id, ...pos };
        });
    }

    // Multiple islands: lay out each in its own region
    // Divide canvas into columns for each island
    const result = [];
    const cols = Math.min(islands.length, 4);
    const rows = Math.ceil(islands.length / cols);

    islands.forEach((island, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        // Region bounds for this island
        const regionW = 100 / cols;
        const regionH = 100 / rows;
        const cx = regionW * (col + 0.5);
        const cy = regionH * (row + 0.5);
        const radius = Math.min(regionW, regionH) * 0.35;

        island.forEach((id, i) => {
            if (island.length === 1) {
                result.push({ id, x: cx, y: cy });
            } else {
                const angle = (2 * Math.PI * i / island.length) - Math.PI / 2;
                result.push({
                    id,
                    x: cx + radius * Math.cos(angle) * 0.9,
                    y: cy + radius * Math.sin(angle) * 0.85,
                });
            }
        });
    });

    return result;
}

// Compute focused layout: active pair anchored left/right at a comfortable height,
// rest of graph keeps its horizontal positions but shifts upward off-screen.
// The graph stays connected — edges follow the nodes — creating a sense of the
// full network reconfiguring with the active edge pulled into view.
function computeFocusedLayout(basePositions, activeAgentA, activeAgentB) {
    if (!activeAgentA || !activeAgentB) return basePositions;

    // Active pair: anchored with room above for graph remnants to peek in
    const anchorY = 22;
    const focusA = { x: 12, y: anchorY };
    const focusB = { x: 88, y: anchorY };

    const baseA = basePositions.find(n => n.id === activeAgentA);
    const baseB = basePositions.find(n => n.id === activeAgentB);
    if (!baseA || !baseB) return basePositions;

    // Compute how much to shift the active edge's midpoint to our anchor point
    const baseMidY = (baseA.y + baseB.y) / 2;
    const shiftY = baseMidY - anchorY;

    const result = basePositions.map(n => {
        if (n.id === activeAgentA) return { ...n, x: focusA.x, y: focusA.y };
        if (n.id === activeAgentB) return { ...n, x: focusB.x, y: focusB.y };

        // Keep horizontal position, shift vertically upward above the active pair.
        const relY = n.y - baseMidY;
        const newY = anchorY + relY - shiftY * 0.5;
        return { ...n, x: n.x, y: Math.min(newY, anchorY - 8) };
    });

    // Push apart overlapping inactive nodes — need at least 16% horizontal separation
    // so labels don't collide
    const inactive = result.filter(n => n.id !== activeAgentA && n.id !== activeAgentB);
    inactive.sort((a, b) => a.x - b.x);
    for (let i = 1; i < inactive.length; i++) {
        const prev = inactive[i - 1];
        const curr = inactive[i];
        const dx = Math.abs(curr.x - prev.x);
        if (dx < 16) {
            // Shift current node right to make room
            curr.x = prev.x + 16;
        }
    }

    return result;
}

let _prevGraphActiveEdge = null;
let _edgeRefreshTimer = null;

function renderGraphView(graph) {
    const delibs = state.deliberations;
    const main = document.getElementById('main');
    main.className = `graph-view${graphState.activeEdge ? ' graph-edge-focused' : ''}`;

    // When the active edge changes, the graph reconfigures. Hide edge divs
    // during the node transition, then refresh edges after nodes settle.
    const edgeChanged = graphState.activeEdge !== _prevGraphActiveEdge;
    _prevGraphActiveEdge = graphState.activeEdge;

    // When the graph reconfigures, continuously re-render edges to track moving nodes
    if (edgeChanged) {
        clearTimeout(_edgeRefreshTimer);
        let frames = 0;
        const totalFrames = 90; // ~3s at 30fps
        function trackNodes() {
            if (frames++ >= totalFrames) return;
            renderGraphView._edgeOnly = true;
            renderGraphView(graph);
            renderGraphView._edgeOnly = false;
            _edgeRefreshTimer = setTimeout(trackNodes, 33);
        }
        // Start tracking after a brief delay (let the CSS transition begin)
        _edgeRefreshTimer = setTimeout(trackNodes, 50);
    }

    // Hide single-view elements
    document.getElementById('agents')?.classList.add('hidden');
    document.getElementById('connections')?.classList.add('hidden');

    let canvas = document.getElementById('graph-canvas');
    const isFirstRender = !canvas;
    if (!canvas) {
        canvas = el('div', { className: 'graph-canvas', id: 'graph-canvas' });
        main.appendChild(canvas);
    }

    // Determine scrub time for synchronized filtering
    const scrubTime = (scrubber.enabled && scrubber.eventIndex != null)
        ? scrubber.events[scrubber.eventIndex]?.time : null;
    const scrubDelibID = scrubber.events[scrubber.eventIndex]?.delibID;

    // Compute node positions: base layout, then shift if an edge is focused
    const basePositions = getGraphNodePositions(graph);
    let activeAgentA = null, activeAgentB = null;
    if (graphState.activeEdge) {
        const activeEdge = graph.edges.find(e => e.delibID === graphState.activeEdge);
        if (activeEdge) { activeAgentA = activeEdge.a; activeAgentB = activeEdge.b; }
    }
    const nodePositions = graphState.activeEdge
        ? computeFocusedLayout(basePositions, activeAgentA, activeAgentB)
        : basePositions;
    const posMap = {};
    nodePositions.forEach(n => { posMap[n.id] = n; });

    // ---- Edges: CSS div lines ----
    {
    const cw = canvas.offsetWidth || 1;
    const ch = canvas.offsetHeight || 1;
    const canvasRect = canvas.getBoundingClientRect();

    // For edge positioning, read actual rendered node positions (handles mid-transition)
    const liveNodePos = {};
    canvas.querySelectorAll('.graph-node').forEach(n => {
        const r = n.getBoundingClientRect();
        // Icon center is approximately at the center-top of the node element
        const iconSize = 64; // approximate
        liveNodePos[n.dataset.agentId] = {
            px: r.left + r.width / 2 - canvasRect.left,
            py: r.top + iconSize / 2 - canvasRect.top,
        };
    });

    graph.edges.forEach(edge => {
        const rawDs = delibs[edge.delibID];
        if (!rawDs) return;
        const ds = scrubTime ? filterToTime(rawDs, scrubTime) : rawDs;
        const posCount = (ds.positions || []).length;
        const isActive = graphState.activeEdge === edge.delibID;
        const isScrubTarget = scrubDelibID === edge.delibID;

        const pa = liveNodePos[edge.a];
        const pb = liveNodePos[edge.b];
        if (!pa || !pb) return;

        const thickness = Math.min(0.8 + posCount * 0.04, 2);
        const opacity = posCount === 0 ? 0.06 : Math.min(0.08 + posCount * 0.003, 0.25);

        // Use actual rendered pixel positions for edge geometry
        const mx = (pa.px + pb.px) / 2;
        const my = (pa.py + pb.py) / 2;
        const dxPx = pb.px - pa.px;
        const dyPx = pb.py - pa.py;
        const len = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
        const angle = Math.atan2(dyPx, dxPx) * 180 / Math.PI;

        let edgeClass = 'graph-edge-div';
        if (isActive || isScrubTarget) edgeClass += ' graph-edge-active';
        if (posCount === 0) edgeClass += ' graph-edge-empty';

        const edgeId = `edge-${edge.delibID}`;
        let edgeEl = canvas.querySelector(`[data-edge-id="${edgeId}"]`);
        if (!edgeEl) {
            edgeEl = el('div', { className: edgeClass, dataset: { edgeId: edgeId, delibId: edge.delibID } });
            canvas.insertBefore(edgeEl, canvas.firstChild);
        } else {
            edgeEl.className = edgeClass;
        }

        // Position at midpoint using percentages, size in pixels
        edgeEl.style.left = `${mx}px`;
        edgeEl.style.top = `${my}px`;
        edgeEl.style.width = `${len}px`;
        edgeEl.style.height = `${thickness}px`;
        edgeEl.style.opacity = opacity;
        edgeEl.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

        // Count label (overview only)
        let countEl = edgeEl.querySelector('.graph-edge-count-div');
        if (posCount > 0 && !graphState.activeEdge) {
            if (!countEl) {
                countEl = el('span', { className: 'graph-edge-count-div' });
                edgeEl.appendChild(countEl);
            }
            countEl.textContent = posCount;
        } else if (countEl) {
            countEl.remove();
        }
    });
    } // end edge rendering skip check

    // Edge-only mode: skip node and panel rendering (used during transition tracking)
    if (renderGraphView._edgeOnly) return;

    // ---- Agent nodes: create on first render, then update positions in place ----
    nodePositions.forEach(nodePos => {
        const agentID = nodePos.id;
        const name = shortAgentID(agentID);

        let totalMessages = 0;
        let activeGemots = 0;
        graph.edges.forEach(edge => {
            if (edge.a === agentID || edge.b === agentID) {
                const ds = scrubTime ? filterToTime(delibs[edge.delibID], scrubTime) : delibs[edge.delibID];
                const pc = (ds?.positions || []).length;
                totalMessages += pc;
                if (pc > 0) activeGemots++;
            }
        });

        const isEdgeAgent = graphState.activeEdge && graph.edges.some(e =>
            e.delibID === graphState.activeEdge && (e.a === agentID || e.b === agentID));

        // Try to find existing node to update in place (smooth transition)
        let node = canvas.querySelector(`.graph-node[data-agent-id="${agentID}"]`);
        if (node) {
            // Update position (CSS transition handles animation)
            node.style.left = `${nodePos.x}%`;
            node.style.top = `${nodePos.y}%`;
            node.className = `graph-node ${isEdgeAgent ? 'graph-node-active' : ''} ${activeGemots === 0 ? 'graph-node-quiet' : ''}`;
            // Update stats
            const statsEl = node.querySelector('.graph-node-stats');
            if (activeGemots > 0) {
                if (statsEl) statsEl.textContent = `${totalMessages} msg · ${activeGemots} gemots`;
                else node.appendChild(el('div', { className: 'graph-node-stats' }, `${totalMessages} msg · ${activeGemots} gemots`));
            } else if (statsEl) {
                statsEl.remove();
            }
        } else {
            // First render: create node
            node = el('div', {
                className: `graph-node ${isEdgeAgent ? 'graph-node-active' : ''} ${activeGemots === 0 ? 'graph-node-quiet' : ''}`,
                style: `left:${nodePos.x}%; top:${nodePos.y}%;`,
                dataset: { agentId: agentID },
            },
                el('div', { className: 'graph-node-icon' }, name.charAt(0).toUpperCase()),
                el('div', { className: 'graph-node-name' }, name),
                activeGemots > 0 ? el('div', { className: 'graph-node-stats' }, `${totalMessages} msg · ${activeGemots} gemots`) : null,
            );
            canvas.appendChild(node);
        }
    });

    // Center panel: show for the active deliberation (bilateral or group)
    const centerPanel = document.getElementById('center-panel');
    const topicEl = document.querySelector('.topic-label');

    if (graphState.activeEdge && delibs[graphState.activeEdge]) {
        const rawDs = delibs[graphState.activeEdge];
        const ds = scrubTime ? filterToTime(rawDs, scrubTime) : rawDs;

        const hasContent = (ds.positions || []).length > 0 || ds.analysis;
        if (!hasContent) {
            centerPanel.classList.add('hidden');
        }
        renderCenterPanel(ds);

        if (topicEl) {
            const rawAgents = (rawDs.agents || []).map(a => shortAgentID(a.id));
            if (rawAgents.length <= 3) {
                topicEl.textContent = rawAgents.join(' \u2194 ');
            } else {
                topicEl.textContent = rawDs.deliberation?.topic || 'Group Deliberation';
            }
        }

        // Footer: cruxes only appear after the analyze op has been revealed
        // (cruxes are output of analysis, not available before it runs)
        document.getElementById('footer')?.classList.remove('hidden');
        document.getElementById('analysis-bar')?.classList.remove('hidden');
        renderAnalysisBar(ds);
        renderCruxPanel(ds);
        renderMetrics(ds);
        renderAuditLog(ds);
    } else {
        // Graph overview: no panel, no footer — just the graph
        centerPanel.classList.add('hidden');
        document.getElementById('footer')?.classList.add('hidden');
        document.getElementById('analysis-bar')?.classList.add('hidden');
        if (topicEl) topicEl.textContent = `${graph.nodes.length} Agents \u00b7 ${graph.edges.length} Gemots`;
    }

    const roundEl = document.getElementById('round-display');
    if (roundEl) roundEl.textContent = '';
    const templateEl = document.getElementById('template-display');
    if (templateEl) templateEl.textContent = '';

    // On first render, nodes have no layout yet — schedule an edge re-render after paint
    if (isFirstRender) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                renderGraphView._edgeOnly = true;
                renderGraphView(graph);
                renderGraphView._edgeOnly = false;
            });
        });
    }
}

// ===== Multi-View =====

const OVERVIEW_RETURN_DELAY = 8000; // ms before returning to overview
const FOCUS_TRANSITION_MS = 800;

function focusOnDelib(delibID) {
    state.focusedDelibID = delibID;

    const screen = document.getElementById('screen');
    screen.dataset.state = 'focusing';
    setTimeout(() => {
        const active = state.deliberations[state.activeDelibID];
        screen.dataset.state = active?.deliberation?.status === 'analyzing' ? 'analyzing' : 'normal';
    }, FOCUS_TRANSITION_MS);

    render();

    clearTimeout(focusTimer);
    focusTimer = setTimeout(zoomToOverview, OVERVIEW_RETURN_DELAY);
}

function zoomToOverview() {
    state.focusedDelibID = null;
    graphState.activeEdge = null;
    graphState.activeNode = null;
    document.getElementById('agents')?.classList.add('hidden');
    document.getElementById('connections')?.classList.add('hidden');
    document.getElementById('center-panel')?.classList.add('hidden');
    document.getElementById('footer')?.classList.add('hidden');
    document.getElementById('analysis-bar')?.classList.add('hidden');
    document.getElementById('main').className = 'graph-view';
    render();
}

function onActivity(delibID) {
    if (!state.multiView) return;
    state.lastActivity[delibID] = Date.now();
}

// Stubs for removed demo loop (referenced in scrubber/click handlers)
function stopDemoLoop() {}
function startDemoLoop() {}

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
            trimLargeData(state.deliberations);
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

const VALID_THEMES = ['magi', 'minimal', 'gastown'];

function applyTheme() {
    const params = new URLSearchParams(window.location.search);
    const theme = params.get('theme');
    const screen = document.getElementById('screen');
    const active = (theme && VALID_THEMES.includes(theme)) ? theme : 'minimal';

    screen.classList.add(`theme-${active}`);
    document.body.classList.add(`boot-${active}`);

    const bgMap = { magi: '#050505', minimal: '#f5f5f5', gastown: '#e8dcc8' };
    document.body.style.background = bgMap[active] || '#f5f5f5';

    VOTE_LABELS = active === 'magi' ? VOTE_LABELS_MAGI : VOTE_LABELS_MINIMAL;
    STATUS = STATUS_LABELS[active] || STATUS_LABELS.minimal;

    // Load web fonts per theme
    if (active === 'minimal') {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';
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
            minimal: [
                'Gemot',
            ],
            gastown: [
                '-- GEMOT --',
                'WASTELAND DISPATCH',
                'DELIBERATION ENGINE ONLINE',
            ],
        };
        const lines = BOOT_CONTENT[active] || BOOT_CONTENT.minimal;
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
const bootDelay = activeTheme === 'magi' ? 3200 : activeTheme === 'gastown' ? 2000 : 1200;
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
        { id: 'minimal', label: 'Minimal', desc: 'Clean modern' },
        { id: 'magi', label: 'MAGI', desc: 'CRT / EVA' },
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

    const themePreview = el('div', { className: 'landing-theme-preview', id: 'theme-preview' },
        themes.find(t => t.id === activeTheme)?.desc || '');

    themeSelect.addEventListener('change', () => {
        const selected = themes.find(t => t.id === themeSelect.value);
        const preview = document.getElementById('theme-preview');
        if (preview && selected) {
            const descs = {
                magi: 'Evangelion CRT terminal with scanlines, kanji votes, and amber glow',
                minimal: 'Clean modern dashboard inspired by Linear and Vercel',
                gastown: 'Steampunk control room with brass pipes and industrial warmth',
            };
            preview.textContent = descs[selected.id] || selected.desc;
        }
    });

    const demoBtn = el('button', {
        className: 'landing-go-btn landing-demo-btn',
        onclick: () => {
            const url = new URL(window.location);
            const theme = themeSelect.value;
            if (theme === 'minimal') url.searchParams.delete('theme');
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
                themePreview,
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
            // Direct gemot SSE sends lightweight events — debounced state re-fetch
            if (gemotSSE && msg.type !== 'ping' && msg.type !== 'connected') {
                clearTimeout(directSSEFetchTimer);
                directSSEFetchTimer = setTimeout(() => {
                    fetch(`/api/watch/${primary}/state`)
                        .then(r => r.json())
                        .then(snap => {
                            if (snap.deliberations) {
                                Object.assign(state.deliberations, snap.deliberations);
                                trimLargeData(state.deliberations);
                                render();
                            }
                        })
                        .catch(() => {});
                }, 500); // debounce rapid events
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
                        trimLargeData(state.deliberations);
                        onActivity(msg.data.deliberation.deliberation_id);
                        render();
                    } else if (msg.type === 'snapshot' && msg.data?.deliberations) {
                        Object.assign(state.deliberations, msg.data.deliberations);
                        trimLargeData(state.deliberations);
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

// Delegated click handler for multi-view regions and graph edges (survives DOM rebuilds)
document.getElementById('main').addEventListener('click', (e) => {
    // Graph edge click (hit area or visible line)
    const edgeEl = e.target.closest('.graph-edge-div');
    if (edgeEl && state.multiView) {
        const delibId = edgeEl.getAttribute('data-delib-id');
        if (delibId) {
            if (graphState.activeEdge === delibId) {
                // Double-click: zoom into full single-view for this bilateral
                state.cyclePaused = true;
                stopScrubberPlay();
                focusOnDelib(delibId);
            } else {
                // Single click: show chat for this edge
                graphState.activeEdge = delibId;
                state.cyclePaused = true;
                stopScrubberPlay();
                render();
            }
            return;
        }
    }

    // Graph node click: toggle group delib view
    const nodeEl = e.target.closest('.graph-node');
    if (nodeEl && state.multiView) {
        const graph = buildGraphFromDelibs(state.deliberations);
        if (graph?.groupDelibID) {
            graphState.activeEdge = null;
            graphState.activeNode = nodeEl.dataset.agentId;
            // Show group delib in center panel
            render();
        }
        return;
    }

});

// Hover handler for graph edges
document.getElementById('main').addEventListener('mouseover', (e) => {
    const edgeEl = e.target.closest('.graph-edge-div');
    if (edgeEl) {
        graphState.hoverEdge = edgeEl.getAttribute('data-delib-id');
        // Highlight matching visible edge
        document.querySelectorAll('.graph-edge-div').forEach(el => {
            el.classList.toggle('graph-edge-hover',
                el.getAttribute('data-delib-id') === graphState.hoverEdge);
        });
    }
});
document.getElementById('main').addEventListener('mouseout', (e) => {
    const edgeEl = e.target.closest('.graph-edge-div');
    if (edgeEl) {
        graphState.hoverEdge = null;
        document.querySelectorAll('.graph-edge-div.graph-edge-hover').forEach(el => el.classList.remove('graph-edge-hover'));
    }
});
