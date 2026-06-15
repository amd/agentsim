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

async function showDetail(id, el) {
    document.querySelectorAll('.item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    const data = await (await fetch('/api/sessions/' + id)).json();
    document.getElementById('detail').innerHTML =
        '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
}

loadSidebar();
