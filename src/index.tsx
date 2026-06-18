import { Hono } from 'hono'
import { renderer } from './renderer'
import api from './api'

type Bindings = { DB: D1Database }
const app = new Hono<{ Bindings: Bindings }>()
app.route('/api', api)
app.use(renderer)

app.get('/', (c) => {
  return c.render(
    <>
      {/* ============== ログイン画面（最初に表示） ============== */}
      <div id="login-screen" class="fixed inset-0 z-[100] bg-gradient-to-br from-blue-800 to-blue-500 flex items-center justify-center p-4">
        <div class="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
          <div class="text-center mb-6">
            <div class="w-16 h-16 mx-auto mb-3 bg-yellow-400 rounded-full flex items-center justify-center shadow-md">
              <i class="fas fa-hard-hat text-blue-900 text-3xl"></i>
            </div>
            <div class="text-xs text-slate-500">村田鉄筋㈱</div>
            <h1 class="text-lg font-bold text-slate-800 mt-1">取付数量分析アプリ</h1>
            <div class="text-xs text-slate-500 mt-2"><i class="fas fa-lock mr-1"></i>ログインしてください</div>
          </div>
          <form id="login-form" class="space-y-4" autocomplete="off">
            <div>
              <label for="login-pw" class="block text-sm font-semibold text-slate-700 mb-1">パスワード</label>
              <div class="relative">
                <input
                  type="password"
                  id="login-pw"
                  required
                  autocomplete="current-password"
                  inputmode="text"
                  class="w-full border-2 border-slate-300 rounded-lg px-3 py-3 pr-12 text-base focus:border-blue-500"
                  placeholder="パスワードを入力"
                />
                <button
                  type="button"
                  id="login-pw-toggle"
                  aria-label="パスワード表示切替"
                  class="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-slate-500 hover:text-slate-700"
                >
                  <i class="fas fa-eye"></i>
                </button>
              </div>
              <div id="login-error" class="text-red-600 text-sm mt-2 hidden">
                <i class="fas fa-circle-exclamation mr-1"></i>パスワードが違います
              </div>
            </div>
            <button
              type="submit"
              class="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-3 rounded-lg text-base shadow-md"
            >
              <i class="fas fa-right-to-bracket mr-2"></i>ログイン
            </button>
          </form>
          <div class="text-[10px] text-slate-400 text-center mt-5">© 村田鉄筋㈱</div>
        </div>
      </div>

      {/* ============== アプリ本体（ログイン後に表示） ============== */}
      <div id="app-root" class="min-h-screen flex flex-col hidden">
      {/* ヘッダ */}
      <header class="bg-gradient-to-r from-blue-800 to-blue-600 text-white shadow-lg sticky top-0 z-40">
        <div class="max-w-7xl mx-auto px-3 py-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <i class="fas fa-hard-hat text-yellow-300 text-2xl"></i>
            <div>
              <div class="text-xs opacity-90 leading-tight">村田鉄筋㈱</div>
              <div class="text-base sm:text-lg font-bold leading-tight">取付数量分析アプリ</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button id="new-site-btn" class="bg-yellow-400 hover:bg-yellow-300 text-blue-900 font-bold rounded-full px-3 py-2 text-sm shadow-md">
              <i class="fas fa-plus mr-1"></i>現場を追加
            </button>
            <button id="logout-btn" title="ログアウト" class="bg-white/10 hover:bg-white/20 text-white rounded-full px-3 py-2 text-sm">
              <i class="fas fa-right-from-bracket"></i><span class="hidden sm:inline ml-1">ログアウト</span>
            </button>
          </div>
        </div>
        <nav class="bg-blue-900/90 overflow-x-auto">
          <div class="max-w-7xl mx-auto px-1 flex gap-1 min-w-max">
            <button data-tab="sites" class="tab-btn px-4 py-2 text-sm font-semibold text-white border-b-4 border-yellow-400">
              <i class="fas fa-folder-open mr-1"></i>現場一覧
            </button>
            <button data-tab="dashboard" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-chart-pie mr-1"></i>ダッシュボード
            </button>
            <button data-tab="analysis" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-magnifying-glass-chart mr-1"></i>集計・分析
            </button>
            <button data-tab="import" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-file-import mr-1"></i>テキスト取込
            </button>
            <button data-tab="settings" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-gear mr-1"></i>部位マスタ
            </button>
          </div>
        </nav>
        {/* パンくず */}
        <div id="breadcrumb" class="bg-blue-50 text-blue-900 px-3 py-1.5 text-xs flex items-center gap-1 hidden overflow-x-auto whitespace-nowrap"></div>
      </header>

      <main class="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5">
        {/* ============== ① 現場一覧 ============== */}
        <section id="tab-sites" class="tab-pane">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 class="text-lg font-bold text-slate-700 flex items-center gap-2">
              <i class="fas fa-folder-open text-blue-600"></i>現場一覧
            </h2>
            <div class="flex gap-2">
              <input type="text" id="sites-search" placeholder="元請/現場で検索" class="border rounded px-3 py-1.5 text-sm" />
              <button id="sites-new" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm font-semibold">
                <i class="fas fa-plus mr-1"></i>新規登録
              </button>
            </div>
          </div>
          <p class="text-xs text-slate-500 mb-2"><i class="fas fa-info-circle mr-1"></i>まず「元請・現場名」を登録します。その後カードから部位・数量の登録に進みます。</p>
          <div id="sites-list" class="grid grid-cols-1 md:grid-cols-2 gap-3"></div>
        </section>

        {/* ============== ② 現場の中の 部位・数量 一覧 ============== */}
        <section id="tab-site-parts" class="tab-pane hidden">
          <button class="back-btn text-sm text-blue-700 hover:underline mb-2" data-back="sites">
            <i class="fas fa-arrow-left mr-1"></i>現場一覧に戻る
          </button>

          {/* 現場ヘッダ */}
          <div class="bg-white rounded-lg shadow p-4 mb-3 flex items-center justify-between flex-wrap gap-2">
            <div class="flex-1 min-w-[180px]">
              <div class="text-xs text-slate-500">元請</div>
              <div id="sp-contractor" class="text-base font-bold text-slate-800"></div>
              <div class="text-xs text-slate-500 mt-1">現場名</div>
              <div id="sp-site-name" class="text-lg font-bold text-blue-800"></div>
            </div>
            <button id="sp-edit-site" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1.5 rounded">
              <i class="fas fa-pen mr-1"></i>現場情報を編集
            </button>
          </div>

          {/* 部位・数量 追加フォーム */}
          <div class="bg-white rounded-lg shadow p-4 mb-3">
            <h3 class="font-bold text-slate-700 mb-3 flex items-center gap-2">
              <i class="fas fa-plus-square text-blue-600"></i>
              <span id="sp-form-title">部位・数量を追加</span>
            </h3>
            <form id="sp-form" class="space-y-3 max-w-2xl">
              <input type="hidden" id="sp-f-id" />
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm font-semibold text-slate-700 mb-1">部位 <span class="text-red-500">*</span></label>
                  <select id="sp-f-part" required class="w-full border rounded px-3 py-2 text-base bg-white"></select>
                </div>
                <div>
                  <label class="block text-sm font-semibold text-slate-700 mb-1">登録数量 (kg) <span class="text-red-500">*</span></label>
                  <input type="number" id="sp-f-qty" required step="0.01" min="0" inputmode="decimal" placeholder="例: 5000" class="w-full border rounded px-3 py-2 text-base text-right" />
                </div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">備考</label>
                <input type="text" id="sp-f-note" class="w-full border rounded px-3 py-2 text-base" />
              </div>
              <div class="flex gap-2 pt-1">
                <button type="submit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded text-base shadow">
                  <i class="fas fa-plus mr-1"></i><span id="sp-submit-label">追加する</span>
                </button>
                <button type="button" id="sp-reset" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 rounded text-sm">
                  クリア
                </button>
              </div>
            </form>
          </div>

          {/* 部位・数量 一覧 */}
          <div class="bg-white rounded-lg shadow p-3 overflow-x-auto">
            <h3 class="font-bold text-slate-700 mb-2 flex items-center gap-2 text-sm">
              <i class="fas fa-list-ul text-blue-600"></i>登録済み部位・数量
            </h3>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">部位</th>
                  <th class="px-2 py-2 text-right">登録数量 (kg)</th>
                  <th class="px-2 py-2 text-right">取付日数</th>
                  <th class="px-2 py-2 text-right">合計人工</th>
                  <th class="px-2 py-2 text-right">kg/人工</th>
                  <th class="px-2 py-2 text-right">搬入車両</th>
                  <th class="px-2 py-2 text-right">通勤車両</th>
                  <th class="px-2 py-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody id="sp-list"></tbody>
            </table>
          </div>
        </section>

        {/* ============== ③ 部位の中の 取付実績 一覧 ============== */}
        <section id="tab-installations" class="tab-pane hidden">
          <button class="back-btn text-sm text-blue-700 hover:underline mb-2" data-back="site-parts">
            <i class="fas fa-arrow-left mr-1"></i>部位一覧に戻る
          </button>

          {/* 部位ヘッダ */}
          <div class="bg-white rounded-lg shadow p-4 mb-3">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="flex-1 min-w-0">
                <div class="text-xs text-slate-500"><span id="ix-contractor"></span> / <span id="ix-site-name"></span></div>
                <div class="text-lg font-bold text-blue-800 mt-1">
                  <i class="fas fa-cube mr-1 text-blue-500"></i><span id="ix-part"></span>
                  <span class="text-sm text-slate-500 ml-2">登録数量: <span id="ix-reg-qty" class="font-bold text-slate-700">0</span> kg</span>
                </div>
              </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
              <div class="bg-slate-50 rounded p-2 text-center"><div class="text-[10px] text-slate-500">取付日数</div><div class="text-base font-bold text-slate-700"><span id="ix-days">0</span></div></div>
              <div class="bg-slate-50 rounded p-2 text-center"><div class="text-[10px] text-slate-500">合計人工</div><div class="text-base font-bold text-green-700"><span id="ix-mp">0</span></div></div>
              <div class="bg-slate-50 rounded p-2 text-center"><div class="text-[10px] text-slate-500">kg/人工</div><div class="text-base font-bold text-orange-600"><span id="ix-per">0</span></div></div>
              <div class="bg-slate-50 rounded p-2 text-center"><div class="text-[10px] text-slate-500">搬入車両合計</div><div class="text-base font-bold text-slate-700"><span id="ix-deliv">0</span><span class="text-xs">台</span></div></div>
              <div class="bg-slate-50 rounded p-2 text-center"><div class="text-[10px] text-slate-500">通勤車両合計</div><div class="text-base font-bold text-slate-700"><span id="ix-commu">0</span><span class="text-xs">台</span></div></div>
            </div>
          </div>

          {/* 取付実績 入力フォーム */}
          <div class="bg-white rounded-lg shadow p-4 mb-3">
            <h3 class="font-bold text-slate-700 mb-3 flex items-center gap-2">
              <i class="fas fa-pen-to-square text-blue-600"></i>
              <span id="ix-form-title">取付実績を追加</span>
            </h3>
            <form id="ix-form" class="space-y-3 max-w-2xl">
              <input type="hidden" id="ix-f-id" />
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">取付日 <span class="text-red-500">*</span></label>
                <input type="date" id="ix-f-date" required class="w-full border rounded px-3 py-2 text-base" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">人員名（複数可）</label>
                <div id="ix-worker-chips" class="flex flex-wrap gap-1 mb-2"></div>
                <div class="flex gap-2">
                  <input list="dl-workers" id="ix-f-worker-input" placeholder="人員名を入力して追加" class="flex-1 border rounded px-3 py-2 text-base" />
                  <datalist id="dl-workers"></datalist>
                  <button type="button" id="ix-add-worker" class="bg-slate-700 hover:bg-slate-800 text-white px-3 rounded text-sm font-semibold">追加</button>
                </div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">人工数 <span class="text-red-500">*</span></label>
                <div class="flex items-center gap-2">
                  <button type="button" data-step="manpower" data-delta="-0.5" class="step-btn">−</button>
                  <input type="number" id="ix-f-mp" required step="0.1" min="0" inputmode="decimal" placeholder="例: 2.5" class="flex-1 border rounded px-3 py-2 text-base text-center font-bold text-lg" />
                  <button type="button" data-step="manpower" data-delta="0.5" class="step-btn">+</button>
                </div>
                <div class="text-[11px] text-slate-400 mt-1">小数（0.5 / 1.5 等）入力可</div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm font-semibold text-slate-700 mb-1">搬入車両 (台)</label>
                  <div class="flex items-center gap-2">
                    <button type="button" data-step="deliv" data-delta="-1" class="step-btn">−</button>
                    <input type="number" id="ix-f-deliv" step="1" min="0" inputmode="numeric" placeholder="0" value="0" class="flex-1 border rounded px-3 py-2 text-base text-center font-bold text-lg" />
                    <button type="button" data-step="deliv" data-delta="1" class="step-btn">+</button>
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-semibold text-slate-700 mb-1">通勤車両 (台)</label>
                  <div class="flex items-center gap-2">
                    <button type="button" data-step="commu" data-delta="-1" class="step-btn">−</button>
                    <input type="number" id="ix-f-commu" step="1" min="0" inputmode="numeric" placeholder="0" value="0" class="flex-1 border rounded px-3 py-2 text-base text-center font-bold text-lg" />
                    <button type="button" data-step="commu" data-delta="1" class="step-btn">+</button>
                  </div>
                </div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">備考</label>
                <textarea id="ix-f-note" rows={2} class="w-full border rounded px-3 py-2 text-base"></textarea>
              </div>
              <div class="flex gap-2 pt-1">
                <button type="submit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded text-base shadow">
                  <i class="fas fa-plus mr-1"></i><span id="ix-submit-label">追加する</span>
                </button>
                <button type="button" id="ix-reset" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 rounded text-sm">
                  クリア
                </button>
              </div>
            </form>
          </div>

          {/* 取付実績 一覧 */}
          <div class="bg-white rounded-lg shadow p-3 overflow-x-auto">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-bold text-slate-700 flex items-center gap-2 text-sm">
                <i class="fas fa-list-ul text-blue-600"></i>取付実績一覧
              </h3>
              <button id="ix-export" class="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded">
                <i class="fas fa-file-csv mr-1"></i>CSV
              </button>
            </div>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">取付日</th>
                  <th class="px-2 py-2 text-left">人員名</th>
                  <th class="px-2 py-2 text-right">人工数</th>
                  <th class="px-2 py-2 text-right">搬入車両</th>
                  <th class="px-2 py-2 text-right">通勤車両</th>
                  <th class="px-2 py-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody id="ix-list"></tbody>
            </table>
          </div>
        </section>

        {/* ============== ダッシュボード ============== */}
        <section id="tab-dashboard" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-chart-pie text-blue-600"></i>ダッシュボード
          </h2>
          <div class="bg-white rounded-lg shadow p-3 mb-4 flex flex-wrap gap-2 items-end">
            <div>
              <label class="block text-xs text-slate-500 mb-1">期間 開始</label>
              <input type="date" id="dash-from" class="border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-500 mb-1">期間 終了</label>
              <input type="date" id="dash-to" class="border rounded px-2 py-1.5 text-sm" />
            </div>
            <button id="dash-apply" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-semibold">
              <i class="fas fa-filter mr-1"></i>適用
            </button>
            <button id="dash-clear" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded text-sm">
              <i class="fas fa-rotate-left mr-1"></i>クリア
            </button>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">総登録数量</div><div class="text-xl font-bold text-blue-700 mt-1"><span id="kpi-total-qty">0</span><span class="text-xs font-normal text-slate-500"> kg</span></div></div>
            <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">総人工数</div><div class="text-xl font-bold text-green-700 mt-1"><span id="kpi-total-mp">0</span><span class="text-xs font-normal text-slate-500"> 人工</span></div></div>
            <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">kg/人工</div><div class="text-xl font-bold text-orange-600 mt-1"><span id="kpi-per-mp">0</span></div></div>
            <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">搬入車両合計</div><div class="text-xl font-bold text-slate-700 mt-1"><span id="kpi-deliv">0</span><span class="text-xs font-normal text-slate-500"> 台</span></div></div>
            <div class="bg-white rounded-lg shadow p-3"><div class="text-xs text-slate-500">通勤車両合計</div><div class="text-xl font-bold text-slate-700 mt-1"><span id="kpi-commu">0</span><span class="text-xs font-normal text-slate-500"> 台</span></div></div>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-ranking-star text-yellow-500 mr-1"></i>現場別 登録数量</h3>
              <div class="h-56"><canvas id="chart-site"></canvas></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-cubes text-blue-500 mr-1"></i>部位別 登録数量</h3>
              <div class="h-56"><canvas id="chart-part"></canvas></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-user-hard-hat text-green-600 mr-1"></i>人員別 人工数</h3>
              <div class="h-56"><canvas id="chart-worker"></canvas></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-building text-blue-600 mr-1"></i>元請別 登録数量</h3>
              <div class="h-56"><canvas id="chart-contractor"></canvas></div>
            </div>
          </div>
        </section>

        {/* ============== 集計・分析 ============== */}
        <section id="tab-analysis" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-magnifying-glass-chart text-blue-600"></i>集計・分析
          </h2>
          <div class="bg-white rounded-lg shadow p-3 mb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 items-end">
            <div><label class="block text-xs text-slate-500 mb-1">期間 開始</label><input type="date" id="an-from" class="w-full border rounded px-2 py-1.5 text-sm" /></div>
            <div><label class="block text-xs text-slate-500 mb-1">期間 終了</label><input type="date" id="an-to" class="w-full border rounded px-2 py-1.5 text-sm" /></div>
            <div><label class="block text-xs text-slate-500 mb-1">元請</label><select id="an-contractor" class="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="">すべて</option></select></div>
            <div><label class="block text-xs text-slate-500 mb-1">現場名</label><select id="an-site" class="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="">すべて</option></select></div>
            <div><label class="block text-xs text-slate-500 mb-1">部位</label><select id="an-part" class="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="">すべて</option></select></div>
            <div><label class="block text-xs text-slate-500 mb-1">人員名</label><select id="an-worker" class="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="">すべて</option></select></div>
            <div class="col-span-2 sm:col-span-3 lg:col-span-6 flex gap-2">
              <button id="an-apply" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-semibold"><i class="fas fa-filter mr-1"></i>絞り込み適用</button>
              <button id="an-clear" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded text-sm"><i class="fas fa-rotate-left mr-1"></i>クリア</button>
              <button id="an-export" class="ml-auto bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-semibold"><i class="fas fa-file-csv mr-1"></i>CSV出力</button>
            </div>
          </div>

          {/* 現場サマリ */}
          <div class="bg-white rounded-lg shadow p-3 mb-3 overflow-x-auto">
            <h3 class="font-semibold text-sm text-slate-700 mb-2"><i class="fas fa-table mr-1 text-blue-500"></i>現場一覧</h3>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">元請</th>
                  <th class="px-2 py-2 text-left">現場名</th>
                  <th class="px-2 py-2 text-right">合計数量</th>
                  <th class="px-2 py-2 text-right">取付日数</th>
                  <th class="px-2 py-2 text-right">合計人工</th>
                  <th class="px-2 py-2 text-right">kg/人工</th>
                  <th class="px-2 py-2 text-right">搬入車両</th>
                  <th class="px-2 py-2 text-right">通勤車両</th>
                </tr>
              </thead>
              <tbody id="an-site-summary"></tbody>
            </table>
          </div>

          {/* 部位サマリ */}
          <div class="bg-white rounded-lg shadow p-3 mb-3 overflow-x-auto">
            <h3 class="font-semibold text-sm text-slate-700 mb-2"><i class="fas fa-cubes mr-1 text-blue-500"></i>部位一覧</h3>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">元請</th>
                  <th class="px-2 py-2 text-left">現場名</th>
                  <th class="px-2 py-2 text-left">部位</th>
                  <th class="px-2 py-2 text-right">登録数量</th>
                  <th class="px-2 py-2 text-right">取付日数</th>
                  <th class="px-2 py-2 text-right">合計人工</th>
                  <th class="px-2 py-2 text-right">kg/人工</th>
                  <th class="px-2 py-2 text-right">搬入車両</th>
                  <th class="px-2 py-2 text-right">通勤車両</th>
                </tr>
              </thead>
              <tbody id="an-part-summary"></tbody>
            </table>
          </div>

          {/* 取付実績 */}
          <div class="bg-white rounded-lg shadow p-3 overflow-x-auto">
            <h3 class="font-semibold text-sm text-slate-700 mb-2"><i class="fas fa-list-ul mr-1 text-blue-500"></i>取付実績一覧</h3>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">取付日</th>
                  <th class="px-2 py-2 text-left">元請</th>
                  <th class="px-2 py-2 text-left">現場名</th>
                  <th class="px-2 py-2 text-left">部位</th>
                  <th class="px-2 py-2 text-left">人員名</th>
                  <th class="px-2 py-2 text-right">人工数</th>
                  <th class="px-2 py-2 text-right">搬入車両</th>
                  <th class="px-2 py-2 text-right">通勤車両</th>
                </tr>
              </thead>
              <tbody id="an-detail"></tbody>
            </table>
          </div>
        </section>

        {/* ============== テキスト取込 ============== */}
        <section id="tab-import" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-file-import text-blue-600"></i>テキスト取込（予定表貼り付け）
          </h2>
          <div class="bg-blue-50 border border-blue-200 rounded p-3 mb-3 text-xs text-blue-900 leading-relaxed">
            <i class="fas fa-info-circle mr-1"></i>
            予定表テキストを貼り付けて「読み取る」を押すと、元請・現場名・部位・数量・人工数・人員名・運搬車両を自動で抽出します。
            内容を確認・修正してから「一括登録」で保存します。
            <span class="block mt-1">※ 既存の現場・部位がある場合は自動で紐付けます。同じ部位の数量が既にある場合は確認します。</span>
          </div>

          {/* 入力エリア */}
          <div class="bg-white rounded-lg shadow p-4 mb-3">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div class="sm:col-span-1">
                <label class="block text-sm font-semibold text-slate-700 mb-1">取付日（任意・優先）</label>
                <input type="date" id="im-date" class="w-full border rounded px-3 py-2 text-base" />
                <div class="text-[10px] text-slate-400 mt-1">空欄ならテキスト内の日付を使用</div>
              </div>
              <div class="sm:col-span-2 flex items-end gap-2">
                <button type="button" id="im-parse" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded text-base shadow">
                  <i class="fas fa-magnifying-glass mr-1"></i>読み取る
                </button>
                <button type="button" id="im-reset" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 py-3 rounded text-sm">
                  <i class="fas fa-eraser mr-1"></i>クリア
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">テキスト貼り付け欄</label>
              <textarea id="im-text" rows={10} placeholder={'例：\nアムザ工務店、3日目、9960K、16人目‼️高徳寺町マンション新築工事(見積り書有り)‼️基礎‼️上京区不動前町付近‼️\n=中村隆、中村清、小泉組×4‼️\n4トン運搬、13時着、村田(剛)‼️\n\n達建工木造、3日目、6264K、19人目‼️...'} class="w-full border rounded px-3 py-2 text-sm font-mono leading-relaxed"></textarea>
              <div class="text-[10px] text-slate-400 mt-1">空行で1現場ブロックを区切ります</div>
            </div>
          </div>

          {/* 読み取り結果 */}
          <div id="im-result-wrap" class="hidden">
            <div class="bg-white rounded-lg shadow p-3 mb-3 flex items-center justify-between flex-wrap gap-2">
              <div class="text-sm text-slate-700">
                <i class="fas fa-list-check text-blue-600 mr-1"></i>
                読み取り結果：<span id="im-summary" class="font-bold text-blue-700">0</span> 件
              </div>
              <div class="flex gap-2">
                <button type="button" id="im-commit" class="bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2 rounded text-sm shadow">
                  <i class="fas fa-database mr-1"></i>一括登録
                </button>
                <button type="button" id="im-cancel" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 py-2 rounded text-sm">
                  <i class="fas fa-xmark mr-1"></i>キャンセル
                </button>
              </div>
            </div>
            <div id="im-list" class="space-y-3"></div>
          </div>
        </section>

        {/* ============== 部位マスタ ============== */}
        <section id="tab-settings" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-gear text-blue-600"></i>部位マスタ
          </h2>
          <div class="bg-white rounded-lg shadow p-4 max-w-xl">
            <p class="text-sm text-slate-600 mb-3">部位選択肢を追加・変更・削除できます。</p>
            <div class="flex gap-2 mb-3">
              <input type="text" id="part-input" placeholder="新しい部位名" class="flex-1 border rounded px-3 py-2 text-base" />
              <button id="part-add" class="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded font-semibold"><i class="fas fa-plus mr-1"></i>追加</button>
            </div>
            <ul id="part-list" class="divide-y border rounded"></ul>
          </div>
        </section>
      </main>

      {/* 現場登録モーダル */}
      <div id="site-modal" class="fixed inset-0 bg-black/40 z-50 hidden items-center justify-center p-3">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md">
          <div class="px-4 py-3 border-b flex justify-between items-center">
            <h3 id="site-modal-title" class="font-bold text-slate-800">現場を登録</h3>
            <button id="site-modal-close" class="text-slate-400 hover:text-slate-700"><i class="fas fa-xmark text-xl"></i></button>
          </div>
          <form id="site-form" class="p-4 space-y-3">
            <input type="hidden" id="sm-id" />
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">元請 <span class="text-red-500">*</span></label>
              <input type="text" id="sm-contractor" required placeholder="例: 〇〇建設" class="w-full border rounded px-3 py-2 text-base" />
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">現場名 <span class="text-red-500">*</span></label>
              <input type="text" id="sm-site-name" required placeholder="例: 京都市〇〇マンション新築工事" class="w-full border rounded px-3 py-2 text-base" />
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">備考</label>
              <textarea id="sm-note" rows={2} class="w-full border rounded px-3 py-2 text-base"></textarea>
            </div>
            <div class="flex gap-2 pt-2">
              <button type="submit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded text-base">
                <i class="fas fa-save mr-1"></i><span id="sm-submit-label">登録する</span>
              </button>
              <button type="button" id="site-modal-cancel" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 rounded text-sm">キャンセル</button>
            </div>
          </form>
        </div>
      </div>

      <div id="toast" class="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 hidden">
        <div id="toast-body" class="bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg"></div>
      </div>

      <footer class="bg-slate-200 text-slate-500 text-center text-xs py-3">© 村田鉄筋㈱ 取付数量分析アプリ</footer>
      </div>{/* /#app-root */}

      <script src="/static/app.js"></script>
    </>
  )
})

export default app
