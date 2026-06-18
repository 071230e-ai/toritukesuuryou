-- 取付数量分析アプリ 初期スキーマ
-- 村田鉄筋㈱

-- 部位マスタ
CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 取付実績（メイン）
-- 1日・1元請・1現場・1部位の取付実績を 1 行で記録
CREATE TABLE IF NOT EXISTS installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,            -- YYYY-MM-DD
  contractor TEXT NOT NULL,           -- 元請
  site_name TEXT NOT NULL,            -- 現場名
  part TEXT NOT NULL,                 -- 部位
  quantity REAL NOT NULL,             -- 数量 (kg, 小数可)
  manpower REAL NOT NULL,             -- 人員数 (人工, 小数可)
  note TEXT,                          -- 備考
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 各取付実績に紐づく作業員（複数登録可能）
CREATE TABLE IF NOT EXISTS installation_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  worker_name TEXT NOT NULL,
  FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE CASCADE
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_inst_work_date ON installations(work_date);
CREATE INDEX IF NOT EXISTS idx_inst_contractor ON installations(contractor);
CREATE INDEX IF NOT EXISTS idx_inst_site ON installations(site_name);
CREATE INDEX IF NOT EXISTS idx_inst_part ON installations(part);
CREATE INDEX IF NOT EXISTS idx_inst_workers_inst ON installation_workers(installation_id);
CREATE INDEX IF NOT EXISTS idx_inst_workers_name ON installation_workers(worker_name);

-- 初期部位データ
INSERT OR IGNORE INTO parts (name, sort_order) VALUES
  ('基礎', 10),
  ('柱', 20),
  ('梁', 30),
  ('壁', 40),
  ('スラブ', 50),
  ('土間', 60),
  ('土木', 70),
  ('その他', 999);
