-- 0003: 三階層化
--   sites (現場) → site_parts (現場の部位・登録数量) → installations (取付実績)
-- 取付実績テーブルに搬入車両 / 通勤車両 を追加。
-- 既存 installations の (site_id, part, quantity) から site_parts を生成し、
-- installations.site_part_id を埋めます。
-- 既存 installations.quantity は「その日の取付分」ではなく「登録数量」のコピーだったため、
-- 移行後は installations から quantity を切り離します（カラムは残し参照しない）。

-- 1) 現場×部位の登録数量マスタ
CREATE TABLE IF NOT EXISTS site_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  part TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,    -- 登録数量 (kg)
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id),
  UNIQUE(site_id, part)
);
CREATE INDEX IF NOT EXISTS idx_site_parts_site ON site_parts(site_id);

-- 2) 既存 installations から (site_id, part) を抽出し site_parts を作成
--    数量は同一 (site_id, part) のうち最大値（既に保存されていたものを尊重）
INSERT OR IGNORE INTO site_parts (site_id, part, quantity)
SELECT site_id, part, MAX(quantity)
FROM installations
WHERE site_id IS NOT NULL AND part IS NOT NULL
GROUP BY site_id, part;

-- 3) installations に新カラム追加
ALTER TABLE installations ADD COLUMN site_part_id INTEGER REFERENCES site_parts(id);
ALTER TABLE installations ADD COLUMN delivery_vehicles INTEGER DEFAULT 0;
ALTER TABLE installations ADD COLUMN commute_vehicles INTEGER DEFAULT 0;

-- 4) site_part_id を埋める
UPDATE installations
SET site_part_id = (
  SELECT sp.id FROM site_parts sp
  WHERE sp.site_id = installations.site_id AND sp.part = installations.part
)
WHERE site_part_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inst_site_part ON installations(site_part_id);
