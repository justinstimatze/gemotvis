// GEMOTVIS — MAGI-style deliberation monitor
// Main application controller

const VOTE_LABELS = { 1: '承認', '-1': '否定', 0: '保留' };
const VOTE_CLASSES = { 1: 'vote-approve', '-1': 'vote-deny', 0: 'vote-pass' };

const PIPELINE_STAGES = ['taxonomy', 'extracting', 'deduplicating', 'crux_detection', 'summarizing', 'complete'];

const MAGI_NAMES = ['MELCHIOR', 'BALTHASAR', 'CASPER'];
const CLUSTER_COLORS = ['cluster-0', 'cluster-1', 'cluster-2', 'cluster-3', 'cluster-4', 'cluster-5'];

// State
let state = {
    deliberations: {},
    activeDelibID: null,
    connected: false,
    cyclePaused: false,  // true when user manually clicks a tab
    cycleInterval: 0,    // ms, from server config
    mode: 'live',        // 'demo' | 'replay' | 'live'
};

let eventSource = null;
let cycleProgressTimer = null;
let previousVotes = {}; // agentID -> vote value, for detecting changes
let knownAgents = new Set(); // for detecting new agents

// ===== Safe DOM Helpers =====

function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'className') e.className = v;
            else if (k === 'style') e.setAttribute('style', v);
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
            if (!state.activeDelibID) {
                const ids = Object.keys(state.deliberations);
                if (ids.length > 0) state.activeDelibID = ids[0];
            }
            render();
            break;

        case 'state': {
            const ds = msg.data;
            if (ds && ds.deliberation) {
                state.deliberations[ds.deliberation.deliberation_id] = ds;
                render();
            }
            break;
        }

        case 'cycle':
            if (!state.cyclePaused) {
                cycleNext();
                resetCycleProgress();
            }
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

// ===== Rendering =====

function render() {
    const delibs = state.deliberations;
    const ids = Object.keys(delibs);

    renderDelibNav(ids, delibs);

    const active = delibs[state.activeDelibID];
    if (!active) {
        const main = document.getElementById('main');
        clearChildren(main);
        main.appendChild(el('div', { className: 'empty-state' }, 'AWAITING DELIBERATION DATA'));
        return;
    }

    renderHeader(active);
    renderAnalysisBar(active);
    renderAgents(active);
    renderConnections(active);
    renderCenterPanel(active);
    renderCruxPanel(active);
    renderMetrics(active);
    renderAuditLog(active);
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
        status.textContent = 'ANALYZING';
        status.className = 'status-indicator analyzing';
    } else if (state.connected) {
        status.textContent = d.status === 'closed' ? 'CLOSED' : 'ONLINE';
        status.className = 'status-indicator online';
    } else {
        status.textContent = 'OFFLINE';
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
        const name = (n === 3 && i < 3) ? MAGI_NAMES[i] : shortAgentID(agent.id);
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
                el('span', { style: 'color:var(--magi-text-dim);margin-left:8px;' }, agent.model_family || ''),
            ),
            el('div', { className: 'tooltip-body' }, tooltipContent),
            el('div', { className: 'tooltip-footer' },
                el('span', {}, `CONVICTION: ${(conviction * 100).toFixed(0)}%`),
                trust < 1 ? el('span', { style: 'margin-left:8px;' }, `TRUST: ${(trust * 100).toFixed(0)}%`) : null,
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
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', positions[i].x * rect.width);
            line.setAttribute('y1', positions[i].y * rect.height);
            line.setAttribute('x2', positions[j].x * rect.width);
            line.setAttribute('y2', positions[j].y * rect.height);
            line.setAttribute('class', `connection-line connection-${rel}`);
            svg.appendChild(line);
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
        content.appendChild(el('div', { style: 'margin-bottom:6px;color:var(--magi-green);font-size:10px;' }, 'CONSENSUS'));
        consensus.forEach(c => {
            content.appendChild(el('div', { style: 'margin-bottom:4px;font-size:10px;text-transform:none;' }, truncate(c.content, 120)));
        });
    }
    if (bridging.length > 0) {
        content.appendChild(el('div', { style: 'margin-top:6px;margin-bottom:4px;color:#ffd700;font-size:10px;' }, 'BRIDGING'));
        bridging.forEach(b => {
            const score = el('span', { style: 'color:var(--magi-text-dim)' }, ` (${(b.bridging_score * 100).toFixed(0)}%)`);
            const div = el('div', { style: 'margin-bottom:4px;font-size:10px;text-transform:none;' }, truncate(b.content, 100));
            div.appendChild(score);
            content.appendChild(div);
        });
    }
    if (analysis.compromise_proposal) {
        content.appendChild(el('div', { style: 'margin-top:6px;margin-bottom:4px;color:var(--magi-cyan);font-size:10px;' }, 'COMPROMISE'));
        content.appendChild(el('div', { style: 'font-size:10px;text-transform:none;' }, truncate(analysis.compromise_proposal, 200)));
    }
}

function renderCruxPanel(ds) {
    const list = document.getElementById('crux-list');
    const cruxes = ds.analysis?.cruxes || [];
    clearChildren(list);

    if (cruxes.length === 0) {
        list.appendChild(el('div', { style: 'color:var(--magi-text-dim);padding:8px;' }, 'NO CRUXES DETECTED'));
        return;
    }

    cruxes.forEach(c => {
        const controversyFill = el('span', {
            className: 'controversy-fill',
            style: `width:${(c.controversy_score * 100)}%`,
        });
        const controversyBar = el('span', { className: 'controversy-bar' }, controversyFill);

        const meta = el('div', { className: 'crux-meta' },
            el('span', {}, c.crux_type || 'mixed'),
            el('span', {}, ''),
            el('span', { style: 'color:var(--magi-green)' }, `+${(c.agree_agents || []).length}`),
            el('span', { style: 'color:var(--magi-red)' }, `-${(c.disagree_agents || []).length}`),
        );
        // Insert controversy bar after type
        meta.children[1].appendChild(controversyBar);
        meta.children[1].appendChild(document.createTextNode(` ${(c.controversy_score * 100).toFixed(0)}%`));

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
        { value: a ? `${(a.participation_rate * 100).toFixed(0)}%` : '--', label: 'PARTICIPATION' },
        { value: a ? `${(a.perspective_diversity * 100).toFixed(0)}%` : '--', label: 'DIVERSITY' },
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
        log.appendChild(el('div', { style: 'color:var(--magi-text-dim);padding:4px;' }, 'NO EVENTS'));
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
    return name.length > 12 ? name.slice(0, 12) + '..' : name;
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
    const rx = 30;
    const ry = 28;
    return {
        x: 50 + rx * Math.cos(angle),
        y: 45 + ry * Math.sin(angle),
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

function updateConnectionStatus() {
    const status = document.getElementById('connection-status');
    if (state.connected) {
        status.textContent = 'ONLINE';
        status.className = 'status-indicator online';
    } else {
        status.textContent = 'OFFLINE';
        status.className = 'status-indicator offline';
    }
}

// ===== Init =====

// Remove boot overlay after its CSS animation completes
setTimeout(() => {
    const boot = document.getElementById('boot');
    if (boot) boot.classList.add('done');
}, 3200);

loadConfig().then(() => connect());

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
});
