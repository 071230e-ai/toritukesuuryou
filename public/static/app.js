/* 村田鉄筋㈱ 取付数量分析アプリ v3 (3階層: 現場 → 部位・数量 → 取付実績) */
(() => {
  'use strict';

  const $  = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const fmt = (n, d = 0) => {
    const v = Number(n) || 0;
    return v.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) });
  };
  const fmtInt = (n) => (Number(n) || 0).toLocaleString('ja-JP');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const api = axios.create({ baseURL: '/api' });

  const state = {
    parts: [],          // 部位マスタ
    workers: [],        // 人員名サジェスト
    sites: [],          // 現場一覧
    currentSite: null,  // {id, contractor, site_name, note}
    siteParts: [],      // 現在の現場の部位
    currentPart: null,  // {id, site_id, part, quantity, contractor, site_name}
    installations: [],  // 現在の部位の取付実績
    ixWorkers: [],      // 取付実績フォームに現在追加されている人員名
    charts: {},
    // テキスト取込用
    importBlocks: [],   // 読み取り済みブロック (編集可)
    importExisting: { sites: [], site_parts: [] }, // 既存マッチ判定用
  };

  // ============================================================
  // Toast
  // ============================================================
  function toast(msg, isError = false) {
    const t = $('#toast'); const b = $('#toast-body');
    if (!t || !b) return;
    b.textContent = msg;
    b.className = isError
      ? 'bg-red-600 text-white text-sm px-4 py-2 rounded-full shadow-lg'
      : 'bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg';
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2200);
  }
  const apiErr = (e, fallback) => toast((e?.response?.data?.error) || fallback || '通信エラー', true);

  // ============================================================
  // Tab / Breadcrumb
  // ============================================================
  function showTab(name) {
    $$('.tab-pane').forEach(el => el.classList.add('hidden'));
    const pane = $('#tab-' + name);
    if (pane) pane.classList.remove('hidden');

    // 上部タブのハイライト（sites/dashboard/analysis/settings のみ）
    $$('.tab-btn').forEach(b => {
      const t = b.dataset.tab;
      const active = (t === name);
      b.classList.toggle('text-white', active);
      b.classList.toggle('text-white/80', !active);
      b.classList.toggle('border-yellow-400', active);
      b.classList.toggle('border-transparent', !active);
    });

    renderBreadcrumb(name);

    if (name === 'sites')        loadSites();
    if (name === 'dashboard')    loadDashboard();
    if (name === 'analysis')     loadAnalysis();
    if (name === 'settings')     loadParts(true);
    if (name === 'import')       loadImportTab();
  }

  function renderBreadcrumb(name) {
    const bc = $('#breadcrumb');
    if (!bc) return;
    const parts = [];
    parts.push(`<a href="#" data-bc="sites" class="hover:underline"><i class="fas fa-home mr-1"></i>現場一覧</a>`);
    if ((name === 'site-parts' || name === 'installations') && state.currentSite) {
      parts.push('<i class="fas fa-chevron-right text-[10px] mx-1"></i>');
      parts.push(`<a href="#" data-bc="site-parts" class="hover:underline">${esc(state.currentSite.contractor)} / ${esc(state.currentSite.site_name)}</a>`);
    }
    if (name === 'installations' && state.currentPart) {
      parts.push('<i class="fas fa-chevron-right text-[10px] mx-1"></i>');
      parts.push(`<span>${esc(state.currentPart.part)} (${fmt(state.currentPart.quantity)}kg)</span>`);
    }
    const visible = (name === 'site-parts' || name === 'installations');
    bc.classList.toggle('hidden', !visible);
    bc.innerHTML = parts.join('');
  }

  // ============================================================
  // 部位マスタ
  // ============================================================
  async function loadParts(renderList = false) {
    try {
      const { data } = await api.get('/parts');
      state.parts = data || [];
      // 部位選択肢を更新
      const opt = ['<option value="">部位を選択</option>']
        .concat(state.parts.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`))
        .join('');
      const spfPart = $('#sp-f-part'); if (spfPart) spfPart.innerHTML = opt;
      // 設定タブ
      if (renderList) {
        const ul = $('#part-list');
        if (ul) {
          ul.innerHTML = state.parts.length
            ? state.parts.map(p => `
                <li class="flex items-center gap-2 px-3 py-2">
                  <span class="flex-1 text-sm">${esc(p.name)}</span>
                  <button data-part-edit="${p.id}" data-name="${esc(p.name)}" class="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"><i class="fas fa-pen"></i></button>
                  <button data-part-del="${p.id}" class="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded"><i class="fas fa-trash"></i></button>
                </li>`).join('')
            : '<li class="px-3 py-2 text-sm text-slate-500">部位がありません</li>';
        }
      }
    } catch (e) { apiErr(e, '部位マスタの取得に失敗'); }
  }

  async function addPart() {
    const input = $('#part-input');
    const name = (input?.value || '').trim();
    if (!name) { toast('部位名を入力してください', true); return; }
    try {
      await api.post('/parts', { name });
      input.value = '';
      toast('追加しました');
      await loadParts(true);
    } catch (e) { apiErr(e, '追加に失敗'); }
  }
  async function editPart(id, currentName) {
    const name = prompt('部位名を変更', currentName);
    if (!name || name.trim() === currentName) return;
    try {
      await api.put('/parts/' + id, { name: name.trim() });
      toast('更新しました');
      await loadParts(true);
    } catch (e) { apiErr(e, '更新に失敗'); }
  }
  async function deletePart(id) {
    if (!confirm('この部位を削除します。よろしいですか？')) return;
    try {
      await api.delete('/parts/' + id);
      toast('削除しました');
      await loadParts(true);
    } catch (e) { apiErr(e, '削除に失敗'); }
  }

  // ============================================================
  // 人員名サジェスト
  // ============================================================
  async function loadSuggestions() {
    try {
      const { data } = await api.get('/suggestions');
      state.workers = data?.workers || [];
      const dl = $('#dl-workers');
      if (dl) dl.innerHTML = state.workers.map(w => `<option value="${esc(w)}"></option>`).join('');
      const sel = $('#an-worker');
      if (sel) {
        const cur = sel.value;
        sel.innerHTML = '<option value="">すべて</option>' + state.workers.map(w => `<option value="${esc(w)}">${esc(w)}</option>`).join('');
        sel.value = cur;
      }
    } catch (e) { /* silent */ }
  }

  // ============================================================
  // ① 現場一覧
  // ============================================================
  async function loadSites() {
    try {
      const search = ($('#sites-search')?.value || '').trim();
      const { data } = await api.get('/sites', { params: search ? { search } : {} });
      state.sites = data || [];
      renderSitesList();
    } catch (e) { apiErr(e, '現場一覧の取得に失敗'); }
  }

  function renderSitesList() {
    const list = $('#sites-list'); if (!list) return;
    if (!state.sites.length) {
      list.innerHTML = `
        <div class="col-span-full bg-white rounded-lg shadow p-8 text-center text-slate-500">
          <i class="fas fa-folder-open text-3xl mb-3 text-slate-300"></i>
          <p class="text-sm">現場が登録されていません</p>
          <p class="text-xs mt-1">右上の「現場を新規登録」から追加してください</p>
        </div>`;
      return;
    }
    list.innerHTML = state.sites.map(s => {
      const totalQty = Number(s.total_qty) || 0;
      const totalMp  = Number(s.total_mp)  || 0;
      const perMp = totalMp > 0 ? (totalQty / totalMp) : null;
      return `
      <div class="bg-white rounded-lg shadow hover:shadow-md transition p-3 flex flex-col gap-2">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-xs text-slate-500 truncate">${esc(s.contractor)}</div>
            <div class="text-base font-bold text-blue-800 truncate">${esc(s.site_name)}</div>
          </div>
          <div class="flex gap-1 shrink-0">
            <button data-site-edit="${s.id}" class="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded" title="編集"><i class="fas fa-pen"></i></button>
            <button data-site-del="${s.id}" class="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded" title="削除"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-1 text-center">
          <div class="bg-slate-50 rounded p-1.5">
            <div class="text-[10px] text-slate-500">部位</div>
            <div class="text-sm font-bold text-slate-700">${fmtInt(s.parts_count)}</div>
          </div>
          <div class="bg-slate-50 rounded p-1.5">
            <div class="text-[10px] text-slate-500">登録数量</div>
            <div class="text-sm font-bold text-blue-700">${fmt(totalQty)}<span class="text-[10px] font-normal"> kg</span></div>
          </div>
          <div class="bg-slate-50 rounded p-1.5">
            <div class="text-[10px] text-slate-500">合計人工</div>
            <div class="text-sm font-bold text-green-700">${fmt(totalMp, totalMp % 1 ? 1 : 0)}</div>
          </div>
          <div class="bg-slate-50 rounded p-1.5">
            <div class="text-[10px] text-slate-500">kg/人工</div>
            <div class="text-sm font-bold text-orange-600">${perMp !== null ? fmt(perMp) : '<span class="text-xs text-slate-400">未計算</span>'}</div>
          </div>
        </div>
        <button data-site-open="${s.id}" class="mt-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 rounded">
          <i class="fas fa-folder-open mr-1"></i>部位・数量を登録／表示
        </button>
      </div>`;
    }).join('');
  }

  // ============================================================
  // Site Modal (現場 新規/編集)
  // ============================================================
  function openSiteModal(site) {
    $('#sm-id').value = site?.id || '';
    $('#sm-contractor').value = site?.contractor || '';
    $('#sm-site-name').value  = site?.site_name  || '';
    $('#sm-note').value       = site?.note       || '';
    $('#site-modal-title').textContent = site ? '現場を編集' : '現場を登録';
    $('#sm-submit-label').textContent  = site ? '更新する' : '登録する';
    const m = $('#site-modal');
    m.classList.remove('hidden'); m.classList.add('flex');
    setTimeout(() => $('#sm-contractor').focus(), 50);
  }
  function closeSiteModal() {
    const m = $('#site-modal');
    m.classList.add('hidden'); m.classList.remove('flex');
  }
  async function submitSite(e) {
    e.preventDefault();
    const id = $('#sm-id').value;
    const payload = {
      contractor: $('#sm-contractor').value.trim(),
      site_name:  $('#sm-site-name').value.trim(),
      note:       $('#sm-note').value.trim(),
    };
    try {
      if (id) {
        await api.put('/sites/' + id, payload);
        toast('更新しました');
      } else {
        await api.post('/sites', payload);
        toast('登録しました');
      }
      closeSiteModal();
      await loadSites();
    } catch (e) { apiErr(e, '保存に失敗'); }
  }
  async function editSite(id) {
    try {
      const { data } = await api.get('/sites/' + id);
      openSiteModal(data);
    } catch (e) { apiErr(e, '取得に失敗'); }
  }
  async function deleteSite(id) {
    if (!confirm('この現場を削除します。配下に部位・取付実績がある場合はそれらも削除されます。よろしいですか？')) return;
    try {
      await api.delete('/sites/' + id);
      toast('削除しました');
      await loadSites();
    } catch (e) {
      // 配下データありの場合は force
      if (e?.response?.status === 400) {
        const c = e.response.data?.count;
        if (confirm(`配下に ${c} 件の部位/取付実績があります。全て削除して構いませんか？`)) {
          try {
            await api.delete('/sites/' + id + '?force=1');
            toast('削除しました');
            await loadSites();
          } catch (e2) { apiErr(e2, '削除に失敗'); }
          return;
        }
      }
      apiErr(e, '削除に失敗');
    }
  }

  // ============================================================
  // ② 部位・数量 (site-parts)
  // ============================================================
  async function openSitePartsScreen(siteId) {
    try {
      const { data: site } = await api.get('/sites/' + siteId);
      state.currentSite = site;
      $('#sp-contractor').textContent = site.contractor;
      $('#sp-site-name').textContent  = site.site_name;
      resetSpForm();
      await loadParts(false);
      await loadSiteParts();
      showTab('site-parts');
    } catch (e) { apiErr(e, '現場の読み込みに失敗'); }
  }

  async function loadSiteParts() {
    if (!state.currentSite) return;
    try {
      const { data } = await api.get(`/sites/${state.currentSite.id}/parts`);
      state.siteParts = data || [];
      renderSitePartsList();
    } catch (e) { apiErr(e, '部位一覧の取得に失敗'); }
  }

  function renderSitePartsList() {
    const tb = $('#sp-list'); if (!tb) return;
    if (!state.siteParts.length) {
      tb.innerHTML = '<tr><td colspan="8" class="px-2 py-4 text-center text-slate-500 text-sm">部位が登録されていません</td></tr>';
      return;
    }
    tb.innerHTML = state.siteParts.map(sp => {
      const qty = Number(sp.quantity) || 0;
      const mp  = Number(sp.total_mp) || 0;
      const per = mp > 0 ? (qty / mp) : null;
      return `
        <tr class="border-b hover:bg-slate-50">
          <td class="px-2 py-2 font-semibold">${esc(sp.part)}</td>
          <td class="px-2 py-2 text-right">${fmt(qty)}</td>
          <td class="px-2 py-2 text-right">${fmtInt(sp.work_days)}</td>
          <td class="px-2 py-2 text-right">${fmt(mp, mp % 1 ? 1 : 0)}</td>
          <td class="px-2 py-2 text-right ${per === null ? 'text-slate-400' : 'text-orange-600 font-semibold'}">${per !== null ? fmt(per) : '未計算'}</td>
          <td class="px-2 py-2 text-right">${fmtInt(sp.delivery_vehicles)}</td>
          <td class="px-2 py-2 text-right">${fmtInt(sp.commute_vehicles)}</td>
          <td class="px-2 py-2 text-center whitespace-nowrap">
            <button data-sp-open="${sp.id}" class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded" title="取付実績"><i class="fas fa-hammer"></i></button>
            <button data-sp-edit="${sp.id}" class="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded ml-1" title="編集"><i class="fas fa-pen"></i></button>
            <button data-sp-del="${sp.id}" class="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded ml-1" title="削除"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`;
    }).join('');
  }

  function resetSpForm() {
    $('#sp-f-id').value = '';
    $('#sp-f-part').value = '';
    $('#sp-f-qty').value = '';
    $('#sp-f-note').value = '';
    $('#sp-form-title').textContent = '部位・数量を追加';
    $('#sp-submit-label').textContent = '追加する';
  }

  async function submitSitePart(e) {
    e.preventDefault();
    if (!state.currentSite) return;
    const id = $('#sp-f-id').value;
    const payload = {
      part: $('#sp-f-part').value.trim(),
      quantity: Number($('#sp-f-qty').value),
      note: $('#sp-f-note').value.trim(),
    };
    if (!payload.part) { toast('部位を選択してください', true); return; }
    if (!(payload.quantity >= 0)) { toast('数量は0以上で入力してください', true); return; }
    try {
      if (id) {
        await api.put('/site-parts/' + id, payload);
        toast('更新しました');
      } else {
        await api.post(`/sites/${state.currentSite.id}/parts`, payload);
        toast('追加しました');
      }
      resetSpForm();
      await loadSiteParts();
    } catch (e) { apiErr(e, '保存に失敗'); }
  }

  function editSitePart(id) {
    const sp = state.siteParts.find(x => x.id == id);
    if (!sp) return;
    $('#sp-f-id').value   = sp.id;
    $('#sp-f-part').value = sp.part;
    $('#sp-f-qty').value  = sp.quantity;
    $('#sp-f-note').value = sp.note || '';
    $('#sp-form-title').textContent = '部位・数量を編集';
    $('#sp-submit-label').textContent = '更新する';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteSitePart(id) {
    if (!confirm('この部位を削除します。よろしいですか？')) return;
    try {
      await api.delete('/site-parts/' + id);
      toast('削除しました');
      await loadSiteParts();
    } catch (e) {
      if (e?.response?.status === 400) {
        const c = e.response.data?.count;
        if (confirm(`配下に ${c} 件の取付実績があります。全て削除して構いませんか？`)) {
          try {
            await api.delete('/site-parts/' + id + '?force=1');
            toast('削除しました');
            await loadSiteParts();
          } catch (e2) { apiErr(e2, '削除に失敗'); }
          return;
        }
      }
      apiErr(e, '削除に失敗');
    }
  }

  // ============================================================
  // ③ 取付実績 (installations)
  // ============================================================
  async function openInstallationsScreen(sitePartId) {
    try {
      const { data: sp } = await api.get('/site-parts/' + sitePartId);
      state.currentPart = sp;
      state.currentSite = { id: sp.site_id, contractor: sp.contractor, site_name: sp.site_name };
      $('#ix-contractor').textContent = sp.contractor;
      $('#ix-site-name').textContent  = sp.site_name;
      $('#ix-part').textContent       = sp.part;
      $('#ix-reg-qty').textContent    = fmt(sp.quantity);
      resetIxForm();
      await loadSuggestions();
      await loadInstallations();
      showTab('installations');
    } catch (e) { apiErr(e, '部位の読み込みに失敗'); }
  }

  async function loadInstallations() {
    if (!state.currentPart) return;
    try {
      const { data } = await api.get(`/site-parts/${state.currentPart.id}/installations`);
      state.installations = data || [];
      renderInstallationsList();
      renderIxSummary();
    } catch (e) { apiErr(e, '取付実績の取得に失敗'); }
  }

  function renderInstallationsList() {
    const tb = $('#ix-list'); if (!tb) return;
    if (!state.installations.length) {
      tb.innerHTML = '<tr><td colspan="6" class="px-2 py-4 text-center text-slate-500 text-sm">取付実績がありません</td></tr>';
      return;
    }
    tb.innerHTML = state.installations.map(r => {
      const mp = Number(r.manpower) || 0;
      return `
        <tr class="border-b hover:bg-slate-50">
          <td class="px-2 py-2 whitespace-nowrap">${dayjs(r.work_date).format('YYYY/MM/DD')}</td>
          <td class="px-2 py-2">${(r.workers || []).map(w => `<span class="chip">${esc(w)}</span>`).join(' ')}</td>
          <td class="px-2 py-2 text-right font-semibold">${fmt(mp, mp % 1 ? 1 : 0)}</td>
          <td class="px-2 py-2 text-right">${fmtInt(r.delivery_vehicles)}</td>
          <td class="px-2 py-2 text-right">${fmtInt(r.commute_vehicles)}</td>
          <td class="px-2 py-2 text-center whitespace-nowrap">
            <button data-ix-edit="${r.id}" class="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"><i class="fas fa-pen"></i></button>
            <button data-ix-del="${r.id}" class="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded ml-1"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`;
    }).join('');
  }

  function renderIxSummary() {
    const days = new Set(state.installations.map(r => r.work_date)).size;
    const totalMp = state.installations.reduce((s, r) => s + (Number(r.manpower) || 0), 0);
    const totalDv = state.installations.reduce((s, r) => s + (Number(r.delivery_vehicles) || 0), 0);
    const totalCv = state.installations.reduce((s, r) => s + (Number(r.commute_vehicles)  || 0), 0);
    const qty = Number(state.currentPart?.quantity) || 0;
    const per = totalMp > 0 ? (qty / totalMp) : null;
    $('#ix-days').textContent  = fmtInt(days);
    $('#ix-mp').textContent    = fmt(totalMp, totalMp % 1 ? 1 : 0);
    $('#ix-per').textContent   = per !== null ? fmt(per) : '未計算';
    $('#ix-deliv').textContent = fmtInt(totalDv);
    $('#ix-commu').textContent = fmtInt(totalCv);
  }

  function resetIxForm() {
    $('#ix-f-id').value = '';
    $('#ix-f-date').value = dayjs().format('YYYY-MM-DD');
    $('#ix-f-mp').value = '';
    $('#ix-f-deliv').value = '0';
    $('#ix-f-commu').value = '0';
    $('#ix-f-note').value = '';
    $('#ix-f-worker-input').value = '';
    state.ixWorkers = [];
    renderIxWorkerChips();
    $('#ix-form-title').textContent   = '取付実績を追加';
    $('#ix-submit-label').textContent = '追加する';
  }

  function renderIxWorkerChips() {
    const box = $('#ix-worker-chips'); if (!box) return;
    box.innerHTML = state.ixWorkers.map((w, i) => `
      <span class="chip-removable inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
        ${esc(w)}
        <button type="button" data-rm-worker="${i}" class="hover:text-red-600"><i class="fas fa-xmark"></i></button>
      </span>`).join('');
  }

  function addWorkerChip() {
    const input = $('#ix-f-worker-input');
    const v = (input?.value || '').trim();
    if (!v) return;
    if (!state.ixWorkers.includes(v)) state.ixWorkers.push(v);
    input.value = '';
    renderIxWorkerChips();
    input.focus();
  }

  async function submitInstallation(e) {
    e.preventDefault();
    if (!state.currentPart) return;
    // フォーム入力中の人員名があれば追加
    const pending = ($('#ix-f-worker-input')?.value || '').trim();
    if (pending && !state.ixWorkers.includes(pending)) state.ixWorkers.push(pending);
    $('#ix-f-worker-input').value = '';

    if (!state.ixWorkers.length) { toast('人員名を1人以上追加してください', true); return; }

    const id = $('#ix-f-id').value;
    const payload = {
      site_part_id: state.currentPart.id,
      work_date: $('#ix-f-date').value,
      manpower: Number($('#ix-f-mp').value) || 0,
      delivery_vehicles: Math.max(0, Math.floor(Number($('#ix-f-deliv').value) || 0)),
      commute_vehicles:  Math.max(0, Math.floor(Number($('#ix-f-commu').value) || 0)),
      workers: state.ixWorkers.slice(),
      note: $('#ix-f-note').value.trim(),
    };
    if (!payload.work_date) { toast('取付日を入力してください', true); return; }
    if (!(payload.manpower > 0)) { toast('人工数を入力してください', true); return; }
    try {
      if (id) {
        await api.put('/installations/' + id, payload);
        toast('更新しました');
      } else {
        await api.post('/installations', payload);
        toast('追加しました');
      }
      resetIxForm();
      await loadInstallations();
      await loadSuggestions();
    } catch (e) {
      // 重複エラー (同じ現場・同じ部位・同じ取付日) は alert で多行表示
      const data = e?.response?.data;
      if (data?.duplicate) {
        alert('【登録エラー】\n' + (data.error || 'すでに同じ取付日の同じ部位が登録されています'));
        toast('重複エラー: 同じ取付日の同じ部位が既に登録されています', true);
      } else {
        apiErr(e, '保存に失敗');
      }
    }
  }

  async function editInstallation(id) {
    try {
      const { data } = await api.get('/installations/' + id);
      $('#ix-f-id').value    = data.id;
      $('#ix-f-date').value  = data.work_date;
      $('#ix-f-mp').value    = data.manpower;
      $('#ix-f-deliv').value = data.delivery_vehicles ?? 0;
      $('#ix-f-commu').value = data.commute_vehicles  ?? 0;
      $('#ix-f-note').value  = data.note || '';
      state.ixWorkers = (data.workers || []).slice();
      renderIxWorkerChips();
      $('#ix-form-title').textContent   = '取付実績を編集';
      $('#ix-submit-label').textContent = '更新する';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { apiErr(e, '取得に失敗'); }
  }

  async function deleteInstallation(id) {
    if (!confirm('この取付実績を削除します。よろしいですか？')) return;
    try {
      await api.delete('/installations/' + id);
      toast('削除しました');
      await loadInstallations();
    } catch (e) { apiErr(e, '削除に失敗'); }
  }

  function exportIxCsv() {
    if (!state.installations.length) { toast('出力対象がありません', true); return; }
    const head = ['取付日', '人員名', '人工数', '搬入車両', '通勤車両', '備考'];
    const rows = state.installations.map(r => [
      r.work_date,
      (r.workers || []).join('、'),
      r.manpower,
      r.delivery_vehicles ?? 0,
      r.commute_vehicles ?? 0,
      r.note || '',
    ]);
    downloadCsv(`installations_${state.currentSite?.site_name || ''}_${state.currentPart?.part || ''}.csv`, head, rows);
  }

  function downloadCsv(filename, head, rows) {
    const csv = [head, ...rows].map(r => r.map(c => {
      const s = String(c == null ? '' : c).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(',')).join('\r\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // ============================================================
  // Step button (numeric +/-)
  // ============================================================
  function handleStepClick(btn) {
    const target = btn.dataset.step;
    const delta = Number(btn.dataset.delta) || 0;
    const map = { manpower: '#ix-f-mp', deliv: '#ix-f-deliv', commu: '#ix-f-commu' };
    const sel = map[target]; if (!sel) return;
    const inp = $(sel); if (!inp) return;
    const isInt = (target === 'deliv' || target === 'commu');
    let v = Number(inp.value) || 0;
    v += delta;
    if (v < 0) v = 0;
    if (isInt) v = Math.floor(v);
    else v = Math.round(v * 10) / 10;
    inp.value = isInt ? String(v) : String(v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ============================================================
  // ダッシュボード
  // ============================================================
  function getDashParams() {
    const p = {};
    const f = $('#dash-from')?.value; const t = $('#dash-to')?.value;
    if (f) p.from = f; if (t) p.to = t;
    return p;
  }

  async function loadDashboard() {
    try {
      const { data } = await api.get('/analytics/dashboard', { params: getDashParams() });
      $('#kpi-total-qty').textContent = fmt(data.total.total_qty);
      $('#kpi-total-mp').textContent  = fmt(data.total.total_mp, data.total.total_mp % 1 ? 1 : 0);
      const per = data.total.total_mp > 0 ? data.total.total_qty / data.total.total_mp : 0;
      $('#kpi-per-mp').textContent    = data.total.total_mp > 0 ? fmt(per) : '未計算';
      $('#kpi-deliv').textContent     = fmtInt(data.total.total_deliv);
      $('#kpi-commu').textContent     = fmtInt(data.total.total_commu);

      drawBar('chart-site',       data.bySite.map(r => `${r.contractor || ''} / ${r.name}`), data.bySite.map(r => Number(r.qty) || 0), '現場別 登録数量(kg)');
      drawBar('chart-part',       data.byPart.map(r => r.name), data.byPart.map(r => Number(r.qty) || 0), '部位別 登録数量(kg)');
      drawBar('chart-worker',     data.byWorker.map(r => r.name), data.byWorker.map(r => Number(r.mp) || 0), '人員別 人工数');
      drawBar('chart-contractor', data.byContractor.map(r => r.name), data.byContractor.map(r => Number(r.qty_share) || 0), '元請別 数量シェア(kg)');
    } catch (e) { apiErr(e, 'ダッシュボード取得に失敗'); }
  }

  function drawBar(canvasId, labels, dataArr, title) {
    const el = document.getElementById(canvasId); if (!el) return;
    if (state.charts[canvasId]) state.charts[canvasId].destroy();
    state.charts[canvasId] = new Chart(el, {
      type: 'bar',
      data: { labels, datasets: [{ label: title, data: dataArr, backgroundColor: 'rgba(59,130,246,0.6)', borderColor: 'rgba(59,130,246,1)', borderWidth: 1 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, title: { display: true, text: title, font: { size: 12 } } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  // ============================================================
  // 集計・分析
  // ============================================================
  function getAnParams() {
    const p = {};
    const f = $('#an-from')?.value; const t = $('#an-to')?.value;
    if (f) p.from = f; if (t) p.to = t;
    const c = $('#an-contractor')?.value;
    const s = $('#an-site')?.value;
    const part = $('#an-part')?.value;
    const w = $('#an-worker')?.value;
    if (c) p.contractor = c;
    if (s) p.site = s;
    if (part) p.part = part;
    if (w) p.worker = w;
    return p;
  }

  async function loadAnalysis() {
    await populateAnalysisFilters();
    await Promise.all([
      loadAnSites(),
      loadAnParts(),
      loadAnDetail(),
    ]);
  }

  async function populateAnalysisFilters() {
    // 元請・現場名・部位は state.sites / parts / sitePartsの集約で
    try {
      const { data: sites } = await api.get('/sites');
      const contractors = Array.from(new Set(sites.map(s => s.contractor))).sort();
      const siteNames   = Array.from(new Set(sites.map(s => s.site_name))).sort();
      const cSel = $('#an-contractor'); const sSel = $('#an-site');
      if (cSel) {
        const cur = cSel.value;
        cSel.innerHTML = '<option value="">すべて</option>' + contractors.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        cSel.value = cur;
      }
      if (sSel) {
        const cur = sSel.value;
        sSel.innerHTML = '<option value="">すべて</option>' + siteNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
        sSel.value = cur;
      }
    } catch { /* ignore */ }
    try {
      const { data: parts } = await api.get('/parts');
      const pSel = $('#an-part');
      if (pSel) {
        const cur = pSel.value;
        pSel.innerHTML = '<option value="">すべて</option>' + parts.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
        pSel.value = cur;
      }
    } catch { /* ignore */ }
    await loadSuggestions();
  }

  async function loadAnSites() {
    try {
      const { data } = await api.get('/analytics/sites', { params: getAnParams() });
      const tb = $('#an-site-summary');
      if (!data.length) {
        tb.innerHTML = '<tr><td colspan="8" class="px-2 py-3 text-center text-slate-500 text-sm">該当データがありません</td></tr>';
        return;
      }
      tb.innerHTML = data.map(r => {
        const qty = Number(r.total_qty) || 0;
        const mp  = Number(r.total_mp)  || 0;
        const per = mp > 0 ? (qty / mp) : null;
        return `
          <tr class="border-b hover:bg-slate-50">
            <td class="px-2 py-2">${esc(r.contractor)}</td>
            <td class="px-2 py-2">${esc(r.site_name)}</td>
            <td class="px-2 py-2 text-right font-semibold">${fmt(qty)}</td>
            <td class="px-2 py-2 text-right">${fmtInt(r.work_days)}</td>
            <td class="px-2 py-2 text-right">${fmt(mp, mp % 1 ? 1 : 0)}</td>
            <td class="px-2 py-2 text-right ${per === null ? 'text-slate-400' : 'text-orange-600 font-semibold'}">${per !== null ? fmt(per) : '未計算'}</td>
            <td class="px-2 py-2 text-right">${fmtInt(r.total_deliv)}</td>
            <td class="px-2 py-2 text-right">${fmtInt(r.total_commu)}</td>
          </tr>`;
      }).join('');
    } catch (e) { apiErr(e, '現場サマリの取得に失敗'); }
  }

  async function loadAnParts() {
    try {
      const { data } = await api.get('/analytics/parts', { params: getAnParams() });
      const tb = $('#an-part-summary');
      if (!data.length) {
        tb.innerHTML = '<tr><td colspan="9" class="px-2 py-3 text-center text-slate-500 text-sm">該当データがありません</td></tr>';
        return;
      }
      tb.innerHTML = data.map(r => {
        const qty = Number(r.registered_qty) || 0;
        const mp  = Number(r.total_mp) || 0;
        const per = mp > 0 ? (qty / mp) : null;
        return `
          <tr class="border-b hover:bg-slate-50">
            <td class="px-2 py-2">${esc(r.contractor)}</td>
            <td class="px-2 py-2">${esc(r.site_name)}</td>
            <td class="px-2 py-2 font-semibold">${esc(r.part)}</td>
            <td class="px-2 py-2 text-right">${fmt(qty)}</td>
            <td class="px-2 py-2 text-right">${fmtInt(r.work_days)}</td>
            <td class="px-2 py-2 text-right">${fmt(mp, mp % 1 ? 1 : 0)}</td>
            <td class="px-2 py-2 text-right ${per === null ? 'text-slate-400' : 'text-orange-600 font-semibold'}">${per !== null ? fmt(per) : '未計算'}</td>
            <td class="px-2 py-2 text-right">${fmtInt(r.total_deliv)}</td>
            <td class="px-2 py-2 text-right">${fmtInt(r.total_commu)}</td>
          </tr>`;
      }).join('');
    } catch (e) { apiErr(e, '部位サマリの取得に失敗'); }
  }

  async function loadAnDetail() {
    try {
      const { data } = await api.get('/installations', { params: getAnParams() });
      const tb = $('#an-detail');
      if (!data.length) {
        tb.innerHTML = '<tr><td colspan="8" class="px-2 py-3 text-center text-slate-500 text-sm">該当データがありません</td></tr>';
        return;
      }
      tb.innerHTML = data.map(r => {
        const mp = Number(r.manpower) || 0;
        return `
          <tr class="border-b hover:bg-slate-50">
            <td class="px-2 py-2 whitespace-nowrap">${dayjs(r.work_date).format('YYYY/MM/DD')}</td>
            <td class="px-2 py-2">${esc(r.contractor)}</td>
            <td class="px-2 py-2">${esc(r.site_name)}</td>
            <td class="px-2 py-2">${esc(r.part)}</td>
            <td class="px-2 py-2">${(r.workers || []).map(w => `<span class="chip">${esc(w)}</span>`).join(' ')}</td>
            <td class="px-2 py-2 text-right font-semibold">${fmt(mp, mp % 1 ? 1 : 0)}</td>
            <td class="px-2 py-2 text-right">${fmtInt(r.delivery_vehicles)}</td>
            <td class="px-2 py-2 text-right">${fmtInt(r.commute_vehicles)}</td>
          </tr>`;
      }).join('');
    } catch (e) { apiErr(e, '取付実績一覧の取得に失敗'); }
  }

  function exportAnCsv() {
    api.get('/installations', { params: getAnParams() }).then(({ data }) => {
      if (!data.length) { toast('出力対象がありません', true); return; }
      const head = ['取付日', '元請', '現場名', '部位', '人員名', '人工数', '搬入車両', '通勤車両', '備考'];
      const rows = data.map(r => [
        r.work_date, r.contractor, r.site_name, r.part,
        (r.workers || []).join('、'),
        r.manpower, r.delivery_vehicles ?? 0, r.commute_vehicles ?? 0, r.note || '',
      ]);
      downloadCsv('analysis_export.csv', head, rows);
    }).catch(e => apiErr(e, 'CSV出力に失敗'));
  }

  // ============================================================
  // テキスト取込 (予定表貼り付け)
  // ============================================================
  async function loadImportTab() {
    // 既存サイト・部位の一覧を取得 (重複判定用)
    try {
      const { data } = await api.get('/import/existing');
      state.importExisting = data || { sites: [], site_parts: [] };
    } catch (e) {
      state.importExisting = { sites: [], site_parts: [] };
    }
    // 既に読み取り結果がある場合は表示維持
    renderImportBlocks();
  }

  function findExistingSite(contractor, site_name) {
    const c = (contractor || '').trim();
    const n = (site_name || '').trim();
    if (!c || !n) return null;
    return (state.importExisting.sites || []).find(
      s => (s.contractor || '').trim() === c && (s.site_name || '').trim() === n
    ) || null;
  }
  function findExistingSitePart(site_id, part) {
    if (!site_id) return null;
    const p = (part || '').trim();
    return (state.importExisting.site_parts || []).find(
      sp => sp.site_id === site_id && (sp.part || '').trim() === p
    ) || null;
  }

  async function parseImport() {
    const text = ($('#im-text')?.value || '').trim();
    if (!text) { toast('テキストを貼り付けてください', true); return; }
    const formDate = $('#im-date')?.value || '';
    try {
      const { data } = await api.post('/import/parse', { text, form_date: formDate });
      const blocks = (data && data.blocks) || [];
      // 各ブロックを編集用にコピー (workers は配列を文字列化して編集UIに渡す)
      state.importBlocks = blocks.map((b, i) => ({
        idx: i,
        contractor: b.contractor || '',
        site_name: b.site_name || '',
        part: b.part || '',
        quantity: Number(b.quantity || 0),
        manpower: Number(b.manpower || 0),
        workers_text: (b.workers || []).join('、'),
        vehicle_note: b.vehicle_note || '',
        work_date: b.work_date || formDate || todayStr(),
        warnings: b.warnings || [],
        qty_strategy: 'overwrite', // 既存数量と異なる時のデフォルト
        commit_status: '',   // ''=未登録, 'ok'=登録成功, 'ng'=登録失敗
        commit_error: '',    // 登録失敗時のエラーメッセージ
      }));
      // 既存リスト最新化
      try {
        const ex = await api.get('/import/existing');
        state.importExisting = ex.data || { sites: [], site_parts: [] };
      } catch {}
      $('#im-result-wrap')?.classList.remove('hidden');
      $('#im-summary').textContent = String(state.importBlocks.length);
      renderImportBlocks();
      if (state.importBlocks.length === 0) {
        toast('読み取り結果が0件でした。テキストを確認してください', true);
      } else {
        toast(`${state.importBlocks.length} 件読み取りました`);
      }
    } catch (e) {
      apiErr(e, 'テキスト読み取りに失敗');
    }
  }

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function renderImportBlocks() {
    const wrap = $('#im-list');
    if (!wrap) return;
    if (!state.importBlocks.length) {
      wrap.innerHTML = '';
      return;
    }
    const html = state.importBlocks.map((b, i) => {
      const existSite = findExistingSite(b.contractor, b.site_name);
      const existPart = existSite ? findExistingSitePart(existSite.id, b.part) : null;
      const qtyConflict = !!(existPart && Number(existPart.quantity) !== Number(b.quantity) && b.quantity > 0);
      const warnHtml = (b.warnings || []).length
        ? `<div class="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1 mt-1"><i class="fas fa-triangle-exclamation mr-1"></i>${b.warnings.map(esc).join(' / ')}</div>` : '';

      // 登録状態によりカードの枠色を変える
      // - 'ok': 緑枠 + 登録済みバッジ
      // - 'ng': 赤枠 + エラーバナー
      // - '' : 通常
      let cardCls = 'bg-white rounded-lg shadow border p-3';
      let stateBadge = '';
      let errBanner = '';
      if (b.commit_status === 'ok') {
        cardCls += ' border-green-400 bg-green-50';
        stateBadge = `<span class="inline-flex items-center gap-1 bg-green-600 text-white text-[10px] rounded px-2 py-0.5 font-semibold"><i class="fas fa-check"></i>登録済み</span>`;
      } else if (b.commit_status === 'ng') {
        cardCls += ' border-red-400 border-2';
        stateBadge = `<span class="inline-flex items-center gap-1 bg-red-600 text-white text-[10px] rounded px-2 py-0.5 font-semibold"><i class="fas fa-circle-exclamation"></i>登録エラー</span>`;
        // エラーメッセージは改行を <br> に
        const errText = esc(b.commit_error || '不明なエラー').replace(/\n/g, '<br>');
        errBanner = `
          <div class="text-[12px] text-red-800 bg-red-100 border border-red-300 rounded px-2 py-2 mt-2 leading-snug">
            <div class="font-semibold mb-0.5"><i class="fas fa-circle-exclamation mr-1"></i>登録エラー</div>
            <div>${errText}</div>
          </div>`;
      } else {
        cardCls += ' border-slate-200';
      }

      const matchHtml = [
        existSite ? `<span class="inline-block bg-blue-100 text-blue-800 text-[10px] rounded px-1.5 py-0.5 mr-1"><i class="fas fa-link mr-0.5"></i>既存現場に紐付け</span>` : `<span class="inline-block bg-green-100 text-green-800 text-[10px] rounded px-1.5 py-0.5 mr-1"><i class="fas fa-plus mr-0.5"></i>新規現場</span>`,
        existPart ? `<span class="inline-block bg-blue-100 text-blue-800 text-[10px] rounded px-1.5 py-0.5"><i class="fas fa-link mr-0.5"></i>既存部位 (現:${fmt(existPart.quantity)}kg)</span>` : (b.part ? `<span class="inline-block bg-green-100 text-green-800 text-[10px] rounded px-1.5 py-0.5"><i class="fas fa-plus mr-0.5"></i>新規部位</span>` : ''),
      ].join('');
      const qtyConflictHtml = qtyConflict ? `
        <div class="mt-2 p-2 bg-amber-50 border border-amber-300 rounded text-[12px]">
          <div class="text-amber-800 font-semibold mb-1"><i class="fas fa-triangle-exclamation mr-1"></i>同じ部位に既に数量があります (既存: ${fmt(existPart.quantity)}kg / 読取: ${fmt(b.quantity)}kg)</div>
          <div class="flex flex-wrap gap-3">
            <label class="inline-flex items-center gap-1"><input type="radio" name="qty-strategy-${i}" value="overwrite" ${b.qty_strategy === 'overwrite' ? 'checked' : ''} data-im-qty="${i}" /> 上書き</label>
            <label class="inline-flex items-center gap-1"><input type="radio" name="qty-strategy-${i}" value="add" ${b.qty_strategy === 'add' ? 'checked' : ''} data-im-qty="${i}" /> 加算</label>
            <label class="inline-flex items-center gap-1"><input type="radio" name="qty-strategy-${i}" value="keep" ${b.qty_strategy === 'keep' ? 'checked' : ''} data-im-qty="${i}" /> 既存維持(数量変更なし)</label>
          </div>
        </div>` : '';
      return `
        <div class="${cardCls}" data-im-card="${i}">
          <div class="flex items-center justify-between mb-2 gap-2">
            <div class="flex items-center gap-2">
              <div class="text-xs text-slate-500">ブロック #${i + 1}</div>
              ${stateBadge}
            </div>
            <div class="flex gap-1">
              <button type="button" class="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded" data-im-remove="${i}"><i class="fas fa-trash mr-0.5"></i>削除</button>
            </div>
          </div>
          ${errBanner}
          <div class="mb-2">${matchHtml}</div>
          ${warnHtml}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div>
              <label class="block text-[11px] text-slate-500 mb-0.5">取付日 <span class="text-red-500">*</span></label>
              <input type="date" data-im-field="work_date" data-im-i="${i}" value="${esc(b.work_date)}" class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-[11px] text-slate-500 mb-0.5">元請 <span class="text-red-500">*</span></label>
              <input type="text" data-im-field="contractor" data-im-i="${i}" value="${esc(b.contractor)}" class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-[11px] text-slate-500 mb-0.5">現場名 <span class="text-red-500">*</span></label>
              <input type="text" data-im-field="site_name" data-im-i="${i}" value="${esc(b.site_name)}" class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-[11px] text-slate-500 mb-0.5">部位</label>
              <input type="text" data-im-field="part" data-im-i="${i}" value="${esc(b.part)}" class="w-full border rounded px-2 py-1.5 text-sm" placeholder="例: 基礎" />
            </div>
            <div>
              <label class="block text-[11px] text-slate-500 mb-0.5">数量 (kg)</label>
              <input type="number" step="0.01" min="0" inputmode="decimal" data-im-field="quantity" data-im-i="${i}" value="${b.quantity || 0}" class="w-full border rounded px-2 py-1.5 text-sm text-right" />
            </div>
            <div>
              <label class="block text-[11px] text-slate-500 mb-0.5">人工数</label>
              <input type="number" step="0.1" min="0" inputmode="decimal" data-im-field="manpower" data-im-i="${i}" value="${b.manpower || 0}" class="w-full border rounded px-2 py-1.5 text-sm text-right" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-[11px] text-slate-500 mb-0.5">人員名 (、または , 区切り)</label>
              <input type="text" data-im-field="workers_text" data-im-i="${i}" value="${esc(b.workers_text)}" class="w-full border rounded px-2 py-1.5 text-sm" placeholder="例: 中村隆、中村清" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-[11px] text-slate-500 mb-0.5">運搬車両メモ</label>
              <input type="text" data-im-field="vehicle_note" data-im-i="${i}" value="${esc(b.vehicle_note)}" class="w-full border rounded px-2 py-1.5 text-sm" placeholder="例: 4トン運搬" />
            </div>
          </div>
          ${qtyConflictHtml}
        </div>
      `;
    }).join('');
    wrap.innerHTML = html;
  }

  function onImportFieldInput(e) {
    const el = e.target.closest('[data-im-field]');
    if (!el) return;
    const i = Number(el.dataset.imI);
    const field = el.dataset.imField;
    if (!state.importBlocks[i]) return;
    let v = el.value;
    if (field === 'quantity' || field === 'manpower') v = Number(v) || 0;
    state.importBlocks[i][field] = v;
    // 内容を変更した瞬間、失敗状態 ('ng') を解除して再登録可能にする
    if (state.importBlocks[i].commit_status === 'ng') {
      state.importBlocks[i].commit_status = '';
      state.importBlocks[i].commit_error = '';
    }
    // 数量・部位・現場・元請の変更で既存マッチが変わる可能性 → 再描画(マッチバッジと衝突表示更新)
    if (field === 'contractor' || field === 'site_name' || field === 'part' || field === 'quantity') {
      // フォーカス維持のため最小再描画: 即座に renderImportBlocks() を呼ぶとフォーカスが飛ぶので debounce
      clearTimeout(window._imRe);
      window._imRe = setTimeout(() => {
        const active = document.activeElement;
        const aSel = active && active.dataset && active.dataset.imField
          ? `[data-im-i="${active.dataset.imI}"][data-im-field="${active.dataset.imField}"]`
          : null;
        const aStart = active && 'selectionStart' in active ? active.selectionStart : null;
        const aEnd   = active && 'selectionEnd'   in active ? active.selectionEnd   : null;
        renderImportBlocks();
        if (aSel) {
          const next = $(aSel);
          if (next) {
            next.focus();
            try { if (aStart != null && aEnd != null) next.setSelectionRange(aStart, aEnd); } catch {}
          }
        }
      }, 300);
    }
  }

  function onImportQtyStrategyChange(e) {
    const el = e.target.closest('[data-im-qty]');
    if (!el) return;
    const i = Number(el.dataset.imQty);
    if (!state.importBlocks[i]) return;
    state.importBlocks[i].qty_strategy = el.value;
  }

  function removeImportBlock(i) {
    if (!state.importBlocks[i]) return;
    state.importBlocks.splice(i, 1);
    // インデックス振り直し
    state.importBlocks.forEach((b, k) => (b.idx = k));
    $('#im-summary').textContent = String(state.importBlocks.length);
    renderImportBlocks();
  }

  function resetImport() {
    if (state.importBlocks.length && !confirm('読み取り結果をクリアします。よろしいですか？')) return;
    state.importBlocks = [];
    const t = $('#im-text'); if (t) t.value = '';
    const d = $('#im-date'); if (d) d.value = '';
    $('#im-result-wrap')?.classList.add('hidden');
    $('#im-list').innerHTML = '';
    $('#im-summary').textContent = '0';
  }

  function cancelImport() {
    if (state.importBlocks.length && !confirm('読み取り結果を破棄します。よろしいですか？')) return;
    state.importBlocks = [];
    $('#im-result-wrap')?.classList.add('hidden');
    $('#im-list').innerHTML = '';
    $('#im-summary').textContent = '0';
  }

  async function commitImport() {
    if (!state.importBlocks.length) { toast('登録する内容がありません', true); return; }

    // 「未登録 + 失敗」のカードのみを対象にする
    // (commit_status === 'ok' のカードは既に成功しているのでスキップ)
    const targets = [];
    state.importBlocks.forEach((b, i) => {
      if (b.commit_status === 'ok') return;
      targets.push({ b, originalIdx: i });
    });
    if (!targets.length) { toast('登録する内容がありません (すべて登録済みです)', true); return; }

    // クライアントサイドの軽いバリデーション → 失敗扱いとしてカードに反映 (送信はしない)
    const clientErrors = [];
    targets.forEach(({ b, originalIdx }) => {
      const errs = [];
      if (!b.contractor?.trim()) errs.push('元請が空欄です');
      if (!b.site_name?.trim())  errs.push('現場名が空欄です');
      if (!b.part?.trim())       errs.push('部位が空欄です');
      if (!b.work_date)          errs.push('取付日が空欄です');
      if (errs.length) clientErrors.push({ originalIdx, msg: errs.join(' / ') });
    });

    if (!confirm(`${targets.length} 件を登録します。よろしいですか？`)) return;

    // クライアントエラー分は失敗カードとしてマーク
    clientErrors.forEach(({ originalIdx, msg }) => {
      const b = state.importBlocks[originalIdx];
      if (b) {
        b.commit_status = 'ng';
        b.commit_error = msg;
      }
    });

    // クライアントエラーが無いカードだけサーバへ送信
    const serverTargets = targets.filter(t => !clientErrors.find(ce => ce.originalIdx === t.originalIdx));

    if (!serverTargets.length) {
      // 全件クライアントエラー
      renderImportBlocks();
      toast('入力エラーがあります。各カードのエラー内容を確認してください', true);
      return;
    }

    // 送信用ペイロード (送信順 index → originalIdx の対応表)
    const blocks = serverTargets.map(({ b }) => ({
      contractor: b.contractor.trim(),
      site_name: b.site_name.trim(),
      part: (b.part || '').trim(),
      quantity: Number(b.quantity) || 0,
      manpower: Number(b.manpower) || 0,
      workers: (b.workers_text || '')
        .split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean),
      vehicle_note: (b.vehicle_note || '').trim(),
      work_date: b.work_date,
      qty_strategy: b.qty_strategy || 'overwrite',
    }));

    try {
      const { data } = await api.post('/import/commit', { blocks });
      const results = data?.results || [];

      // 結果を元のカードに反映 (送信時の index → originalIdx)
      results.forEach((r) => {
        const target = serverTargets[r.index];
        if (!target) return;
        const b = state.importBlocks[target.originalIdx];
        if (!b) return;
        if (r.ok) {
          b.commit_status = 'ok';
          b.commit_error = '';
        } else {
          b.commit_status = 'ng';
          b.commit_error = r.error || '不明なエラー';
        }
      });

      // 全体集計 (クライアントエラー + サーバ結果)
      const okCount = state.importBlocks.filter(b => b.commit_status === 'ok').length;
      const ngCount = state.importBlocks.filter(b => b.commit_status === 'ng').length;

      // 既存リスト更新 + サジェスト再取得
      try {
        const ex = await api.get('/import/existing');
        state.importExisting = ex.data || { sites: [], site_parts: [] };
      } catch {}
      await loadSuggestions();

      if (ngCount === 0) {
        // 全件成功 → 読み取り結果をクリア
        const totalOk = okCount;
        state.importBlocks = [];
        $('#im-text').value = '';
        $('#im-result-wrap')?.classList.add('hidden');
        $('#im-list').innerHTML = '';
        $('#im-summary').textContent = '0';
        alert(`登録完了: ${totalOk} 件すべて成功しました`);
        toast(`登録完了 (${totalOk} 件成功)`);
      } else {
        // 一部失敗 → 成功カードは画面から消し、失敗カードのみ残す
        state.importBlocks = state.importBlocks.filter(b => b.commit_status !== 'ok');
        // 残ったカードは「失敗」状態。表示用にインデックスを振り直すが、commit_status は維持
        state.importBlocks.forEach((b, k) => (b.idx = k));
        $('#im-summary').textContent = String(state.importBlocks.length);
        renderImportBlocks();
        alert(`登録完了: 成功 ${okCount} 件 / 失敗 ${ngCount} 件\n失敗したデータを修正して再度「DBに登録」を押してください`);
        toast(`成功 ${okCount} 件 / 失敗 ${ngCount} 件`, true);
      }
    } catch (e) {
      // ネットワーク等の致命的エラー: 状態は触らない
      apiErr(e, '一括登録に失敗しました');
    }
  }

  // ============================================================
  // イベント登録
  // ============================================================
  function bindEvents() {
    // 上部タブ
    $$('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    // 戻るボタン
    document.addEventListener('click', (e) => {
      const back = e.target.closest('.back-btn'); if (!back) return;
      const to = back.dataset.back;
      if (to === 'sites') showTab('sites');
      else if (to === 'site-parts') showTab('site-parts');
    });
    // パンくず
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-bc]'); if (!a) return;
      e.preventDefault();
      const to = a.dataset.bc;
      if (to === 'sites') showTab('sites');
      else if (to === 'site-parts') showTab('site-parts');
    });

    // 現場一覧
    $('#sites-new')?.addEventListener('click', () => openSiteModal(null));
    $('#new-site-btn')?.addEventListener('click', () => openSiteModal(null));
    $('#sites-search')?.addEventListener('input', () => {
      clearTimeout(window._st); window._st = setTimeout(loadSites, 300);
    });
    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-site-open]');
      const ed   = e.target.closest('[data-site-edit]');
      const dl   = e.target.closest('[data-site-del]');
      if (open) openSitePartsScreen(open.dataset.siteOpen);
      else if (ed) editSite(ed.dataset.siteEdit);
      else if (dl) deleteSite(dl.dataset.siteDel);
    });

    // 現場モーダル
    $('#site-modal-close')?.addEventListener('click', closeSiteModal);
    $('#site-modal-cancel')?.addEventListener('click', closeSiteModal);
    $('#site-form')?.addEventListener('submit', submitSite);

    // 部位・数量
    $('#sp-form')?.addEventListener('submit', submitSitePart);
    $('#sp-reset')?.addEventListener('click', resetSpForm);
    $('#sp-edit-site')?.addEventListener('click', () => {
      if (state.currentSite) editSite(state.currentSite.id);
    });
    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-sp-open]');
      const ed   = e.target.closest('[data-sp-edit]');
      const dl   = e.target.closest('[data-sp-del]');
      if (open) openInstallationsScreen(open.dataset.spOpen);
      else if (ed) editSitePart(ed.dataset.spEdit);
      else if (dl) deleteSitePart(dl.dataset.spDel);
    });

    // 取付実績
    $('#ix-form')?.addEventListener('submit', submitInstallation);
    $('#ix-reset')?.addEventListener('click', resetIxForm);
    $('#ix-add-worker')?.addEventListener('click', addWorkerChip);
    $('#ix-f-worker-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addWorkerChip(); }
    });
    $('#ix-export')?.addEventListener('click', exportIxCsv);
    document.addEventListener('click', (e) => {
      const ed = e.target.closest('[data-ix-edit]');
      const dl = e.target.closest('[data-ix-del]');
      const rm = e.target.closest('[data-rm-worker]');
      if (ed) editInstallation(ed.dataset.ixEdit);
      else if (dl) deleteInstallation(dl.dataset.ixDel);
      else if (rm) {
        const i = Number(rm.dataset.rmWorker);
        state.ixWorkers.splice(i, 1);
        renderIxWorkerChips();
      }
    });
    // ステップボタン
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]'); if (!b) return;
      handleStepClick(b);
    });

    // ダッシュボード
    $('#dash-apply')?.addEventListener('click', loadDashboard);
    $('#dash-clear')?.addEventListener('click', () => {
      $('#dash-from').value = ''; $('#dash-to').value = ''; loadDashboard();
    });

    // 分析
    $('#an-apply')?.addEventListener('click', loadAnalysis);
    $('#an-clear')?.addEventListener('click', () => {
      ['#an-from', '#an-to', '#an-contractor', '#an-site', '#an-part', '#an-worker'].forEach(s => { const el = $(s); if (el) el.value = ''; });
      loadAnalysis();
    });
    $('#an-export')?.addEventListener('click', exportAnCsv);

    // 部位マスタ
    $('#part-add')?.addEventListener('click', addPart);
    $('#part-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPart(); } });
    document.addEventListener('click', (e) => {
      const ed = e.target.closest('[data-part-edit]');
      const dl = e.target.closest('[data-part-del]');
      if (ed) editPart(ed.dataset.partEdit, ed.dataset.name);
      else if (dl) deletePart(dl.dataset.partDel);
    });

    // テキスト取込
    $('#im-parse')?.addEventListener('click', parseImport);
    $('#im-reset')?.addEventListener('click', resetImport);
    $('#im-cancel')?.addEventListener('click', cancelImport);
    $('#im-commit')?.addEventListener('click', commitImport);
    // 動的フィールドの編集
    document.addEventListener('input', (e) => {
      if (e.target.closest && e.target.closest('[data-im-field]')) onImportFieldInput(e);
    });
    document.addEventListener('change', (e) => {
      if (e.target.closest && e.target.closest('[data-im-qty]')) onImportQtyStrategyChange(e);
    });
    // 削除ボタン
    document.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-im-remove]');
      if (rm) {
        const i = Number(rm.dataset.imRemove);
        removeImportBlock(i);
      }
    });
  }

  // ============================================================
  // 認証ゲート (シンプルなフロントエンドパスワード)
  // ============================================================
  const AUTH_PASSWORD = 'torituke';
  const AUTH_KEY = 'murata_rebar_auth_v1';
  let appInitialized = false;

  function isAuthed() {
    try {
      return localStorage.getItem(AUTH_KEY) === '1' || sessionStorage.getItem(AUTH_KEY) === '1';
    } catch { return false; }
  }
  function setAuthed() {
    try { localStorage.setItem(AUTH_KEY, '1'); } catch {}
  }
  function clearAuthed() {
    try { localStorage.removeItem(AUTH_KEY); } catch {}
    try { sessionStorage.removeItem(AUTH_KEY); } catch {}
  }

  function showLogin() {
    const login = $('#login-screen');
    const root  = $('#app-root');
    if (login) login.classList.remove('hidden');
    if (root)  root.classList.add('hidden');
    setTimeout(() => $('#login-pw')?.focus(), 50);
  }

  function hideLogin() {
    const login = $('#login-screen');
    const root  = $('#app-root');
    if (login) login.classList.add('hidden');
    if (root)  root.classList.remove('hidden');
  }

  function bindLoginEvents() {
    const form = $('#login-form');
    const pw   = $('#login-pw');
    const err  = $('#login-error');
    const tgl  = $('#login-pw-toggle');

    // 入力中はエラー非表示
    pw?.addEventListener('input', () => err?.classList.add('hidden'));

    // パスワード表示切替
    tgl?.addEventListener('click', () => {
      if (!pw) return;
      const isPw = pw.type === 'password';
      pw.type = isPw ? 'text' : 'password';
      tgl.innerHTML = isPw ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (pw?.value || '');
      if (val === AUTH_PASSWORD) {
        setAuthed();
        if (pw) pw.value = '';
        hideLogin();
        await enterApp();
      } else {
        err?.classList.remove('hidden');
        if (pw) { pw.focus(); pw.select(); }
      }
    });

    // ログアウトボタン (ヘッダ内、app-root配下)
    $('#logout-btn')?.addEventListener('click', () => {
      if (!confirm('ログアウトしますか？')) return;
      clearAuthed();
      // 各種state をリセット
      state.currentSite = null;
      state.currentPart = null;
      showLogin();
    });
  }

  async function enterApp() {
    if (appInitialized) {
      // 再ログイン時は最新データを表示するため sites を再ロード
      showTab('sites');
      return;
    }
    appInitialized = true;
    bindEvents();
    await loadParts(false);
    await loadSuggestions();
    showTab('sites');
  }

  async function bootstrap() {
    bindLoginEvents();
    if (isAuthed()) {
      hideLogin();
      await enterApp();
    } else {
      showLogin();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // --- 開発/QA 用: URL ハッシュ #reset-auth で認証状態を消去できる ---
  if (typeof window !== 'undefined' && window.location && window.location.hash === '#reset-auth') {
    clearAuthed();
    window.location.hash = '';
  }
})();
