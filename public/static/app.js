// 村田鉄筋㈱ 取付数量分析アプリ - フロントエンド
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const fmt = (n, d = 0) => {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return Number(n).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) });
  };
  const fmtKg = (n) => fmt(n, 0);
  const fmtMp = (n) => fmt(n, 1);

  // ---------- Toast ----------
  function toast(msg, type = 'info') {
    const t = $('#toast');
    const body = $('#toast-body');
    body.textContent = msg;
    body.className = `text-white text-sm px-4 py-2 rounded-full shadow-lg ${
      type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-700' : 'bg-slate-900'
    }`;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  // ---------- API helper ----------
  const api = {
    get: (path) => axios.get('/api' + path).then(r => r.data),
    post: (path, data) => axios.post('/api' + path, data).then(r => r.data),
    put: (path, data) => axios.put('/api' + path, data).then(r => r.data),
    del: (path) => axios.delete('/api' + path).then(r => r.data),
  };

  // ---------- State ----------
  const state = {
    parts: [],
    suggestions: { contractors: [], sites: [], workers: [] },
    workers: [], // 入力中の人員チップ
    editingId: null,
    charts: {},
    listData: [],
  };

  // ---------- Tabs ----------
  function showTab(name) {
    $$('.tab-pane').forEach(p => p.classList.add('hidden'));
    $('#tab-' + name)?.classList.remove('hidden');
    $$('.tab-btn').forEach(b => {
      const active = b.dataset.tab === name;
      b.classList.toggle('border-yellow-400', active);
      b.classList.toggle('border-transparent', !active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('text-white/80', !active);
    });
    if (name === 'dashboard') loadDashboard();
    if (name === 'analysis') loadAnalysis();
    if (name === 'list') loadList();
    if (name === 'settings') loadParts(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#quick-add-btn').addEventListener('click', () => { resetForm(); showTab('input'); });

  // ---------- Suggestions / Parts ----------
  async function refreshMasters() {
    const [parts, sugg] = await Promise.all([api.get('/parts'), api.get('/suggestions')]);
    state.parts = parts;
    state.suggestions = sugg;
    // 部位 select
    $('#f-part').innerHTML = parts.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
    // datalist
    $('#dl-contractors').innerHTML = sugg.contractors.map(v => `<option value="${escapeHtml(v)}">`).join('');
    $('#dl-sites').innerHTML = sugg.sites.map(v => `<option value="${escapeHtml(v)}">`).join('');
    $('#dl-workers').innerHTML = sugg.workers.map(v => `<option value="${escapeHtml(v)}">`).join('');
    // 分析画面のフィルタ
    const cSel = $('#an-contractor'), sSel = $('#an-site');
    cSel.innerHTML = '<option value="">すべて</option>' + sugg.contractors.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    sSel.innerHTML = '<option value="">すべて</option>' + sugg.sites.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  }

  // ---------- Form ----------
  function resetForm() {
    state.editingId = null;
    state.workers = [];
    $('#f-id').value = '';
    $('#f-date').value = dayjs().format('YYYY-MM-DD');
    $('#f-contractor').value = '';
    $('#f-site').value = '';
    $('#f-qty').value = '';
    $('#f-mp').value = '';
    $('#f-note').value = '';
    $('#f-worker-input').value = '';
    $('#f-submit-label').textContent = '登録する';
    renderWorkerChips();
  }

  function renderWorkerChips() {
    const c = $('#worker-chips');
    if (!state.workers.length) {
      c.innerHTML = '<span class="text-xs text-slate-400">未入力</span>';
      return;
    }
    c.innerHTML = state.workers.map((w, i) =>
      `<span class="chip">${escapeHtml(w)}<button type="button" data-i="${i}" aria-label="削除">×</button></span>`
    ).join('');
    c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.workers.splice(Number(b.dataset.i), 1);
      renderWorkerChips();
    }));
  }

  $('#add-worker-btn').addEventListener('click', addWorker);
  $('#f-worker-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addWorker(); }
  });
  function addWorker() {
    const input = $('#f-worker-input');
    const name = (input.value || '').trim();
    if (!name) return;
    if (!state.workers.includes(name)) state.workers.push(name);
    input.value = '';
    input.focus();
    renderWorkerChips();
  }

  $('#f-reset').addEventListener('click', resetForm);

  $('#install-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      work_date: $('#f-date').value,
      contractor: $('#f-contractor').value.trim(),
      site_name: $('#f-site').value.trim(),
      part: $('#f-part').value,
      quantity: parseFloat($('#f-qty').value),
      manpower: parseFloat($('#f-mp').value),
      note: $('#f-note').value,
      workers: state.workers.slice(),
    };
    if (!payload.work_date || !payload.contractor || !payload.site_name || !payload.part) {
      toast('必須項目を入力してください', 'error'); return;
    }
    if (!(payload.quantity >= 0) || !(payload.manpower >= 0)) {
      toast('数量・人員数を正しく入力してください', 'error'); return;
    }
    try {
      if (state.editingId) {
        await api.put('/installations/' + state.editingId, payload);
        toast('更新しました', 'success');
      } else {
        await api.post('/installations', payload);
        toast('登録しました', 'success');
      }
      resetForm();
      await refreshMasters();
      showTab('list');
    } catch (err) {
      console.error(err);
      toast('保存に失敗しました', 'error');
    }
  });

  // ---------- Dashboard ----------
  async function loadDashboard() {
    const q = new URLSearchParams();
    if ($('#dash-from').value) q.set('from', $('#dash-from').value);
    if ($('#dash-to').value) q.set('to', $('#dash-to').value);
    const d = await api.get('/analytics/dashboard?' + q.toString());
    const total = d.total || { total_qty: 0, total_mp: 0 };
    $('#kpi-total-qty').textContent = fmtKg(total.total_qty);
    $('#kpi-total-mp').textContent = fmtMp(total.total_mp);
    const perMp = total.total_mp > 0 ? total.total_qty / total.total_mp : 0;
    $('#kpi-per-mp').textContent = fmtKg(perMp);

    drawBar('chart-contractor', d.byContractor, '#2563eb');
    drawBar('chart-site', d.bySite, '#0d9488', (r) => `${r.name}（${r.contractor}）`);
    drawBar('chart-part', d.byPart, '#7c3aed');
    drawBar('chart-worker', d.byWorker, '#16a34a');
  }
  $('#dash-apply').addEventListener('click', loadDashboard);
  $('#dash-clear').addEventListener('click', () => {
    $('#dash-from').value = ''; $('#dash-to').value = ''; loadDashboard();
  });

  function drawBar(canvasId, rows, color, labelFn) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (state.charts[canvasId]) state.charts[canvasId].destroy();
    const data = rows || [];
    const labels = data.map(r => labelFn ? labelFn(r) : r.name);
    const values = data.map(r => Math.round(Number(r.qty) || 0));
    state.charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: '取付数量(kg)', data: values, backgroundColor: color, borderRadius: 4 }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => fmt(ctx.parsed.x) + ' kg' } } },
        scales: { x: { ticks: { callback: (v) => fmt(v) } } }
      }
    });
  }

  // ---------- Analysis ----------
  async function loadAnalysis() {
    const q = currentAnalysisQuery();
    const [sites, details] = await Promise.all([
      api.get('/analytics/sites?' + q),
      api.get('/installations?' + q),
    ]);

    // サマリカード
    let totalQty = 0, totalMp = 0;
    sites.forEach(s => { totalQty += s.total_qty; totalMp += s.total_mp; });
    const per = totalMp > 0 ? totalQty / totalMp : 0;
    $('#an-summary').innerHTML = `
      <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">合計数量</div><div class="text-xl font-bold text-blue-700">${fmtKg(totalQty)} <span class="text-xs font-normal">kg</span></div></div>
      <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">合計人工数</div><div class="text-xl font-bold text-green-700">${fmtMp(totalMp)} <span class="text-xs font-normal">人工</span></div></div>
      <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">1人工あたり</div><div class="text-xl font-bold text-orange-600">${fmtKg(per)} <span class="text-xs font-normal">kg/人工</span></div></div>
    `;

    // 現場別サマリ表
    $('#an-site-summary').innerHTML = sites.length === 0
      ? '<tr><td colspan="6" class="text-center text-slate-400 py-4">データがありません</td></tr>'
      : sites.map(s => {
          const p = s.total_mp > 0 ? s.total_qty / s.total_mp : 0;
          return `<tr class="border-t">
            <td class="px-2 py-2">${escapeHtml(s.contractor)}</td>
            <td class="px-2 py-2 font-semibold">${escapeHtml(s.site_name)}</td>
            <td class="px-2 py-2 text-right">${s.work_days}</td>
            <td class="px-2 py-2 text-right">${fmtKg(s.total_qty)}</td>
            <td class="px-2 py-2 text-right">${fmtMp(s.total_mp)}</td>
            <td class="px-2 py-2 text-right font-bold text-orange-600">${fmtKg(p)}</td>
          </tr>`;
        }).join('');

    // 明細
    $('#an-detail').innerHTML = details.length === 0
      ? '<tr><td colspan="7" class="text-center text-slate-400 py-4">データがありません</td></tr>'
      : details.map(d => `<tr class="border-t">
          <td class="px-2 py-2">${d.work_date}</td>
          <td class="px-2 py-2">${escapeHtml(d.contractor)}</td>
          <td class="px-2 py-2">${escapeHtml(d.site_name)}</td>
          <td class="px-2 py-2">${escapeHtml(d.part)}</td>
          <td class="px-2 py-2 text-right">${fmtKg(d.quantity)}</td>
          <td class="px-2 py-2 text-right">${fmtMp(d.manpower)}</td>
          <td class="px-2 py-2 text-xs">${(d.workers || []).map(escapeHtml).join('、')}</td>
        </tr>`).join('');

    state.analysisData = { sites, details };
  }

  function currentAnalysisQuery() {
    const q = new URLSearchParams();
    if ($('#an-from').value) q.set('from', $('#an-from').value);
    if ($('#an-to').value) q.set('to', $('#an-to').value);
    if ($('#an-contractor').value) q.set('contractor', $('#an-contractor').value);
    if ($('#an-site').value) q.set('site', $('#an-site').value);
    return q.toString();
  }
  $('#an-apply').addEventListener('click', loadAnalysis);
  $('#an-export').addEventListener('click', () => {
    if (!state.analysisData) return;
    const rows = [['日付', '元請', '現場名', '部位', '数量(kg)', '人員数', '人員名', '備考']];
    state.analysisData.details.forEach(d => rows.push([
      d.work_date, d.contractor, d.site_name, d.part, d.quantity, d.manpower,
      (d.workers || []).join(' / '), d.note || ''
    ]));
    rows.push([]);
    rows.push(['【現場別サマリ】']);
    rows.push(['元請', '現場名', '取付日数', '合計数量(kg)', '合計人工数', '1人工あたり(kg/人工)']);
    state.analysisData.sites.forEach(s => {
      const p = s.total_mp > 0 ? s.total_qty / s.total_mp : 0;
      rows.push([s.contractor, s.site_name, s.work_days, s.total_qty, s.total_mp, Math.round(p)]);
    });
    downloadCsv('analysis_' + dayjs().format('YYYYMMDD_HHmm') + '.csv', rows);
  });

  // ---------- List ----------
  async function loadList() {
    const search = $('#list-search').value.trim();
    const q = search ? '?search=' + encodeURIComponent(search) : '';
    const data = await api.get('/installations' + q);
    state.listData = data;
    $('#list-body').innerHTML = data.length === 0
      ? '<tr><td colspan="8" class="text-center text-slate-400 py-6">データがありません</td></tr>'
      : data.map(d => `<tr class="border-t">
          <td class="px-2 py-2">${d.work_date}</td>
          <td class="px-2 py-2">${escapeHtml(d.contractor)}</td>
          <td class="px-2 py-2">${escapeHtml(d.site_name)}</td>
          <td class="px-2 py-2">${escapeHtml(d.part)}</td>
          <td class="px-2 py-2 text-right">${fmtKg(d.quantity)}</td>
          <td class="px-2 py-2 text-right">${fmtMp(d.manpower)}</td>
          <td class="px-2 py-2 text-xs">${(d.workers || []).map(escapeHtml).join('、')}</td>
          <td class="px-2 py-2 text-center whitespace-nowrap">
            <button class="btn-mini btn-edit" data-edit="${d.id}"><i class="fas fa-edit"></i></button>
            <button class="btn-mini btn-del" data-del="${d.id}"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`).join('');
    $$('#list-body [data-edit]').forEach(b => b.addEventListener('click', () => editRecord(b.dataset.edit)));
    $$('#list-body [data-del]').forEach(b => b.addEventListener('click', () => delRecord(b.dataset.del)));
  }
  $('#list-search').addEventListener('input', debounce(loadList, 250));
  $('#list-export').addEventListener('click', () => {
    if (!state.listData.length) { toast('データがありません'); return; }
    const rows = [['日付', '元請', '現場名', '部位', '数量(kg)', '人員数', '人員名', '備考']];
    state.listData.forEach(d => rows.push([
      d.work_date, d.contractor, d.site_name, d.part, d.quantity, d.manpower,
      (d.workers || []).join(' / '), d.note || ''
    ]));
    downloadCsv('installations_' + dayjs().format('YYYYMMDD_HHmm') + '.csv', rows);
  });

  async function editRecord(id) {
    const d = await api.get('/installations/' + id);
    state.editingId = d.id;
    state.workers = d.workers || [];
    $('#f-id').value = d.id;
    $('#f-date').value = d.work_date;
    $('#f-contractor').value = d.contractor;
    $('#f-site').value = d.site_name;
    $('#f-part').value = d.part;
    $('#f-qty').value = d.quantity;
    $('#f-mp').value = d.manpower;
    $('#f-note').value = d.note || '';
    $('#f-submit-label').textContent = '更新する';
    renderWorkerChips();
    showTab('input');
  }
  async function delRecord(id) {
    if (!confirm('このデータを削除します。よろしいですか？')) return;
    await api.del('/installations/' + id);
    toast('削除しました', 'success');
    await refreshMasters();
    loadList();
  }

  // ---------- Parts settings ----------
  async function loadParts(refresh) {
    if (refresh) await refreshMasters();
    const ul = $('#part-list');
    ul.innerHTML = state.parts.map(p => `
      <li class="flex items-center gap-2 px-3 py-2">
        <input type="text" value="${escapeHtml(p.name)}" data-pid="${p.id}" class="part-name flex-1 border rounded px-2 py-1 text-sm" />
        <button data-save="${p.id}" class="btn-mini btn-edit"><i class="fas fa-save"></i></button>
        <button data-del-part="${p.id}" class="btn-mini btn-del"><i class="fas fa-trash"></i></button>
      </li>
    `).join('');
    ul.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.save;
      const name = ul.querySelector(`.part-name[data-pid="${id}"]`).value.trim();
      if (!name) return;
      await api.put('/parts/' + id, { name });
      toast('部位を更新しました', 'success');
      loadParts(true);
    }));
    ul.querySelectorAll('[data-del-part]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('この部位を削除します。よろしいですか？\n※既存の取付実績の部位名は残ります。')) return;
      await api.del('/parts/' + b.dataset.delPart);
      toast('削除しました', 'success');
      loadParts(true);
    }));
  }
  $('#part-add').addEventListener('click', async () => {
    const name = $('#part-input').value.trim();
    if (!name) { toast('部位名を入力してください', 'error'); return; }
    try {
      await api.post('/parts', { name });
      $('#part-input').value = '';
      toast('部位を追加しました', 'success');
      loadParts(true);
    } catch (e) {
      toast('追加に失敗しました（重複の可能性）', 'error');
    }
  });

  // ---------- Utils ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(c => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    // BOM付き(Excel対応)
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Init ----------
  (async () => {
    try {
      await refreshMasters();
      resetForm();
      // 初期は当月でフィルタしない（全期間）
      await loadDashboard();
    } catch (e) {
      console.error('init error', e);
      toast('初期化に失敗しました', 'error');
    }
  })();
})();
