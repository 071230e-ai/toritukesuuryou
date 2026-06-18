import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const api = new Hono<{ Bindings: Bindings }>()

// ============================================================
// Parts (部位マスタ) — 選択肢のみ。実データは site_parts.part に保持。
// ============================================================
api.get('/parts', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, sort_order FROM parts ORDER BY sort_order, id'
  ).all()
  return c.json(results)
})

api.post('/parts', async (c) => {
  const { name, sort_order } = await c.req.json<{ name: string; sort_order?: number }>()
  if (!name?.trim()) return c.json({ error: 'name required' }, 400)
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO parts (name, sort_order) VALUES (?, ?)'
    ).bind(name.trim(), sort_order ?? 500).run()
    return c.json({ id: r.meta.last_row_id, name: name.trim() })
  } catch { return c.json({ error: 'already exists' }, 400) }
})

api.put('/parts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { name, sort_order } = await c.req.json<{ name?: string; sort_order?: number }>()
  await c.env.DB.prepare(
    'UPDATE parts SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?'
  ).bind(name ?? null, sort_order ?? null, id).run()
  return c.json({ ok: true })
})

api.delete('/parts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM parts WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ============================================================
// Sites (現場マスタ)
// ============================================================
api.get('/sites', async (c) => {
  const q = c.req.query()
  const where: string[] = []
  const params: any[] = []
  if (q.search) {
    where.push('(s.contractor LIKE ? OR s.site_name LIKE ?)')
    const kw = `%${q.search}%`
    params.push(kw, kw)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // 各現場のサマリ: 登録数量合計 / 取付実績の人工数合計 / 取付日数 / 車両合計
  const sql = `
    SELECT s.id, s.contractor, s.site_name, s.note,
      COALESCE(pq.total_qty, 0)    AS total_qty,    -- 登録数量の合計
      COALESCE(pq.parts_count, 0)  AS parts_count,  -- 部位数
      COALESCE(ix.total_mp, 0)     AS total_mp,     -- 取付実績の合計人工数
      COALESCE(ix.work_days, 0)    AS work_days,
      COALESCE(ix.deliv, 0)        AS delivery_vehicles,
      COALESCE(ix.commu, 0)        AS commute_vehicles,
      COALESCE(ix.inst_count, 0)   AS inst_count
    FROM sites s
    LEFT JOIN (
      SELECT site_id, SUM(quantity) AS total_qty, COUNT(*) AS parts_count
      FROM site_parts GROUP BY site_id
    ) pq ON pq.site_id = s.id
    LEFT JOIN (
      SELECT sp.site_id,
        SUM(i.manpower)          AS total_mp,
        COUNT(DISTINCT i.work_date) AS work_days,
        SUM(i.delivery_vehicles) AS deliv,
        SUM(i.commute_vehicles)  AS commu,
        COUNT(*)                 AS inst_count
      FROM installations i
      JOIN site_parts sp ON sp.id = i.site_part_id
      GROUP BY sp.site_id
    ) ix ON ix.site_id = s.id
    ${whereSql}
    ORDER BY s.contractor, s.site_name
  `
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json(results)
})

api.get('/sites/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const site = await c.env.DB.prepare(
    'SELECT id, contractor, site_name, note FROM sites WHERE id = ?'
  ).bind(id).first()
  if (!site) return c.json({ error: 'not found' }, 404)
  return c.json(site)
})

api.post('/sites', async (c) => {
  const { contractor, site_name, note } = await c.req.json<{ contractor: string; site_name: string; note?: string }>()
  if (!contractor?.trim() || !site_name?.trim()) return c.json({ error: '元請と現場名は必須です' }, 400)
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO sites (contractor, site_name, note) VALUES (?, ?, ?)'
    ).bind(contractor.trim(), site_name.trim(), note?.trim() ?? '').run()
    return c.json({ id: r.meta.last_row_id })
  } catch { return c.json({ error: '同じ元請・現場名はすでに登録されています' }, 400) }
})

api.put('/sites/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { contractor, site_name, note } = await c.req.json<{ contractor: string; site_name: string; note?: string }>()
  if (!contractor?.trim() || !site_name?.trim()) return c.json({ error: '元請と現場名は必須です' }, 400)
  try {
    await c.env.DB.prepare(
      'UPDATE sites SET contractor = ?, site_name = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(contractor.trim(), site_name.trim(), note?.trim() ?? '', id).run()
    // 取付実績テーブルの contractor/site_name 同期（分析用カラム）
    await c.env.DB.prepare(
      'UPDATE installations SET contractor = ?, site_name = ? WHERE site_id = ?'
    ).bind(contractor.trim(), site_name.trim(), id).run()
    return c.json({ ok: true })
  } catch { return c.json({ error: '更新に失敗しました' }, 400) }
})

