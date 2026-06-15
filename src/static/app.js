const GROUPS = ["Today", "This week", "This month", "Later"];

function groupFor(date, startOfToday) {
    const day = 24 * 60 * 60 * 1000;
    if (date >= startOfToday) return "Today";
    if (date >= startOfToday - 7 * day) return "This week";
    if (date >= startOfToday - 30 * day) return "This month";
    return "Later";
}

async function loadSidebar() {
    const sessions = await (await fetch('/api/sessions')).json();
    const sidebar = document.getElementById('sidebar');

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // bucket by group, using last_modified (fallback to creation_date)
    const buckets = {};
    for (const g of GROUPS) buckets[g] = [];
    for (const s of sessions) {
        const ts = s.last_modified || s.creation_date;
        s._ts = ts ? new Date(ts).getTime() : 0;
        buckets[groupFor(s._ts, startOfToday)].push(s);
    }

    for (const g of GROUPS) {
        const items = buckets[g];
        if (items.length === 0) continue;
        items.sort((a, b) => b._ts - a._ts);  // most recent first

        const header = document.createElement('h2');
        header.className = 'group-header';
        header.textContent = g;
        sidebar.appendChild(header);

        for (const s of items) {
            const div = document.createElement('div');
            div.className = 'item';
            div.textContent = s.title || s.id;
            div.onclick = () => showDetail(s.id, div);
            sidebar.appendChild(div);
        }
    }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function renderTimelineTable(blocks) {
    const rows = blocks.map(b => {
        const content = typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2);
        return '<tr>' +
            '<td>' + escapeHtml(b.start_time) + '</td>' +
            '<td>' + escapeHtml(b.end_time) + '</td>' +
            '<td>' + escapeHtml(b.type) + '</td>' +
            '<td>' + escapeHtml(b.title) + '</td>' +
            '<td><pre>' + escapeHtml(content) + '</pre></td>' +
            '</tr>';
    }).join('');
    return '<table class="timeline">' +
        '<thead><tr><th>Start</th><th>End</th><th>Type</th><th>Title</th><th>Content</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
}

let timelineInstance = null;

// each distinct tool name gets its own lane (e.g. Bash, WebSearch), keyed "tool:<name>"
function toolGroupId(b) {
    return 'tool:' + (b.title || 'tool');
}

// parent sections (collapsible) and the child lanes nested under each.
// groups MUST be a vis.DataSet for collapse/expand to work.
function buildGroups(blocks) {
    const toolNames = [...new Set(
        blocks.filter(b => b.type === 'tool_call').map(b => b.title || 'tool')
    )].sort();
    const toolGroups = toolNames.map(name => ({ id: 'tool:' + name, content: name }));

    return new vis.DataSet([
        { id: 'agent', content: 'Agent', nestedGroups: ['thinking', 'assistant_message'] },
        { id: 'thinking', content: 'Thinking' },
        { id: 'assistant_message', content: 'Assistant' },
        { id: 'user', content: 'User', nestedGroups: ['user_message'] },
        { id: 'user_message', content: 'Message' },
        { id: 'tools', content: 'Tools', nestedGroups: [...toolGroups.map(g => g.id), 'attachment'] },
        ...toolGroups,
        { id: 'attachment', content: 'Attachment' },
    ]);
}

function renderTimeline(container, blocks) {
    if (timelineInstance) {
        timelineInstance.destroy();
        timelineInstance = null;
    }

    const items = new vis.DataSet(blocks.map((b, i) => {
        // enforce a minimum duration so zero-length blocks (e.g. attachments) stay visible
        let end = b.end_time;
        if (!end || end === b.start_time) {
            end = new Date(new Date(b.start_time).getTime() + 1000).toISOString();
        }
        return {
            id: i,
            group: b.type === 'tool_call' ? toolGroupId(b) : b.type,
            content: escapeHtml(b.title || b.type),
            start: b.start_time,
            end: end,
            className: 'tl-' + b.type,
        };
    }));

    const groups = buildGroups(blocks);

    const options = {
        stack: true,
        horizontalScroll: true,   // mouse wheel pans horizontally
        zoomKey: 'ctrlKey',       // ctrl + wheel zooms
        margin: { item: 6 },
        orientation: { axis: 'top' },
        // height set dynamically below to fill the browser viewport
    };

    timelineInstance = new vis.Timeline(container, items, groups, options);

    // size the timeline to fill the viewport from its top edge down, and keep it
    // in sync on window resize. taller sessions scroll vertically inside it.
    const fillViewport = () => {
        const top = container.getBoundingClientRect().top;
        const height = Math.max(300, window.innerHeight - top - 16);
        timelineInstance.setOptions({ height });
    };
    fillViewport();
    window.onresize = fillViewport;

    requestAnimationFrame(() => timelineInstance.fit());  // fit after the DOM settles

    timelineInstance.on('select', props => {
        const id = props.items[0];
        if (id === undefined) return;   // collapse-arrow clicks fire with no item
        renderBlockDetail(blocks[id]);
    });
}

function renderBlockDetail(b) {
    const panel = document.getElementById('block-detail');
    if (!panel || !b) return;
    const content = typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2);
    panel.innerHTML =
        '<div class="bd-head">' +
            '<span class="bd-type tl-' + escapeHtml(b.type) + '">' + escapeHtml(b.type) + '</span>' +
            '<b>' + escapeHtml(b.title || '') + '</b>' +
            '<span class="bd-time">' + escapeHtml(b.start_time) + ' &rarr; ' + escapeHtml(b.end_time) + '</span>' +
        '</div>' +
        '<pre>' + escapeHtml(content) + '</pre>';
}

async function showDetail(id, el) {
    document.querySelectorAll('.item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');

    const [dataRes, timelineRes] = await Promise.all([
        fetch('/api/sessions/' + id),
        fetch('/api/sessions/' + id + '/timeline'),
    ]);
    const data = await dataRes.json();
    const blocks = await timelineRes.json();

    document.getElementById('detail').innerHTML =
        '<h3>Timeline</h3>' +
        '<div id="timeline"></div>' +
        '<div id="block-detail">Click a block to see its full content.</div>' +
        '<h3>Events</h3>' +
        renderTimelineTable(blocks) +
        '<h3>Details</h3>' +
        '<pre>' + JSON.stringify(data, null, 2) + '</pre>';

    renderTimeline(document.getElementById('timeline'), blocks);
}

loadSidebar();
