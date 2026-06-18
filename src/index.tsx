import { Hono } from 'hono'
import { renderer } from './renderer'
import api from './api'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// APIルート
app.route('/api', api)

// レイアウト
app.use(renderer)

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
          <button id="new-site-btn" class="bg-yellow-400 hover:bg-yellow-300 text-blue-900 font-bold rounded-full px-3 py-2 text-sm shadow-md">
            <i class="fas fa-plus mr-1"></i>現場を追加
          </button>
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
            <button data-tab="settings" class="tab-btn px-4 py-2 text-sm font-semibold text-white/80 border-b-4 border-transparent">
              <i class="fas fa-gear mr-1"></i>部位設定
            </button>
          </div>
        </nav>
      </header>

      <main class="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5">
        {/* ============== 現場一覧 ============== */}
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

          <div id="sites-list" class="grid grid-cols-1 md:grid-cols-2 gap-3"></div>
        </section>

        {/* ============== 現場詳細 (取付実績入力) ============== */}
        <section id="tab-site-detail" class="tab-pane hidden">
          <button id="back-to-sites" class="text-sm text-blue-700 hover:underline mb-2">
            <i class="fas fa-arrow-left mr-1"></i>現場一覧に戻る
          </button>

          {/* 現場ヘッダ */}
          <div class="bg-white rounded-lg shadow p-4 mb-3">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div class="text-xs text-slate-500">元請</div>
                <div id="sd-contractor" class="text-base font-bold text-slate-800"></div>
              </div>
              <div class="flex-1 min-w-[180px] sm:ml-4">
                <div class="text-xs text-slate-500">現場名</div>
                <div id="sd-site-name" class="text-lg font-bold text-blue-800"></div>
              </div>
              <button id="sd-edit-site" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1.5 rounded">
                <i class="fas fa-pen mr-1"></i>現場情報を編集
              </button>
            </div>
          </div>

          {/* サマリ */}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div class="bg-white rounded-lg shadow p-3">
              <div class="text-xs text-slate-500">取付日数</div>
              <div class="text-xl font-bold text-slate-700"><span id="sd-days">0</span><span class="text-xs font-normal text-slate-400"> 日</span></div>
            </div>
            <div class="bg-white rounded-lg shadow p-3">
              <div class="text-xs text-slate-500">合計数量</div>
              <div class="text-xl font-bold text-blue-700"><span id="sd-qty">0</span><span class="text-xs font-normal text-slate-400"> kg</span></div>
            </div>
            <div class="bg-white rounded-lg shadow p-3">
              <div class="text-xs text-slate-500">合計人工数</div>
              <div class="text-xl font-bold text-green-700"><span id="sd-mp">0</span><span class="text-xs font-normal text-slate-400"> 人工</span></div>
            </div>
            <div class="bg-white rounded-lg shadow p-3">
              <div class="text-xs text-slate-500">1人工あたり</div>
              <div class="text-xl font-bold text-orange-600"><span id="sd-per">0</span><span class="text-xs font-normal text-slate-400"> kg/人工</span></div>
            </div>
          </div>

          {/* 取付実績入力フォーム */}
          <div class="bg-white rounded-lg shadow p-4 mb-3">
            <h3 class="font-bold text-slate-700 mb-3 flex items-center gap-2">
              <i class="fas fa-pen-to-square text-blue-600"></i>
              <span id="sd-form-title">取付実績を追加</span>
            </h3>
            <form id="sd-form" class="space-y-3 max-w-2xl">
              <input type="hidden" id="sd-f-id" />
              <input type="hidden" id="sd-f-site-id" />
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm font-semibold text-slate-700 mb-1">取付日 <span class="text-red-500">*</span></label>
                  <input type="date" id="sd-f-date" required class="w-full border rounded px-3 py-2 text-base" />
                </div>
                <div>
                  <label class="block text-sm font-semibold text-slate-700 mb-1">部位 <span class="text-red-500">*</span></label>
                  <select id="sd-f-part" required class="w-full border rounded px-3 py-2 text-base bg-white"></select>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm font-semibold text-slate-700 mb-1">数量 (kg) <span class="text-red-500">*</span></label>
                  <input type="number" id="sd-f-qty" required step="0.01" min="0" inputmode="decimal" placeholder="例: 1500.5" class="w-full border rounded px-3 py-2 text-base" />
                </div>
                <div>
                  <label class="block text-sm font-semibold text-slate-700 mb-1">人員 (人工) <span class="text-red-500">*</span></label>
                  <input type="number" id="sd-f-mp" required step="0.1" min="0" inputmode="decimal" placeholder="例: 2.5" class="w-full border rounded px-3 py-2 text-base" />
                </div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">人員名（複数可）</label>
                <div id="sd-worker-chips" class="flex flex-wrap gap-1 mb-2"></div>
                <div class="flex gap-2">
                  <input list="dl-workers" id="sd-f-worker-input" placeholder="人員名を入力して追加" class="flex-1 border rounded px-3 py-2 text-base" />
                  <datalist id="dl-workers"></datalist>
                  <button type="button" id="sd-add-worker" class="bg-slate-700 hover:bg-slate-800 text-white px-3 rounded text-sm font-semibold">追加</button>
                </div>
              </div>
              <div>
                <label class="block text-sm font-semibold text-slate-700 mb-1">備考</label>
                <textarea id="sd-f-note" rows={2} class="w-full border rounded px-3 py-2 text-base"></textarea>
              </div>
              <div class="flex gap-2 pt-1">
                <button type="submit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded text-base shadow">
                  <i class="fas fa-plus mr-1"></i><span id="sd-submit-label">追加する</span>
                </button>
                <button type="button" id="sd-reset" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 rounded text-sm">
                  クリア
                </button>
              </div>
            </form>
          </div>

          {/* 取付実績一覧 */}
          <div class="bg-white rounded-lg shadow p-3 overflow-x-auto">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-bold text-slate-700 flex items-center gap-2 text-sm">
                <i class="fas fa-list-ul text-blue-600"></i>取付実績一覧
              </h3>
              <button id="sd-export" class="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded">
                <i class="fas fa-file-csv mr-1"></i>CSV
              </button>
            </div>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">取付日</th>
                  <th class="px-2 py-2 text-left">部位</th>
                  <th class="px-2 py-2 text-right">数量</th>
                  <th class="px-2 py-2 text-right">人員</th>
                  <th class="px-2 py-2 text-left">人員名</th>
                  <th class="px-2 py-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody id="sd-install-list"></tbody>
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
              <div class="text-xs text-slate-500">全体の1人工あたり</div>
              <div class="text-2xl font-bold text-orange-600 mt-1"><span id="kpi-per-mp">0</span><span class="text-sm font-normal text-slate-500"> kg/人工</span></div>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-ranking-star text-yellow-500 mr-1"></i>元請別 取付数量</h3>
              <div class="h-56"><canvas id="chart-contractor"></canvas></div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
              <h3 class="font-semibold text-slate-700 mb-2 text-sm"><i class="fas fa-ranking-star text-yellow-500 mr-1"></i>現場別 取付数量</h3>
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

        {/* ============== 集計・分析 ============== */}
        <section id="tab-analysis" class="tab-pane hidden">
          <h2 class="text-lg font-bold mb-3 text-slate-700 flex items-center gap-2">
            <i class="fas fa-magnifying-glass-chart text-blue-600"></i>集計・分析
          </h2>
          <div class="bg-white rounded-lg shadow p-3 mb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 items-end">
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
            <div>
              <label class="block text-xs text-slate-500 mb-1">部位</label>
              <select id="an-part" class="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="">すべて</option></select>
            </div>
            <div>
              <label class="block text-xs text-slate-500 mb-1">人員名</label>
              <select id="an-worker" class="w-full border rounded px-2 py-1.5 text-sm bg-white"><option value="">すべて</option></select>
            </div>
            <div class="col-span-2 sm:col-span-3 lg:col-span-6 flex gap-2">
              <button id="an-apply" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-semibold">
                <i class="fas fa-filter mr-1"></i>絞り込み適用
              </button>
              <button id="an-clear" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded text-sm">
                <i class="fas fa-rotate-left mr-1"></i>クリア
              </button>
              <button id="an-export" class="ml-auto bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-semibold">
                <i class="fas fa-file-csv mr-1"></i>CSV出力
              </button>
            </div>
          </div>

          <div id="an-summary" class="grid grid-cols-3 gap-2 mb-3"></div>

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

          <div class="bg-white rounded-lg shadow p-3 overflow-x-auto">
            <h3 class="font-semibold text-sm text-slate-700 mb-2"><i class="fas fa-list-ul mr-1 text-blue-500"></i>取付実績一覧</h3>
            <table class="w-full text-sm min-w-max">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="px-2 py-2 text-left">取付日</th>
                  <th class="px-2 py-2 text-left">元請</th>
                  <th class="px-2 py-2 text-left">現場名</th>
                  <th class="px-2 py-2 text-left">部位</th>
                  <th class="px-2 py-2 text-right">数量</th>
                  <th class="px-2 py-2 text-right">人員</th>
                  <th class="px-2 py-2 text-left">人員名</th>
                </tr>
              </thead>
              <tbody id="an-detail"></tbody>
            </table>
          </div>
        </section>

        {/* ============== 部位設定 ============== */}
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
              <input type="text" id="sm-site-name" required placeholder="例: 亀岡市〇〇新築工事" class="w-full border rounded px-3 py-2 text-base" />
            </div>
            <div>
              <label class="block text-sm font-semibold text-slate-700 mb-1">備考</label>
              <textarea id="sm-note" rows={2} class="w-full border rounded px-3 py-2 text-base"></textarea>
            </div>
            <div class="flex gap-2 pt-2">
              <button type="submit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded text-base">
                <i class="fas fa-save mr-1"></i><span id="sm-submit-label">登録する</span>
              </button>
              <button type="button" id="site-modal-cancel" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 rounded text-sm">
                キャンセル
              </button>
            </div>
          </form>
        </div>
      </div>

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
