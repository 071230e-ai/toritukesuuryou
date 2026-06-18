// 村田鉄筋㈱ 取付数量分析アプリ
// 構成: 現場登録 → 現場詳細(取付実績) → ダッシュボード/分析
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

  function toast(msg, type = 'info') {
    const t = $('#toast'), body = $('#toast-body');
    body.textContent = msg;
    body.className = `text-white text-sm px-4 py-2 rounded-full shadow-lg ${
      type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-700' : 'bg-slate-900'
    }`;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  const api = {
    get: (p) => axios.get('/api' + p).then(r => r.data),
    post: (p, d) => axios.post('/api' + p, d).then(r => r.data),
    put: (p, d) => axios.put('/api' + p, d).then(r => r.data),
    del: (p) => axios.delete('/api' + p).then(r => r.data),
  };

  const state = {
    parts: [],
    workers: [],
    sites: [],
    currentSite: null,
    sdWorkers: [],
    sdEditingId: null,
    charts: {},
    analysisData: null,
    sdInstallations: [],
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
    if (name === 'sites') loadSites();
    if (name === 'dashboard') loadDashboard();
    if (name === 'analysis') loadAnalysis();
    if (name === 'settings') loadParts(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#new-site-btn').addEventListener('click', () => openSiteModal());

  // ---------- マスタ取得 ----------
  async function refreshMasters() {
    const [parts, sugg] = await Promise.all([api.get('/parts'), api.get('/suggestions')]);
    state.parts = parts;
    state.workers = sugg.workers;
    // 部位 select (現場詳細フォーム)
    $('#sd-f-part').innerHTML = parts.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
    // 部位 select (分析フィルタ)
    const anPart = $('#an-part');
    if (anPart) anPart.innerHTML = '<option value="">すべて</option>' + parts.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('');
    // 人員名 datalist
    $('#dl-workers').innerHTML = state.workers.map(v => `<option value="${escapeHtml(v)}">`).join('');
    // 分析フィルタ 人員select
    const anWorker = $('#an-worker');
    if (anWorker) anWorker.innerHTML = '<option value="">すべて</option>' + state.workers.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  }

  // =====================================================
  // 現場一覧
  // =====================================================
  async function loadSites() {
    const search = $('#sites-search').value.trim();
    const q = search ? '?search=' + encodeURIComponent(search) : '';
    const sites = await api.get('/sites' + q);
    state.sites = sites;
    const container = $('#sites-list');
    if (!sites.length) {
      container.innerHTML = `
        <div class="col-span-full bg-white rounded-lg shadow p-8 text-center text-slate-500">
          <i class="fas fa-folder-open text-4xl text-slate-300 mb-3"></i>
          <div class="text-base font-semibold">まだ現場が登録されていません</div>
          <div class="text-sm mt-1">右上の「現場を追加」ボタンから最初の現場を登録してください。</div>
        </div>`;
      // 分析画面の元請/現場セレクトも更新
      updateAnalysisSelectors([]);
      return;
    }
    container.innerHTML = sites.map(s => {
      const per = (s.total_mp > 0) ? (s.total_qty / s.total_mp) : null;
      return `
      <div class="bg-white rounded-lg shadow hover:shadow-md transition p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-xs text-slate-500">${escapeHtml(s.contractor)}</div>
            <div class="text-lg font-bold text-slate-800 truncate">${escapeHtml(s.site_name)}</div>
            ${s.note ? `<div class="text-xs text-slate-500 mt-1 truncate">${escapeHtml(s.note)}</div>` : ''}
          </div>
          <div class="flex flex-col gap-1">
            <button data-edit-site="${s.id}" class="btn-mini btn-edit" title="編集"><i class="fas fa-pen"></i></button>
            <button data-del-site="${s.id}" class="btn-mini btn-del" title="削除"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-1 mt-3 text-center">
          <div><div class="text-[10px] text-slate-400">取付日数</div><div class="text-sm font-bold text-slate-700">${s.work_days}</div></div>
          <div><div class="text-[10px] text-slate-400">数量(kg)</div><div class="text-sm font-bold text-blue-700">${fmtKg(s.total_qty)}</div></div>
          <div><div class="text-[10px] text-slate-400">人工</div><div class="text-sm font-bold text-green-700">${fmtMp(s.total_mp)}</div></div>
          <div><div class="text-[10px] text-slate-400">kg/人工</div><div class="text-sm font-bold text-orange-600">${per === null ? '<span class="text-slate-400 text-xs">未計算</span>' : fmtKg(per)}</div></div>
        </div>
        <button data-open-site="${s.id}" class="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded text-sm">
          <i class="fas fa-pen-to-square mr-1"></i>取付実績を入力／確認
        </button>
      </div>`;
    }).join('');
    $$('#sites-list [data-open-site]').forEach(b => b.addEventListener('click', () => openSiteDetail(b.dataset.openSite)));
    $$('#sites-list [data-edit-site]').forEach(b => b.addEventListener('click', () => editSite(b.dataset.editSite)));
    $$('#sites-list [data-del-site]').forEach(b => b.addEventListener('click', () => deleteSite(b.dataset.delSite)));

    updateAnalysisSelectors(sites);
  }
  $('#sites-search').addEventListener('input', debounce(loadSites, 200));
  $('#sites-new').addEventListener('click', () => openSiteModal());

  function updateAnalysisSelectors(sites) {
    const contractors = [...new Set(sites.map(s => s.contractor))].sort();
    const siteNames = [...new Set(sites.map(s => s.site_name))].sort();
    const anC = $('#an-contractor'), anS = $('#an-site');
    if (anC) anC.innerHTML = '<option value="">すべて</option>' + contractors.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (anS) anS.innerHTML = '<option value="">すべて</option>' + siteNames.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  }

  // ---------- 現場モーダル ----------
  function openSiteModal(site) {
    $('#sm-id').value = site?.id || '';
    $('#sm-contractor').value = site?.contractor || '';
    $('#sm-site-name').value = site?.site_name || '';
    $('#sm-note').value = site?.note || '';
    $('#site-modal-title').textContent = site ? '現場を編集' : '現場を登録';
    $('#sm-submit-label').textContent = site ? '更新する' : '登録する';
    $('#site-modal').classList.remove('hidden');
    $('#site-modal').classList.add('flex');
    setTimeout(() => $('#sm-contractor').focus(), 50);
  }
  function closeSiteModal() {
    $('#site-modal').classList.add('hidden');
    $('#site-modal').classList.remove('flex');
  }
  $('#site-modal-close').addEventListener('click', closeSiteModal);
  $('#site-modal-cancel').addEventListener('click', closeSiteModal);
  $('#site-modal').addEventListener('click', (e) => { if (e.target.id === 'site-modal') closeSiteModal(); });

  $('#site-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#sm-id').value;
    const payload = {
      contractor: $('#sm-contractor').value.trim(),
      site_name: $('#sm-site-name').value.trim(),
      note: $('#sm-note').value.trim(),
    };
    if (!payload.contractor || !payload.site_name) { toast('元請と現場名は必須です', 'error'); return; }
    try {
      if (id) {
        await api.put('/sites/' + id, payload);
        toast('現場情報を更新しました', 'success');
      } else {
        await api.post('/sites', payload);
        toast('現場を登録しました', 'success');
      }
      closeSiteModal();
      loadSites();
    } catch (err) {
      toast(err?.response?.data?.error || '保存に失敗しました', 'error');
    }
  });

  async function editSite(id) {
    const site = state.sites.find(s => String(s.id) === String(id));
    if (!site) return;
    openSiteModal(site);
  }
  async function deleteSite(id) {
    const site = state.sites.find(s => String(s.id) === String(id));
    if (!site) return;
    const hasData = site.row_count > 0;
    const msg = hasData
      ? `「${site.contractor} / ${site.site_name}」を削除します。\nこの現場には ${site.row_count} 件の取付実績があります。\n実績も含めてすべて削除してよろしいですか？`
      : `「${site.contractor} / ${site.site_name}」を削除します。よろしいですか？`;
    if (!confirm(msg)) return;
    try {
      await api.del('/sites/' + id + (hasData ? '?force=1' : ''));
      toast('削除しました', 'success');
      loadSites();
    } catch (err) {
      toast(err?.response?.data?.error || '削除に失敗しました', 'error');
    }
  }

  // =====================================================
  // 現場詳細 (取付実績入力)
  // =====================================================
  async function openSiteDetail(siteId) {
    const site = await api.get('/sites/' + siteId);
    state.currentSite = site;
    $('#sd-contractor').textContent = site.contractor;
    $('#sd-site-name').textContent = site.site_name;
    $('#sd-f-site-id').value = site.id;
    resetSdForm();
    await loadSiteInstallations(site.id);
    showTab('site-detail');
  }
  $('#back-to-sites').addEventListener('click', () => showTab('sites'));
  $('#sd-edit-site').addEventListener('click', () => {
    if (state.currentSite) openSiteModal(state.currentSite);
  });

  async function loadSiteInstallations(siteId) {
    const list = await api.get('/sites/' + siteId + '/installations');
    state.sdInstallations = list;
    // サマリ
    let totalQty = 0, totalMp = 0;
    const dateSet = new Set();
    list.forEach(d => { totalQty += d.quantity; totalMp += d.manpower; dateSet.add(d.work_date); });
    $('#sd-days').textContent = dateSet.size;
    $('#sd-qty').textContent = fmtKg(totalQty);
    $('#sd-mp').textContent = fmtMp(totalMp);
    $('#sd-per').textContent = totalMp > 0 ? fmtKg(totalQty / totalMp) : '未計算';

    // 一覧
    const tbody = $('#sd-install-list');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 py-6">取付実績はまだありません。上のフォームから追加してください。</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(d => `
      <tr class="border-t">
        <td class="px-2 py-2 whitespace-nowrap">${formatDate(d.work_date)}</td>
        <td class="px-2 py-2">${escapeHtml(d.part)}</td>
        <td class="px-2 py-2 text-right">${fmtKg(d.quantity)}<span class="text-xs text-slate-400">kg</span></td>
        <td class="px-2 py-2 text-right">${fmtMp(d.manpower)}</td>
        <td class="px-2 py-2 text-xs">${(d.workers || []).map(escapeHtml).join('、')}</td>
        <td class="px-2 py-2 text-center whitespace-nowrap">
          <button class="btn-mini btn-edit" data-edit="${d.id}"><i class="fas fa-edit"></i></button>
          <button class="btn-mini btn-del" data-del="${d.id}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => sdEditInstall(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => sdDeleteInstall(b.dataset.del)));
  }

  function resetSdForm() {
    state.sdWorkers = [];
    state.sdEditingId = null;
    $('#sd-f-id').value = '';
    $('#sd-f-date').value = dayjs().format('YYYY-MM-DD');
    $('#sd-f-qty').value = '';
    $('#sd-f-mp').value = '';
    $('#sd-f-note').value = '';
    $('#sd-f-worker-input').value = '';
    $('#sd-submit-label').textContent = '追加する';
    $('#sd-form-title').textContent = '取付実績を追加';
    renderSdChips();
  }
  $('#sd-reset').addEventListener('click', resetSdForm);

  function renderSdChips() {
    const c = $('#sd-worker-chips');
    if (!state.sdWorkers.length) {
      c.innerHTML = '<span class="text-xs text-slate-400">未入力</span>';
      return;
    }
    c.innerHTML = state.sdWorkers.map((w, i) =>
      `<span class="chip">${escapeHtml(w)}<button type="button" data-i="${i}" aria-label="削除">×</button></span>`
    ).join('');
    c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.sdWorkers.splice(Number(b.dataset.i), 1);
      renderSdChips();
    }));
  }
  $('#sd-add-worker').addEventListener('click', sdAddWorker);
  $('#sd-f-worker-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sdAddWorker(); }
  });
  function sdAddWorker() {
    const input = $('#sd-f-worker-input');
    const name = input.value.trim();
    if (!name) return;
    if (!state.sdWorkers.includes(name)) state.sdWorkers.push(name);
    input.value = '';
    input.focus();
    renderSdChips();
  }

  $('#sd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentSite) return;
    const payload = {
      site_id: state.currentSite.id,
      work_date: $('#sd-f-date').value,
      part: $('#sd-f-part').value,
      quantity: parseFloat($('#sd-f-qty').value),
      manpower: parseFloat($('#sd-f-mp').value),
      note: $('#sd-f-note').value,
      workers: state.sdWorkers.slice(),
    };
    if (!payload.work_date || !payload.part) { toast('取付日と部位を入力してください', 'error'); return; }
    if (!(payload.quantity >= 0) || !(payload.manpower >= 0)) { toast('数量と人員を正しく入力してください', 'error'); return; }
    try {
      if (state.sdEditingId) {
        await api.put('/installations/' + state.sdEditingId, payload);
        toast('更新しました', 'success');
      } else {
        await api.post('/installations', payload);
        toast('追加しました', 'success');
      }
      resetSdForm();
      await refreshMasters();
      await loadSiteInstallations(state.currentSite.id);
    } catch (err) {
      toast(err?.response?.data?.error || '保存に失敗しました', 'error');
    }
  });

  async function sdEditInstall(id) {
    const d = await api.get('/installations/' + id);
    state.sdEditingId = d.id;
    state.sdWorkers = d.workers || [];
    $('#sd-f-id').value = d.id;
    $('#sd-f-date').value = d.work_date;
    $('#sd-f-part').value = d.part;
    $('#sd-f-qty').value = d.quantity;
    $('#sd-f-mp').value = d.manpower;
    $('#sd-f-note').value = d.note || '';
    $('#sd-submit-label').textContent = '更新する';
    $('#sd-form-title').textContent = '取付実績を編集';
    renderSdChips();
    window.scrollTo({ top: $('#sd-form').offsetTop - 80, behavior: 'smooth' });
  }
  async function sdDeleteInstall(id) {
    if (!confirm('この取付実績を削除します。よろしいですか？')) return;
    await api.del('/installations/' + id);
    toast('削除しました', 'success');
    await refreshMasters();
    await loadSiteInstallations(state.currentSite.id);
  }

  $('#sd-export').addEventListener('click', () => {
    if (!state.sdInstallations.length) { toast('データがありません'); return; }
    const site = state.currentSite;
    const rows = [['取付日', '元請', '現場名', '部位', '数量(kg)', '人員(人工)', '人員名', '備考']];
    state.sdInstallations.forEach(d => rows.push([
      d.work_date, site.contractor, site.site_name, d.part, d.quantity, d.manpower,
      (d.workers || []).join(' / '), d.note || ''
    ]));
    downloadCsv(`${site.contractor}_${site.site_name}_` + dayjs().format('YYYYMMDD') + '.csv', rows);
  });

  // =====================================================
  // ダッシュボード
  // =====================================================
  async function loadDashboard() {
    const q = new URLSearchParams();
    if ($('#dash-from').value) q.set('from', $('#dash-from').value);
    if ($('#dash-to').value) q.set('to', $('#dash-to').value);
    const d = await api.get('/analytics/dashboard?' + q.toString());
    const total = d.total || { total_qty: 0, total_mp: 0 };
    $('#kpi-total-qty').textContent = fmtKg(total.total_qty);
    $('#kpi-total-mp').textContent = fmtMp(total.total_mp);
    $('#kpi-per-mp').textContent = total.total_mp > 0 ? fmtKg(total.total_qty / total.total_mp) : '未計算';

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

  // =====================================================
  // 集計・分析
  // =====================================================
  async function loadAnalysis() {
    const q = currentAnalysisQuery();
    const [sites, details] = await Promise.all([
      api.get('/analytics/sites?' + q),
      api.get('/installations?' + q),
    ]);
    let totalQty = 0, totalMp = 0;
    sites.forEach(s => { totalQty += s.total_qty; totalMp += s.total_mp; });
    const per = totalMp > 0 ? totalQty / totalMp : null;
    $('#an-summary').innerHTML = `
      <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">合計数量</div><div class="text-xl font-bold text-blue-700">${fmtKg(totalQty)} <span class="text-xs font-normal">kg</span></div></div>
      <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">合計人工数</div><div class="text-xl font-bold text-green-700">${fmtMp(totalMp)} <span class="text-xs font-normal">人工</span></div></div>
      <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">1人工あたり</div><div class="text-xl font-bold text-orange-600">${per === null ? '<span class="text-slate-400 text-sm">未計算</span>' : fmtKg(per) + ' <span class="text-xs font-normal">kg/人工</span>'}</div></div>
    `;

    $('#an-site-summary').innerHTML = sites.length === 0
      ? '<tr><td colspan="6" class="text-center text-slate-400 py-4">データがありません</td></tr>'
      : sites.map(s => {
          const p = s.total_mp > 0 ? s.total_qty / s.total_mp : null;
          return `<tr class="border-t">
            <td class="px-2 py-2">${escapeHtml(s.contractor)}</td>
            <td class="px-2 py-2 font-semibold">${escapeHtml(s.site_name)}</td>
            <td class="px-2 py-2 text-right">${s.work_days}</td>
            <td class="px-2 py-2 text-right">${fmtKg(s.total_qty)}</td>
            <td class="px-2 py-2 text-right">${fmtMp(s.total_mp)}</td>
            <td class="px-2 py-2 text-right font-bold text-orange-600">${p === null ? '<span class="text-slate-400 text-xs">未計算</span>' : fmtKg(p)}</td>
          </tr>`;
        }).join('');

    $('#an-detail').innerHTML = details.length === 0
      ? '<tr><td colspan="7" class="text-center text-slate-400 py-4">データがありません</td></tr>'
      : details.map(d => `<tr class="border-t">
          <td class="px-2 py-2 whitespace-nowrap">${formatDate(d.work_date)}</td>
          <td class="px-2 py-2">${escapeHtml(d.contractor)}</td>
          <td class="px-2 py-2">${escapeHtml(d.site_name)}</td>
          <td class="px-2 py-2">${escapeHtml(d.part)}</td>
          <td class="px-2 py-2 text-right">${fmtKg(d.quantity)}<span class="text-xs text-slate-400">kg</span></td>
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
    if ($('#an-part').value) q.set('part', $('#an-part').value);
    if ($('#an-worker').value) q.set('worker', $('#an-worker').value);
    return q.toString();
  }
  $('#an-apply').addEventListener('click', loadAnalysis);
  $('#an-clear').addEventListener('click', () => {
    ['an-from','an-to','an-contractor','an-site','an-part','an-worker'].forEach(id => { $('#' + id).value = ''; });
    loadAnalysis();
  });
  $('#an-export').addEventListener('click', () => {
    if (!state.analysisData) return;
    const rows = [['取付日', '元請', '現場名', '部位', '数量(kg)', '人員(人工)', '人員名', '備考']];
    state.analysisData.details.forEach(d => rows.push([
      d.work_date, d.contractor, d.site_name, d.part, d.quantity, d.manpower,
      (d.workers || []).join(' / '), d.note || ''
    ]));
    rows.push([]);
    rows.push(['【元請・現場別サマリ】']);
    rows.push(['元請', '現場名', '取付日数', '合計数量(kg)', '合計人工数', '1人工あたり(kg/人工)']);
    state.analysisData.sites.forEach(s => {
      const p = s.total_mp > 0 ? s.total_qty / s.total_mp : '';
      rows.push([s.contractor, s.site_name, s.work_days, s.total_qty, s.total_mp, p === '' ? '未計算' : Math.round(p)]);
    });
    downloadCsv('analysis_' + dayjs().format('YYYYMMDD_HHmm') + '.csv', rows);
  });

  // =====================================================
  // 部位設定
  // =====================================================
  async function loadParts(refresh) {
    if (refresh) await refreshMasters();
    const ul = $('#part-list');
    ul.innerHTML = state.parts.map(p => `
      <li class="flex items-center gap-2 px-3 py-2">
        <input type="text" value="${escapeHtml(p.name)}" data-pid="${p.id}" class="part-name flex-1 border rounded px-2 py-1 text-sm" />
        <button data-save="${p.id}" class="btn-mini btn-edit"><i class="fas fa-save"></i></button>
        <button data-del-part="${p.id}" class="btn-mini btn-del"><i class="fas fa-trash"></i></button>
      </li>`).join('');
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
    } catch {
      toast('追加に失敗しました（重複の可能性）', 'error');
    }
  });

  // =====================================================
  // Utils
  // =====================================================
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function formatDate(s) {
    if (!s) return '';
    return dayjs(s).format('YYYY/M/D');
  }
  function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(c => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
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
      await loadSites();
    } catch (e) {
      console.error('init error', e);
      toast('初期化に失敗しました', 'error');
    }
  })();
})();
