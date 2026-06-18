-- 0002: 現場（元請×現場名）を独立テーブル化し、installations から参照する

-- 現場マスタ
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor TEXT NOT NULL,   -- 元請
  site_name TEXT NOT NULL,    -- 現場名
  note TEXT,                  -- 備考
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(contractor, site_name)
);

CREATE INDEX IF NOT EXISTS idx_sites_contractor ON sites(contractor);
CREATE INDEX IF NOT EXISTS idx_sites_name ON sites(site_name);

-- 既存 installations から現場を抽出して投入
INSERT OR IGNORE INTO sites (contractor, site_name)
SELECT DISTINCT contractor, site_name FROM installations;

-- installations に site_id カラムを追加
ALTER TABLE installations ADD COLUMN site_id INTEGER REFERENCES sites(id);

-- 既存行を sites と紐づけ
UPDATE installations
SET site_id = (
  SELECT s.id FROM sites s
  WHERE s.contractor = installations.contractor
    AND s.site_name = installations.site_name
)
WHERE site_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inst_site_id ON installations(site_id);
