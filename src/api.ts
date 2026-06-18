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
  workers?: string[]
  note?: string
}

// 取付実績一覧（部位ID別 or 全体検索）
api.get('/site-parts/:id/installations', async (c) => {
  const id = Number(c.req.param('id'))
  const { results } = await c.env.DB.prepare(`
    SELECT i.id, i.work_date, i.manpower, i.delivery_vehicles, i.commute_vehicles, i.note,
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
      i.manpower, i.delivery_vehicles, i.commute_vehicles, i.note,
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

  const r = await c.env.DB.prepare(`
    INSERT INTO installations
      (site_part_id, site_id, work_date, contractor, site_name, part,
       quantity, manpower, delivery_vehicles, commute_vehicles, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sp.id, sp.site_id, body.work_date, sp.contractor, sp.site_name, sp.part,
    0, mp, dv, cv, body.note ?? ''
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

  await c.env.DB.prepare(`
    UPDATE installations SET
      site_part_id = ?, site_id = ?, work_date = ?, contractor = ?, site_name = ?, part = ?,
      manpower = ?, delivery_vehicles = ?, commute_vehicles = ?, note = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    sp.id, sp.site_id, body.work_date, sp.contractor, sp.site_name, sp.part,
    mp, dv, cv, body.note ?? '', id
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

export default api
