-- 0004: installations に運搬車両メモ (vehicle_note) を追加
-- 既存の delivery_vehicles / commute_vehicles (台数, INTEGER) は変更しない

ALTER TABLE installations ADD COLUMN vehicle_note TEXT DEFAULT '';