api.delete('/sites/:id', async (c) => {
  const id = Number(c.req.param('id'))
  // 配下の部位 / 取付実績の件数
  const cnt = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM site_parts WHERE site_id = ?) AS parts,
      (SELECT COUNT(*) FROM installations i JOIN site_parts sp ON sp.id = i.site_part_id WHERE sp.site_id = ?) AS insts
  `).bind(id, id).first<{ parts: number; insts: number }>()
  const force = c.req.query('force') === '1'
  if (cnt && (cnt.parts > 0 || cnt.insts > 0) && !force) {
    return c.json({ error: `この現場には ${cnt.parts} 件の部位 / ${cnt.insts} 件の取付実績があります`, parts: cnt.parts, insts: cnt.insts }, 400)
  }
  if (force) {
    await c.env.DB.prepare(`
      DELETE FROM installation_workers WHERE installation_id IN (
        SELECT i.id FROM installations i JOIN site_parts sp ON sp.id = i.site_part_id WHERE sp.site_id = ?
      )`).bind(id).run()
    await c.env.DB.prepare(`
      DELETE FROM installations WHERE site_part_id IN (SELECT id FROM site_parts WHERE site_id = ?)
    `).bind(id).run()
    await c.env.DB.prepare('DELETE FROM site_parts WHERE site_id = ?').bind(id).run()
  }
  await c.env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ============================================================
// Site Parts (現場の中の部位・登録数量)
// ============================================================
// 現場ごとの部位一覧（サマリ込み）
api.get('/sites/:id/parts', async (c) => {
  const id = Number(c.req.param('id'))
  const { results } = await c.env.DB.prepare(`
    SELECT sp.id, sp.site_id, sp.part, sp.quantity, sp.note,
      COALESCE(ix.total_mp, 0)   AS total_mp,
      COALESCE(ix.work_days, 0)  AS work_days,
      COALESCE(ix.deliv, 0)      AS delivery_vehicles,
      COALESCE(ix.commu, 0)      AS commute_vehicles,
      COALESCE(ix.inst_count, 0) AS inst_count
    FROM site_parts sp
    LEFT JOIN (
      SELECT site_part_id,
        SUM(manpower)           AS total_mp,
        COUNT(DISTINCT work_date) AS work_days,
        SUM(delivery_vehicles)  AS deliv,
        SUM(commute_vehicles)   AS commu,
        COUNT(*)                AS inst_count
      FROM installations GROUP BY site_part_id
    ) ix ON ix.site_part_id = sp.id
    WHERE sp.site_id = ?
    ORDER BY sp.id
  `).bind(id).all()
  return c.json(results)
})

api.get('/site-parts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const sp = await c.env.DB.prepare(`
    SELECT sp.id, sp.site_id, sp.part, sp.quantity, sp.note,
      s.contractor, s.site_name
    FROM site_parts sp JOIN sites s ON s.id = sp.site_id
    WHERE sp.id = ?
  `).bind(id).first()
  if (!sp) return c.json({ error: 'not found' }, 404)
  return c.json(sp)
})

api.post('/sites/:id/parts', async (c) => {
  const siteId = Number(c.req.param('id'))
  const { part, quantity, note } = await c.req.json<{ part: string; quantity: number; note?: string }>()
  if (!part?.trim()) return c.json({ error: '部位は必須です' }, 400)
  const qty = Number(quantity)
  if (!(qty >= 0)) return c.json({ error: '数量は0以上の数値で入力してください' }, 400)
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO site_parts (site_id, part, quantity, note) VALUES (?, ?, ?, ?)'
    ).bind(siteId, part.trim(), qty, note?.trim() ?? '').run()
    return c.json({ id: r.meta.last_row_id })
  } catch { return c.json({ error: '同じ部位はすでに登録されています' }, 400) }
})

api.put('/site-parts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { part, quantity, note } = await c.req.json<{ part?: string; quantity?: number; note?: string }>()
  // 部位文字列が変更された場合、配下の installations.part も同期
  const old = await c.env.DB.prepare('SELECT site_id, part FROM site_parts WHERE id = ?').bind(id).first<{ site_id: number; part: string }>()
  if (!old) return c.json({ error: 'not found' }, 404)
  try {
    await c.env.DB.prepare(
      'UPDATE site_parts SET part = COALESCE(?, part), quantity = COALESCE(?, quantity), note = COALESCE(?, note), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(part?.trim() ?? null, quantity ?? null, note?.trim() ?? null, id).run()
    if (part && part.trim() !== old.part) {
      await c.env.DB.prepare(
        'UPDATE installations SET part = ? WHERE site_part_id = ?'
      ).bind(part.trim(), id).run()
    }
    return c.json({ ok: true })
  } catch { return c.json({ error: '更新に失敗しました（重複の可能性）' }, 400) }
})

api.delete('/site-parts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const cnt = await c.env.DB.prepare(
    'SELECT COUNT(*) AS c FROM installations WHERE site_part_id = ?'
  ).bind(id).first<{ c: number }>()
  const force = c.req.query('force') === '1'
  if (cnt && cnt.c > 0 && !force) {
    return c.json({ error: `この部位には ${cnt.c} 件の取付実績があります`, count: cnt.c }, 400)
  }
  if (force && cnt && cnt.c > 0) {
    await c.env.DB.prepare(`
      DELETE FROM installation_workers WHERE installation_id IN (SELECT id FROM installations WHERE site_part_id = ?)
    `).bind(id).run()
    await c.env.DB.prepare('DELETE FROM installations WHERE site_part_id = ?').bind(id).run()
  }
  await c.env.DB.prepare('DELETE FROM site_parts WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ============================================================
// Installations (取付実績)
// ============================================================
interface InstallPayload {
  site_part_id: number
  work_date: string
  manpower: number
  delivery_vehicles?: number
  commute_vehicles?: number
  vehicle_note?: string
  workers?: string[]
  note?: string
}

// 取付実績一覧（部位ID別 or 全体検索）
api.get('/site-parts/:id/installations', async (c) => {
  const id = Number(c.req.param('id'))
  const { results } = await c.env.DB.prepare(`
    SELECT i.id, i.work_date, i.manpower, i.delivery_vehicles, i.commute_vehicles,
      COALESCE(i.vehicle_note, '') AS vehicle_note, i.note,
      (SELECT GROUP_CONCAT(worker_name, ',') FROM installation_workers w WHERE w.installation_id = i.id) AS workers
    FROM installations i WHERE i.site_part_id = ?
    ORDER BY i.work_date DESC, i.id DESC
  `).bind(id).all()
  const data = (results as any[]).map(r => ({ ...r, workers: r.workers ? String(r.workers).split(',') : [] }))
  return c.json(data)
})

api.get('/installations', async (c) => {
  const q = c.req.query()
  const where: string[] = []
  const params: any[] = []
  if (q.from) { where.push('i.work_date >= ?'); params.push(q.from) }
  if (q.to)   { where.push('i.work_date <= ?'); params.push(q.to) }
  if (q.contractor) { where.push('s.contractor = ?'); params.push(q.contractor) }
  if (q.site) { where.push('s.site_name = ?'); params.push(q.site) }
  if (q.site_id) { where.push('s.id = ?'); params.push(Number(q.site_id)) }
  if (q.site_part_id) { where.push('sp.id = ?'); params.push(Number(q.site_part_id)) }
  if (q.part) { where.push('sp.part = ?'); params.push(q.part) }
  if (q.worker) {
    where.push('EXISTS (SELECT 1 FROM installation_workers w WHERE w.installation_id = i.id AND w.worker_name = ?)')
    params.push(q.worker)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const sql = `
    SELECT i.id, i.site_part_id, i.work_date, sp.part, sp.quantity AS registered_qty,
      i.manpower, i.delivery_vehicles, i.commute_vehicles,
      COALESCE(i.vehicle_note, '') AS vehicle_note, i.note,
      s.contractor, s.site_name, s.id AS site_id,
      (SELECT GROUP_CONCAT(worker_name, ',') FROM installation_workers w WHERE w.installation_id = i.id) AS workers
    FROM installations i
    JOIN site_parts sp ON sp.id = i.site_part_id
    JOIN sites s ON s.id = sp.site_id
    ${whereSql}
    ORDER BY i.work_date DESC, i.id DESC
  `
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const data = (results as any[]).map(r => ({ ...r, workers: r.workers ? String(r.workers).split(',') : [] }))
  return c.json(data)
})

api.get('/installations/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare(`
    SELECT i.*, sp.part, sp.quantity AS registered_qty, sp.site_id, s.contractor, s.site_name
    FROM installations i
    JOIN site_parts sp ON sp.id = i.site_part_id
    JOIN sites s ON s.id = sp.site_id
    WHERE i.id = ?
  `).bind(id).first()
  if (!row) return c.json({ error: 'not found' }, 404)
  const workers = await c.env.DB.prepare(
    'SELECT worker_name FROM installation_workers WHERE installation_id = ?'
  ).bind(id).all()
  return c.json({ ...row, workers: (workers.results as any[]).map(w => w.worker_name) })
})

api.post('/installations', async (c) => {
  const body = await c.req.json<InstallPayload>()
  if (!body.site_part_id || !body.work_date) return c.json({ error: '部位と取付日は必須です' }, 400)
  const sp = await c.env.DB.prepare(`
    SELECT sp.id, sp.site_id, sp.part, s.contractor, s.site_name
    FROM site_parts sp JOIN sites s ON s.id = sp.site_id WHERE sp.id = ?
  `).bind(body.site_part_id).first<{ id: number; site_id: number; part: string; contractor: string; site_name: string }>()
  if (!sp) return c.json({ error: '部位が見つかりません' }, 400)
  const mp = Number(body.manpower) || 0
  const dv = Math.max(0, Math.floor(Number(body.delivery_vehicles) || 0))
  const cv = Math.max(0, Math.floor(Number(body.commute_vehicles) || 0))
  const vn = (body.vehicle_note ?? '').toString().trim()

  const r = await c.env.DB.prepare(`
    INSERT INTO installations
      (site_part_id, site_id, work_date, contractor, site_name, part,
       quantity, manpower, delivery_vehicles, commute_vehicles, vehicle_note, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sp.id, sp.site_id, body.work_date, sp.contractor, sp.site_name, sp.part,
    0, mp, dv, cv, vn, body.note ?? ''
  ).run()
  const id = r.meta.last_row_id as number
  if (body.workers?.length) {
    for (const w of body.workers) {
      const name = (w || '').trim()
      if (!name) continue
      await c.env.DB.prepare(
        'INSERT INTO installation_workers (installation_id, worker_name) VALUES (?, ?)'
      ).bind(id, name).run()
    }
  }
  return c.json({ id })
})

