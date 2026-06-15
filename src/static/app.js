async function loadSidebar() {
    const sessions = await (await fetch('/api/sessions')).json();
    const sidebar = document.getElementById('sidebar');
    for (const s of sessions) {
        const div = document.createElement('div');
        div.className = 'item';
        div.textContent = s.title || s.id;
        div.onclick = () => showDetail(s.id, div);
        sidebar.appendChild(div);
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
