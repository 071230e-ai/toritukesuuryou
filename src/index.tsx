import { Hono } from 'hono'
import { renderer } from './renderer'
import api from './api'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// APIルート（renderer 適用前にマウント）
app.route('/api', api)

// 以降のページは renderer を適用
app.use(renderer)

// 共通レイアウト（SPA 風 / タブ切替）
app.get('/', (c) => {
  return c.render(
    <div class="min-h-screen flex flex-col">
      {/* ヘッダー */}
      <header class="bg-gradient-to-r from-blue-800 to-blue-600 text-white shadow-lg sticky top-0 z-40">
        <div class="max-w-7xl mx-auto px-3 py-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <i class="fas fa-hard-hat text-yellow-300 text-2xl"></i>
            <div>
              <div class="text-xs opacity-90 leading-tight">村田鉄筋㈱</div>
              <div class="text-base sm:text-lg font-bold leading-tight">取付数量分析アプリ</div>
            </div>
          </div>
          <button id="quick-add-btn" class="bg-yellow-400 hover:bg-yellow-300 text-blue-900 font-bold rounded-full px-4 py-2 text-sm shadow-md">
            <i class="fas fa-plus mr-1"></i>新規入力
          </button>
        </div>
        {/* タブ */}
        <nav class="bg-blue-900/90 overflow-x-auto">
          <div class="max-w-7xl mx-auto px-1 flex gap-1 min-w-max">
            <button data-tab="dashboard" class="tab-btn px-4 py-2 text-sm font-semibold text-white border-b-4 border-yellow-400">
              <i class="fas fa-chart-pie mr-1"></i>ダッシュボード
            </button>
            <button data-tab="input" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-pen-to-square mr-1"></i>入力
            </button>
            <button data-tab="analysis" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-magnifying-glass-chart mr-1"></i>現場別分析
            </button>
            <button data-tab="list" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-list mr-1"></i>一覧
            </button>
            <button data-tab="settings" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-gear mr-1"></i>部位設定
            </button>
          </div>
        </nav>
      </header>

      {/* メイン */}
      <main class="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5">
        {/* ダッシュボード */}
        <section id="tab-dashboard" class="tab-pane">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-chart-pie text-blue-600"></i>ダッシュボード
          </h2>
          {/* 期間フィルタ */}
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

          {/* KPIカード */}
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <div class="bg-white rounded-lg shadow p-4">
              <div class="text-xs text-slate-500">総取付数量</div>
              <div class="text-2xl font-bold text-blue-700 mt-1"><span id="kpi-total-qty">0</span><span class="text-sm font-normal text-slate-500"> kg</span></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
              <div class="text-xs text-slate-500">総人工数</div>
              <div class="text-2xl font-bold text-green-700 mt-1"><span id="kpi-total-mp">0</span><span class="text-sm font-normal text-slate-500"> 人工</span></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4 col-span-2 md:col-span-1">
              <div class="text-xs text-slate-500">全体の1人工あたり取付数量</div>
              <div class="text-2xl font-bold text-orange-600 mt-1"><span id="kpi-per-mp">0</span><span class="text-sm font-normal text-slate-500"> kg/人工</span></div>
            </div>
          </div>

          {/* ランキング */}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-ranking-star text-yellow-500 mr-1"></i>元請別 取付数量ランキング</h3>
              <div class="h-56"><canvas id="chart-contractor"></canvas></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-ranking-star text-yellow-500 mr-1"></i>現場別 取付数量ランキング</h3>
              <div class="h-56"><canvas id="chart-site"></canvas></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-cubes text-blue-500 mr-1"></i>部位別 取付数量</h3>
              <div class="h-56"><canvas id="chart-part"></canvas></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-user-hard-hat text-green-600 mr-1"></i>人員別 取付数量</h3>
              <div class="h-56"><canvas id="chart-worker"></canvas></div>
            </div>
          </div>
        </section>

        {/* 入力 */}
        <section id="tab-input" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-pen-to-square text-blue-600"></i>取付数量入力
          </h2>
          <form id="install-form" class="bg-white rounded-lg shadow p-4 space-y-3 max-w-2xl">
            <input type="hidden" id="f-id" />
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">日付 <span class="text-red-500">*</span></label>
              <input type="date" id="f-date" required class="w-full border rounded px-3 py-2 text-base" />
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">元請 <span class="text-red-500">*</span></label>
              <input list="dl-contractors" id="f-contractor" required placeholder="元請会社名を入力 / 選択" class="w-full border rounded px-3 py-2 text-base" />
              <datalist id="dl-contractors"></datalist>
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">現場名 <span class="text-red-500">*</span></label>
              <input list="dl-sites" id="f-site" required placeholder="現場名を入力 / 選択" class="w-full border rounded px-3 py-2 text-base" />
              <datalist id="dl-sites"></datalist>
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">部位 <span class="text-red-500">*</span></label>
              <select id="f-part" required class="w-full border rounded px-3 py-2 text-base bg-white"></select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">数量 (kg) <span class="text-red-500">*</span></label>
                <input type="number" id="f-qty" required step="0.01" min="0" inputmode="decimal" placeholder="例: 1500.5" class="w-full border rounded px-3 py-2 text-base" />
              </div>
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">人員数 (人工) <span class="text-red-500">*</span></label>
                <input type="number" id="f-mp" required step="0.1" min="0" inputmode="decimal" placeholder="例: 2.5" class="w-full border rounded px-3 py-2 text-base" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">人員名（複数可）</label>
              <div id="worker-chips" class="flex flex-wrap gap-1 mb-2"></div>
              <div class="flex gap-2">
                <input list="dl-workers" id="f-worker-input" placeholder="人員名を入力して追加" class="flex-1 border rounded px-3 py-2 text-base" />
                <datalist id="dl-workers"></datalist>
                <button type="button" id="add-worker-btn" class="bg-slate-700 hover:bg-slate-800 text-white px-3 rounded text-sm font-semibold">追加</button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">備考</label>
              <textarea id="f-note" rows={2} class="w-full border rounded px-3 py-2 text-base"></textarea>
            </div>
            <div class="flex gap-2 pt-2">
              <button type="submit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded text-base shadow">
                <i class="fas fa-save mr-1"></i><span id="f-submit-label">登録する</span>
              </button>
              <button type="button" id="f-reset" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 rounded text-sm">
                <i class="fas fa-rotate-left mr-1"></i>クリア
              </button>
            </div>
          </form>
        </section>

        {/* 現場別分析 */}
        <section id="tab-analysis" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-magnifying-glass-chart text-blue-600"></i>元請・現場別分析
          </h2>
          <div class="bg-white rounded-lg shadow p-3 mb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
            <div>
              <label class="block text-xs text-slate-500 mb-1">期間 開始</label>
              <input type="date" id="an-from" class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-500 mb-1">期間 終了</label>
              <input type="date" id="an-to" class="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-500 mb-1">元請</label>
              <select id="an-contractor" class="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="">すべて</option></select>
            </div>
            <div>
              <label class="block text-xs text-slate-500 mb-1">現場名</label>
              <select id="an-site" class="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="">すべて</option></select>
            </div>
            <div class="flex gap-2">
              <button id="an-apply" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm font-semibold">
                <i class="fas fa-filter mr-1"></i>適用
              </button>
              <button id="an-export" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-semibold">
                <i class="fas fa-file-csv mr-1"></i>CSV
              </button>
            </div>
          </div>

          {/* サマリ */}
          <div id="an-summary" class="grid grid-cols-3 gap-2 mb-3"></div>

          {/* 現場別サマリ表 */}
          <div class="bg-white rounded-lg shadow p-3 mb-3 overflow-x-auto">
            <h3 class="font-semibold text-sm text-slate-700 mb-2"><i class="fas fa-table mr-1 text-blue-500"></i>元請・現場ごとのサマリ</h3>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">元請</th>
                  <th class="px-2 py-2 text-left">現場名</th>
                  <th class="px-2 py-2 text-right">取付日数</th>
                  <th class="px-2 py-2 text-right">合計数量 (kg)</th>
                  <th class="px-2 py-2 text-right">合計人工数</th>
                  <th class="px-2 py-2 text-right">1人工あたり (kg/人工)</th>
                </tr>
              </thead>
              <tbody id="an-site-summary"></tbody>
            </table>
          </div>

          {/* 明細 */}
          <div class="bg-white rounded-lg shadow p-3 overflow-x-auto">
            <h3 class="font-semibold text-sm text-slate-700 mb-2"><i class="fas fa-list-ul mr-1 text-blue-500"></i>取付明細</h3>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">日付</th>
                  <th class="px-2 py-2 text-left">元請</th>
                  <th class="px-2 py-2 text-left">現場名</th>
                  <th class="px-2 py-2 text-left">部位</th>
                  <th class="px-2 py-2 text-right">数量 (kg)</th>
                  <th class="px-2 py-2 text-right">人員数</th>
                  <th class="px-2 py-2 text-left">人員名</th>
                </tr>
              </thead>
              <tbody id="an-detail"></tbody>
            </table>
          </div>
        </section>

        {/* 一覧 */}
        <section id="tab-list" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-list text-blue-600"></i>入力データ一覧
          </h2>
          <div class="bg-white rounded-lg shadow p-3 mb-3 flex flex-wrap gap-2 items-end">
            <input type="text" id="list-search" placeholder="検索（元請/現場/部位/人員名）" class="flex-1 min-w-[180px] border rounded px-3 py-1.5 text-sm" />
            <button id="list-export" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-semibold">
              <i class="fas fa-file-csv mr-1"></i>CSV出力
            </button>
          </div>
          <div class="bg-white rounded-lg shadow overflow-x-auto">
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">日付</th>
                  <th class="px-2 py-2 text-left">元請</th>
                  <th class="px-2 py-2 text-left">現場名</th>
                  <th class="px-2 py-2 text-left">部位</th>
                  <th class="px-2 py-2 text-right">数量(kg)</th>
                  <th class="px-2 py-2 text-right">人員数</th>
                  <th class="px-2 py-2 text-left">人員名</th>
                  <th class="px-2 py-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody id="list-body"></tbody>
            </table>
          </div>
        </section>

        {/* 部位設定 */}
        <section id="tab-settings" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-gear text-blue-600"></i>部位マスタ設定
          </h2>
          <div class="bg-white rounded-lg shadow p-4 max-w-xl">
            <p class="text-sm text-slate-600 mb-3">取付実績の「部位」プルダウンに表示する項目を追加・変更・削除できます。</p>
            <div class="flex gap-2 mb-3">
              <input type="text" id="part-input" placeholder="新しい部位名" class="flex-1 border rounded px-3 py-2 text-base" />
              <button id="part-add" class="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded font-semibold">
                <i class="fas fa-plus mr-1"></i>追加
              </button>
            </div>
            <ul id="part-list" class="divide-y border rounded"></ul>
          </div>
        </section>
      </main>

      {/* トースト */}
      <div id="toast" class="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 hidden">
        <div id="toast-body" class="bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg"></div>
      </div>

      <footer class="bg-slate-200 text-slate-500 text-center text-xs py-3">
        © 村田鉄筋㈱ 取付数量分析アプリ
      </footer>

      <script src="/static/app.js"></script>
    </div>
  )
})

export default app