api.put('/installations/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<InstallPayload>()
  if (!body.site_part_id || !body.work_date) return c.json({ error: '部位と取付日は必須です' }, 400)
  const sp = await c.env.DB.prepare(`
    SELECT sp.id, sp.site_id, sp.part, s.contractor, s.site_name
    FROM site_parts sp JOIN sites s ON s.id = sp.site_id WHERE sp.id = ?
  `).bind(body.site_part_id).first<{ id: number; site_id: number; part: string; contractor: string; site_name: string }>()
  if (!sp) return c.json({ error: '部位が見つかりません' }, 400)
  const mp = Number(body.manpower) || 0
  const dv = Math.max(0, Math.floor(Number(body.delivery_vehicles) || 0))
  const cv = Math.max(0, Math.floor(Number(body.commute_vehicles) || 0))
  const vn = (body.vehicle_note ?? '').toString().trim()

  await c.env.DB.prepare(`
    UPDATE installations SET
      site_part_id = ?, site_id = ?, work_date = ?, contractor = ?, site_name = ?, part = ?,
      manpower = ?, delivery_vehicles = ?, commute_vehicles = ?, vehicle_note = ?, note = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    sp.id, sp.site_id, body.work_date, sp.contractor, sp.site_name, sp.part,
    mp, dv, cv, vn, body.note ?? '', id
  ).run()
  await c.env.DB.prepare('DELETE FROM installation_workers WHERE installation_id = ?').bind(id).run()
  if (body.workers?.length) {
    for (const w of body.workers) {
      const name = (w || '').trim()
      if (!name) continue
      await c.env.DB.prepare(
        'INSERT INTO installation_workers (installation_id, worker_name) VALUES (?, ?)'
      ).bind(id, name).run()
    }
  }
  return c.json({ ok: true })
})

api.delete('/installations/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM installation_workers WHERE installation_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM installations WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ============================================================
// Suggestions (人員名)
// ============================================================
api.get('/suggestions', async (c) => {
  const workers = await c.env.DB.prepare(
    'SELECT DISTINCT worker_name AS v FROM installation_workers ORDER BY worker_name'
  ).all()
  return c.json({ workers: (workers.results as any[]).map(r => r.v) })
})

// ============================================================
// Analytics
// ============================================================
function buildFilter(q: Record<string, string>) {
  const where: string[] = []
  const params: any[] = []
  if (q.from) { where.push('i.work_date >= ?'); params.push(q.from) }
  if (q.to)   { where.push('i.work_date <= ?'); params.push(q.to) }
  if (q.contractor) { where.push('s.contractor = ?'); params.push(q.contractor) }
  if (q.site) { where.push('s.site_name = ?'); params.push(q.site) }
  if (q.site_id) { where.push('s.id = ?'); params.push(Number(q.site_id)) }
  if (q.part) { where.push('sp.part = ?'); params.push(q.part) }
  if (q.worker) {
    where.push('EXISTS (SELECT 1 FROM installation_workers w WHERE w.installation_id = i.id AND w.worker_name = ?)')
    params.push(q.worker)
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

// 全体ダッシュボード
api.get('/analytics/dashboard', async (c) => {
  const q = c.req.query()
  const { whereSql, params } = buildFilter(q)

  // 取付実績ベースの合計
  const total = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(i.manpower), 0)           AS total_mp,
      COALESCE(SUM(i.delivery_vehicles), 0)  AS total_deliv,
      COALESCE(SUM(i.commute_vehicles), 0)   AS total_commu,
      COUNT(*)                               AS inst_count
    FROM installations i
    JOIN site_parts sp ON sp.id = i.site_part_id
    JOIN sites s ON s.id = sp.site_id
    ${whereSql}
  `).bind(...params).first<{ total_mp: number; total_deliv: number; total_commu: number; inst_count: number }>()

  // 登録数量合計（フィルタが期間以外: contractor/site/site_id/part のみ反映可）
  const regWhere: string[] = []
  const regParams: any[] = []
  if (q.contractor) { regWhere.push('s.contractor = ?'); regParams.push(q.contractor) }
  if (q.site) { regWhere.push('s.site_name = ?'); regParams.push(q.site) }
  if (q.site_id) { regWhere.push('s.id = ?'); regParams.push(Number(q.site_id)) }
  if (q.part) { regWhere.push('sp.part = ?'); regParams.push(q.part) }
  const regWhereSql = regWhere.length ? `WHERE ${regWhere.join(' AND ')}` : ''
  const reg = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(sp.quantity), 0) AS total_qty
    FROM site_parts sp JOIN sites s ON s.id = sp.site_id
    ${regWhereSql}
  `).bind(...regParams).first<{ total_qty: number }>()

  // 元請別 (取付実績ベース)
  const byContractor = await c.env.DB.prepare(`
    SELECT s.contractor AS name, SUM(sp.quantity * 1.0 * iu.row_share) AS qty_share, SUM(i.manpower) AS mp
    FROM installations i
    JOIN site_parts sp ON sp.id = i.site_part_id
    JOIN sites s ON s.id = sp.site_id
    JOIN (SELECT site_part_id, 1.0 / COUNT(*) AS row_share FROM installations GROUP BY site_part_id) iu
      ON iu.site_part_id = i.site_part_id
    ${whereSql}
    GROUP BY s.contractor ORDER BY qty_share DESC LIMIT 10
  `).bind(...params).all()

  // 現場別 (登録数量ベース)
  const bySite = await c.env.DB.prepare(`
    SELECT s.site_name AS name, s.contractor AS contractor,
      SUM(sp.quantity) AS qty
    FROM site_parts sp JOIN sites s ON s.id = sp.site_id
    ${regWhereSql}
    GROUP BY s.id, s.contractor, s.site_name ORDER BY qty DESC LIMIT 10
  `).bind(...regParams).all()

  // 部位別 (登録数量ベース)
  const byPart = await c.env.DB.prepare(`
    SELECT sp.part AS name, SUM(sp.quantity) AS qty
    FROM site_parts sp JOIN sites s ON s.id = sp.site_id
    ${regWhereSql}
    GROUP BY sp.part ORDER BY qty DESC
  `).bind(...regParams).all()

  // 人員別 (取付実績の人工数ベース)
  const byWorker = await c.env.DB.prepare(`
    SELECT w.worker_name AS name,
      SUM(i.manpower * 1.0 / wc.cnt) AS mp
    FROM installations i
    JOIN installation_workers w ON w.installation_id = i.id
    JOIN (SELECT installation_id, COUNT(*) AS cnt FROM installation_workers GROUP BY installation_id) wc
      ON wc.installation_id = i.id
    JOIN site_parts sp ON sp.id = i.site_part_id
    JOIN sites s ON s.id = sp.site_id
    ${whereSql}
    GROUP BY w.worker_name ORDER BY mp DESC LIMIT 20
  `).bind(...params).all()

  return c.json({
    total: {
      total_qty: reg?.total_qty ?? 0,
      total_mp: total?.total_mp ?? 0,
      total_deliv: total?.total_deliv ?? 0,
      total_commu: total?.total_commu ?? 0,
      inst_count: total?.inst_count ?? 0,
    },
    byContractor: byContractor.results,
    bySite: bySite.results,
    byPart: byPart.results,
    byWorker: byWorker.results,
  })
})

// 現場一覧 (集計)
api.get('/analytics/sites', async (c) => {
  const q = c.req.query()
  const { whereSql, params } = buildFilter(q)
  // 取付実績側の集計（期間絞り込みが効く）
  const { results } = await c.env.DB.prepare(`
    SELECT s.id AS site_id, s.contractor, s.site_name,
      (SELECT COALESCE(SUM(sp2.quantity),0) FROM site_parts sp2 WHERE sp2.site_id = s.id) AS total_qty,
      COUNT(DISTINCT i.work_date) AS work_days,
      COALESCE(SUM(i.manpower), 0) AS total_mp,
      COALESCE(SUM(i.delivery_vehicles), 0) AS total_deliv,
      COALESCE(SUM(i.commute_vehicles), 0) AS total_commu
    FROM sites s
    LEFT JOIN site_parts sp ON sp.site_id = s.id
    LEFT JOIN installations i ON i.site_part_id = sp.id
      ${q.from ? 'AND i.work_date >= ?' : ''}
      ${q.to   ? 'AND i.work_date <= ?' : ''}
      ${q.worker ? "AND EXISTS (SELECT 1 FROM installation_workers w WHERE w.installation_id = i.id AND w.worker_name = ?)" : ''}
    ${(q.contractor || q.site || q.site_id || q.part) ? 'WHERE ' + [
      q.contractor ? 's.contractor = ?' : '',
      q.site ? 's.site_name = ?' : '',
      q.site_id ? 's.id = ?' : '',
      q.part ? 'sp.part = ?' : '',
    ].filter(Boolean).join(' AND ') : ''}
    GROUP BY s.id, s.contractor, s.site_name
    HAVING total_qty > 0 OR total_mp > 0
    ORDER BY total_qty DESC
  `).bind(
    ...(q.from ? [q.from] : []),
    ...(q.to ? [q.to] : []),
    ...(q.worker ? [q.worker] : []),
    ...(q.contractor ? [q.contractor] : []),
    ...(q.site ? [q.site] : []),
    ...(q.site_id ? [Number(q.site_id)] : []),
    ...(q.part ? [q.part] : []),
  ).all()
  return c.json(results)
})

// 部位サマリ
api.get('/analytics/parts', async (c) => {
  const q = c.req.query()
  // installations に紐づくフィルタは on 句に、site_parts/sites のフィルタは where に
  const onFilters: string[] = []
  const onParams: any[] = []
  if (q.from) { onFilters.push('i.work_date >= ?'); onParams.push(q.from) }
  if (q.to)   { onFilters.push('i.work_date <= ?'); onParams.push(q.to) }
  if (q.worker) {
    onFilters.push("EXISTS (SELECT 1 FROM installation_workers w WHERE w.installation_id = i.id AND w.worker_name = ?)")
    onParams.push(q.worker)
  }
  const onSql = onFilters.length ? 'AND ' + onFilters.join(' AND ') : ''

  const where: string[] = []
  const params: any[] = []
  if (q.contractor) { where.push('s.contractor = ?'); params.push(q.contractor) }
  if (q.site) { where.push('s.site_name = ?'); params.push(q.site) }
  if (q.site_id) { where.push('s.id = ?'); params.push(Number(q.site_id)) }
  if (q.part) { where.push('sp.part = ?'); params.push(q.part) }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const sql = `
    SELECT sp.id AS site_part_id, s.id AS site_id, s.contractor, s.site_name, sp.part,
      sp.quantity AS registered_qty,
      COUNT(DISTINCT i.work_date) AS work_days,
      COALESCE(SUM(i.manpower), 0) AS total_mp,
      COALESCE(SUM(i.delivery_vehicles), 0) AS total_deliv,
      COALESCE(SUM(i.commute_vehicles), 0) AS total_commu
    FROM site_parts sp
    JOIN sites s ON s.id = sp.site_id
    LEFT JOIN installations i ON i.site_part_id = sp.id ${onSql}
    ${whereSql}
    GROUP BY sp.id, s.id, s.contractor, s.site_name, sp.part, sp.quantity
    ORDER BY s.contractor, s.site_name, sp.id
  `
  const { results } = await c.env.DB.prepare(sql).bind(...onParams, ...params).all()
  return c.json(results)
})

// ============================================================
// テキスト取込（予定表貼り付けからの自動読み取り）
// ============================================================
interface ParsedBlock {
  contractor: string
  site_name: string
  part: string
  quantity: number
  manpower: number
  workers: string[]
  vehicle_note: string
  work_date: string         // YYYY-MM-DD（テキストから読み取れた場合は反映、フォーム指定があれば優先）
  raw: string               // 元テキスト（修正画面で参照用）
  warnings: string[]        // 読み取りに失敗した項目の警告
}

// ノイズ除去: 一行内/セグメント単位の不要文字
function cleanSegment(s: string): string {
  return s
    .replace(/[‼❗]+/g, '')          // ‼️ 強調記号
    .replace(/[️]/g, '')              // 異体字セレクタ
    .replace(/[!！。]+$/g, '')        // 末尾の記号
    .trim()
}

// 「6/18日の予定」「2026/6/18」「6月18日」を YYYY-MM-DD に変換
// 住所の "1-12-1/3号地" のような誤抽出を避けるため、M/D は必ず "日" または "の予定" を伴うことを要求する
function extractWorkDate(text: string, fallback: string): string {
  // 1. YYYY/M/D or YYYY-M-D
  const m1 = text.match(/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (m1) {
    const y = m1[1], mo = m1[2].padStart(2, '0'), d = m1[3].padStart(2, '0')
    return `${y}-${mo}-${d}`
  }
  // 2. M/D日 (必ず「日」を伴う) + 任意で「の予定」
  const m2 = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*日(?:の予定)?/)
  if (m2) {
    const m = Number(m2[1])
    const d = Number(m2[2])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const now = new Date()
      const y = String(now.getFullYear())
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  // 3. M月D日
  const m3 = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (m3) {
    const m = Number(m3[1])
    const d = Number(m3[2])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const now = new Date()
      const y = String(now.getFullYear())
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  return fallback
}

// 1ブロック (空行区切り) のパース
function parseBlock(rawBlock: string, fallbackDate: string): ParsedBlock | null {
  const warnings: string[] = []
  const lines = rawBlock.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return null

  // 行を結合して ‼️ / , / 、 で分割（,/、はセグメント内の小区切り）
  const flat = lines.join('‼️')
  // ‼️ または改行ベース、また 、 ','で分割するが、これは項目間の区切りに使うことが多い
  // まず ‼️ で大きく分け、その後 、 や ',' は元請ヘッダ部の小区切りに使う
  const bigSegs = flat.split(/[‼❗]+️?/u).map(cleanSegment).filter(Boolean)
  if (!bigSegs.length) return null

  // === 数量 / 人工数 をブロック全体から拾う ===
  let quantity = 0
  let manpower = 0
  const qm = rawBlock.match(/約?\s*([\d,]+)\s*[KkＫ]/)
  if (qm) quantity = Number(qm[1].replace(/,/g, '')) || 0
  const mm = rawBlock.match(/(\d+(?:\.\d+)?)\s*人\s*目/)
  if (mm) manpower = Number(mm[1]) || 0
  if (!quantity) warnings.push('数量を読み取れませんでした')
  if (!manpower) warnings.push('人工数を読み取れませんでした')

  // === 運搬車両 ===
  const vm = rawBlock.match(/(\d+\s*[トt]\s*[ンン]\s*(?:運搬|ダンプ|車))/)
  const vehicle_note = vm ? cleanSegment(vm[1]).replace(/\s+/g, '') : ''
  // 単独で「2トンダンプ」「3トン運搬」など segs 内の独立要素として現れている場合もカバー (上のregexで概ねOK)

  // === 人員名: "=" または "応援=" 以降を抽出 ===
  let workers: string[] = []
  // ブロック全体から =... を取り出す（複数行対応）
  const eqMatches = rawBlock.match(/(?:応援\s*)?=([^\n=]+)/g) || []
  for (const em of eqMatches) {
    const body = em.replace(/^.*?=/, '').trim()
    // ‼️、、, で分割し、空 / 記号のみを除外
    const ws = body
      .split(/[‼❗、,，]+️?/u)
      .map(cleanSegment)
      .map(w => w.replace(/[‼️!！]+/g, '').trim())
      .filter(w => w && !/^\(.*\)$/.test(w))
    workers.push(...ws)
  }
  // 重複除去
  workers = Array.from(new Set(workers))
  if (!workers.length) warnings.push('人員名を読み取れませんでした')

  // === 元請 / 現場名 / 部位 を big segs から拾う ===
  // 最初の segment は「アムザ工務店、3日目、9960K、16人目」のような複合行になっている可能性がある
  // → 、/, で分割した先頭が「元請」
  let contractor = ''
  let site_name = ''
  let part = ''

  // 最初の big seg のさらに小分割（、, で）
  const headParts = bigSegs[0].split(/[、,，]/).map(s => cleanSegment(s)).filter(Boolean)
  if (headParts.length) contractor = headParts[0]

  // 除外キーワード（住所/メモ系）
  const excludeKw = /^(?:[\d]+日目|約?[\d,]+[KkＫ]|[\d]+人目|終了予定|終わり次第|第\s*[一二三]\s*工場|.*時着|.*時～|.*時〜|.*~|.*～|.*〜|.*朝礼|.*配筋検査|.*検査|.*エブリ$|.*エブリ\b|プロボックス|ハイエース|高速代車|駐車場代.*|.*請求.*|岩田鉄筋取り付け|旧.*|.*車$|終了)/u
  // 住所判定: より強い住所パターン（市・区・丁目・番地・号地・付近、または番地数字を含む）
  const addressKw = /(?:[都道府県市区郡]\S{0,15}(?:町|村|丁目|番地|付近)|\d+丁目|\d+番地|\d+号地|号地|付近$|擁壁$|[A-Za-z\d]+-\d+(?:-\d+)?|京都\S*区|大阪\S*区|阿倍野|伏見|下京|上京|中京|右京|左京|西京|北区|南区|東山|山科|亀岡|茨木)/
  // 部位キーワード (優先採用)
  const partKw = /(?:基礎|柱|梁|壁|スラブ|土間|枕梁|止水壁|擁壁|機械基礎|^[\d０-９]+F|地中梁|杭|フーチング)/u

  // 残りの segs（先頭は元請複合行なので除く）
  const restSegs = [...headParts.slice(1), ...bigSegs.slice(1)]

  // 部位らしいセグメントを先に拾う候補 / 現場名候補
  const candidates: string[] = []
  // 住所判定で弾かれたものをフォールバック用に保持（全て弾かれた場合に現場名として救済）
  const addressLike: string[] = []

  for (const s of restSegs) {
    const seg = s.replace(/\s+/g, '')
    if (!seg) continue
    // "=" で始まる人員リスト行は除外（人員は別途処理済み）
    if (/^[応援]*\s*[=＝]/.test(seg)) continue
    if (/[=＝]/.test(seg)) continue
    if (excludeKw.test(seg)) continue
    // 数量・人工数・日数のセグメント単体
    if (/^約?[\d,]+[KkＫ]$/.test(seg)) continue
    if (/^[\d]+人目$/.test(seg)) continue
    if (/^[\d]+日目$/.test(seg)) continue
    // 運搬車両セグメントは vehicle_note に拾い済み
    if (/^\d+\s*[トt][ンン](?:運搬|ダンプ|車)/.test(seg)) continue
    // "○○君エブリ" のような車両メモ
    if (/エブリ|プロボックス|ハイエース/.test(seg) && seg.length < 20) continue
    if (/^(?:8|9|10|11|12|13|14|15|16|17)時/.test(seg)) continue

    // 括弧除去（見積り書有り/無し 等）
    const cleaned = seg.replace(/[（(][^）)]*[)）]/g, '').trim()
    if (!cleaned) continue

    // 住所判定
    if (addressKw.test(cleaned)) {
      addressLike.push(cleaned)
      continue
    }

    candidates.push(cleaned)
  }

  // すべて住所判定で弾かれて site_name候補が無い場合、最初の addressLike を現場名として救済
  // (例: 「北春日丘1-12-1/3号地擁壁」のような住所形式の現場名)
  if (candidates.length === 0 && addressLike.length > 0) {
    candidates.push(addressLike[0])
  }

  // candidates から、部位っぽいものは part 候補、それ以外は site_name 候補
  // 通常の予定表は「現場名 → 部位 → 住所 …」の順なので、最初の非住所セグメントが現場名
  // 2番目以降に部位キーワードが現れるものを part として採用
  for (const c of candidates) {
    if (!site_name) {
      site_name = c
      continue
    }
    if (!part) {
      part = c
      continue
    }
    // それ以降: 部位キーワードを含み、まだ part が部位パターンに合致してなければ上書き
    if (partKw.test(c) && !partKw.test(part)) {
      part = c
    }
  }

  // 安全策: site_name が部位っぽくて、かつ part が空 → 入れ替え
  if (site_name && !part && partKw.test(site_name) && site_name.length <= 12) {
    part = site_name
    site_name = ''
  }

  if (!contractor) warnings.push('元請を読み取れませんでした')
  if (!site_name)  warnings.push('現場名を読み取れませんでした')
  if (!part)       warnings.push('部位を読み取れませんでした')

  const work_date = extractWorkDate(rawBlock, fallbackDate)

  return {
    contractor,
    site_name,
    part,
    quantity,
    manpower,
    workers,
    vehicle_note,
    work_date,
    raw: rawBlock.trim(),
    warnings,
  }
}

// 全体テキストのパース
api.post('/import/parse', async (c) => {
  const body = await c.req.json<{ text: string; work_date?: string; form_date?: string }>()
  const text = body.text
  // フロントは form_date で送ってくる。互換のため work_date も受け付ける
  const work_date = (body.form_date || body.work_date || '').trim()
  if (!text || !text.trim()) return c.json({ error: 'テキストが空です' }, 400)

  // ヘッダ行（"6/18日の予定です" のような）からデフォルト日付を取得
  const lines = text.split(/\r?\n/)
  // 1ブロックずつ。空行で区切り。
  const blocks: string[] = []
  let buf: string[] = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (buf.length) { blocks.push(buf.join('\n')); buf = [] }
    } else {
      buf.push(line)
    }
  }
  if (buf.length) blocks.push(buf.join('\n'))

  // 全体先頭付近からの日付推定（"6/18日の予定です。"行など）
  const headerSlice = lines.slice(0, 5).join(' ')
  const headerDate = extractWorkDate(headerSlice, '')

  // フォームの work_date が最優先、無ければ headerDate、それも無ければ各ブロック内部の日付、それも無ければ今日
  const today = new Date().toISOString().slice(0, 10)
  const baseDate = (work_date && work_date.trim()) || headerDate || today

  const parsed: ParsedBlock[] = []
  for (const b of blocks) {
    // 単独行で「6/18日の予定です」のようなヘッダだけのブロックはスキップ
    const cleaned = b.replace(/[‼❗️]/g, '').trim()
    if (/^.{0,30}予定です\.?。?$/u.test(cleaned)) continue
    if (/^.{0,30}の予定/u.test(cleaned) && cleaned.length < 30) continue

    // 「=」「数量」「人工」のいずれも全く含まないブロックは予定表本文とみなさずスキップ
    if (!/[=＝]/.test(b) && !/[\d,]+[KkＫ]/.test(b) && !/\d+人目/.test(b)) continue

    const blk = parseBlock(b, baseDate)
    if (blk) parsed.push(blk)
  }

  return c.json({ baseDate, blocks: parsed })
})

// パース結果をDB登録（3階層に upsert）
interface CommitBlock {
  contractor: string
  site_name: string
  part: string
  quantity: number
  manpower: number
  workers: string[]
  vehicle_note: string
  work_date: string
  qty_strategy?: 'keep' | 'overwrite' | 'add'   // 既存部位の数量との衝突時
}

api.post('/import/commit', async (c) => {
  const { blocks } = await c.req.json<{ blocks: CommitBlock[] }>()
  if (!Array.isArray(blocks) || !blocks.length) return c.json({ error: '登録対象がありません' }, 400)

  const results: Array<{ index: number; ok: boolean; site_id?: number; site_part_id?: number; installation_id?: number; error?: string; note?: string }> = []

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    try {
      if (!b.contractor?.trim() || !b.site_name?.trim()) {
        results.push({ index: i, ok: false, error: '元請または現場名が未入力です' })
        continue
      }
      if (!b.part?.trim()) {
        results.push({ index: i, ok: false, error: '部位が未入力です' })
        continue
      }
      if (!b.work_date) {
        results.push({ index: i, ok: false, error: '取付日が未入力です' })
        continue
      }
      const contractor = b.contractor.trim()
      const site_name = b.site_name.trim()
      const part = b.part.trim()

      // 1. 現場の upsert
      let site = await c.env.DB.prepare(
        'SELECT id FROM sites WHERE contractor = ? AND site_name = ?'
      ).bind(contractor, site_name).first<{ id: number }>()
      let site_id: number
      if (site) {
        site_id = site.id
      } else {
        const r = await c.env.DB.prepare(
          'INSERT INTO sites (contractor, site_name) VALUES (?, ?)'
        ).bind(contractor, site_name).run()
        site_id = r.meta.last_row_id as number
      }

      // 2. 部位 (site_parts) の upsert
      const sp = await c.env.DB.prepare(
        'SELECT id, quantity FROM site_parts WHERE site_id = ? AND part = ?'
      ).bind(site_id, part).first<{ id: number; quantity: number }>()
      let site_part_id: number
      let qtyNote = ''
      const newQty = Number(b.quantity) || 0
      const strat = b.qty_strategy || 'keep'

      if (sp) {
        site_part_id = sp.id
        const oldQty = Number(sp.quantity) || 0
        if (newQty > 0 && oldQty !== newQty) {
          if (strat === 'overwrite') {
            await c.env.DB.prepare(
              'UPDATE site_parts SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(newQty, sp.id).run()
            qtyNote = `数量を ${oldQty} → ${newQty} に上書き`
          } else if (strat === 'add') {
            const sumQty = oldQty + newQty
            await c.env.DB.prepare(
              'UPDATE site_parts SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(sumQty, sp.id).run()
            qtyNote = `数量を ${oldQty} + ${newQty} = ${sumQty} に加算`
          } else {
            qtyNote = `数量は既存値 ${oldQty} のまま (取込値 ${newQty} は適用せず)`
          }
        }
      } else {
        const r = await c.env.DB.prepare(
          'INSERT INTO site_parts (site_id, part, quantity, note) VALUES (?, ?, ?, ?)'
        ).bind(site_id, part, newQty, '').run()
        site_part_id = r.meta.last_row_id as number
      }

      // 3. 取付実績 (installations) の登録
      const mp = Number(b.manpower) || 0
      const vn = (b.vehicle_note || '').toString().trim()
      const ins = await c.env.DB.prepare(`
        INSERT INTO installations
          (site_part_id, site_id, work_date, contractor, site_name, part,
           quantity, manpower, delivery_vehicles, commute_vehicles, vehicle_note, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        site_part_id, site_id, b.work_date, contractor, site_name, part,
        0, mp, 0, 0, vn, ''
      ).run()
      const installation_id = ins.meta.last_row_id as number

      // 4. 人員名
      if (Array.isArray(b.workers)) {
        for (const w of b.workers) {
          const name = (w || '').toString().trim()
          if (!name) continue
          await c.env.DB.prepare(
            'INSERT INTO installation_workers (installation_id, worker_name) VALUES (?, ?)'
          ).bind(installation_id, name).run()
        }
      }

      results.push({ index: i, ok: true, site_id, site_part_id, installation_id, note: qtyNote })
    } catch (e: any) {
      results.push({ index: i, ok: false, error: String(e?.message || e) })
    }
  }

  return c.json({ results })
})

// 既存 site の (contractor, site_name) 一覧 + 既存 site_parts (site_id, part) 一覧
// 取込画面で「既存と一致するか」を事前判定するためのデータを返す
api.get('/import/existing', async (c) => {
  const sites = await c.env.DB.prepare(
    'SELECT id, contractor, site_name FROM sites'
  ).all()
  const parts = await c.env.DB.prepare(
    'SELECT sp.id, sp.site_id, sp.part, sp.quantity FROM site_parts sp'
  ).all()
  return c.json({ sites: sites.results, site_parts: parts.results })
})

export default api
