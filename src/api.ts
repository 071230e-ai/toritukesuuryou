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

  // === 重複チェック: 同じ現場・同じ部位・同じ取付日 ===
  const dup = await c.env.DB.prepare(
    'SELECT id FROM installations WHERE site_id = ? AND site_part_id = ? AND work_date = ? LIMIT 1'
  ).bind(sp.site_id, sp.id, body.work_date).first<{ id: number }>()
  if (dup) {
    return c.json({
      error: `すでに同じ取付日の同じ部位が登録されています\n元請: ${sp.contractor}\n現場名: ${sp.site_name}\n部位: ${sp.part}\n取付日: ${body.work_date}`,
      duplicate: true,
      existing_id: dup.id,
    }, 400)
  }

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

  // === 重複チェック: 同じ現場・同じ部位・同じ取付日 (編集中の自分自身は除外) ===
  const dup = await c.env.DB.prepare(
    'SELECT id FROM installations WHERE site_id = ? AND site_part_id = ? AND work_date = ? AND id != ? LIMIT 1'
  ).bind(sp.site_id, sp.id, body.work_date, id).first<{ id: number }>()
  if (dup) {
    return c.json({
      error: `すでに同じ取付日の同じ部位が登録されています\n元請: ${sp.contractor}\n現場名: ${sp.site_name}\n部位: ${sp.part}\n取付日: ${body.work_date}`,
      duplicate: true,
      existing_id: dup.id,
    }, 400)
  }

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
    .replace(/[\uFE0F]/g, '')         // 異体字セレクタ (VS16)
    .replace(/[!！。]+$/g, '')        // 末尾の記号
    .trim()
}

// ‼️ または ! を区切りとして扱う統一区切り正規表現
// ‼️ は U+203C + U+FE0F、または U+2757 (❗) なども想定
const SEP_RE = /[‼❗]+\uFE0F?|[!！]+/u

// 人員名から人工数を計算する共通関数
// ルール:
//   - 「×N」「xN」「XN」「×N」(全角×・半角x・半角X 全部対応) があればその N を人工数として加算
//   - 倍数記号がなければ 1人工として加算
//   - 半角・全角の数字に対応
// 例: ["中村隆", "中村清", "小泉組×4"] → 1 + 1 + 4 = 6
export function calcManpowerFromWorkers(workers: string[]): number {
  if (!Array.isArray(workers)) return 0
  let total = 0
  const mulRe = /[×xX✕✖](\d+(?:\.\d+)?)/
  for (const w of workers) {
    const name = String(w || '').trim()
    if (!name) continue
    const m = name.match(mulRe)
    if (m) {
      const n = Number(m[1]) || 0
      total += n > 0 ? n : 1
    } else {
      total += 1
    }
  }
  return total
}

// 「(見積り書有り)」「(見積り書無し)」「(仮称)」等の現場名に余分な接頭/接尾括弧を除去
function stripQuoteParen(s: string): string {
  return s
    // 見積り書(有り/無し/有/無) — 「有り」「無し」を最後まで吸収
    .replace(/[（(]\s*見積\s*り?\s*書\s*(?:有\s*り?|無\s*し?)\s*[)）]/g, '')
    // (仮称) (仮) を除去
    .replace(/[（(]\s*仮称?\s*[)）]/g, '')
    .trim()
}

// ‼️ 区切りで現場名候補に挟まれる「ノイズセグメント」を判定
// 例: 「終了予定」「終わり次第」「朝礼○時」など
function isNoiseBetweenHeaderAndSite(seg: string): boolean {
  const s = seg.replace(/\s+/g, '')
  if (!s) return true
  if (/^(終了予定|終わり次第)$/.test(s)) return true
  if (/^朝礼/.test(s)) return true
  if (/^配筋検査/.test(s)) return true
  if (/^\d{1,2}\s*時/.test(s)) return true
  return false
}

// 部位として妥当でないセグメントを判定
// - 住所 / 時間 / 朝礼・配筋検査 / 車両名 / 人員行 / メモ系
function isNonPartSegment(seg: string): boolean {
  const s = seg.replace(/\s+/g, '')
  if (!s) return true
  // 人員行 ( = / 応援= から始まる )
  if (/^[応援]*\s*[=＝]/.test(s)) return true
  if (/[=＝]/.test(s)) return true
  // 時間 / 朝礼 / 配筋検査
  if (/^\d{1,2}\s*時/.test(s)) return true
  if (/朝礼|配筋検査|終了予定|終わり次第|高速代車|駐車場代|請求/.test(s)) return true
  // 車両名 / 車両メモ
  if (/^\d+\s*[トt][ンン](?:運搬|ダンプ|車)/.test(s)) return true
  if (/エブリ|プロボックス|ハイエース/.test(s)) return true
  if (/旧.*車?$/.test(s) && s.length < 8) return true
  // 数量・人工数・日数の単独
  if (/^約?[\d,]+[KkＫ]$/.test(s)) return true
  if (/^[\d]+人目$/.test(s)) return true
  if (/^[\d]+日目$/.test(s)) return true
  // 住所判定 (強パターン)
  if (/(?:[都道府県市区郡]\S{0,15}(?:町|村|丁目|番地|付近)|\d+丁目|\d+番地|\d+号地|号地|付近$|擁壁$|京都\S*区|大阪\S*区|阿倍野|伏見|下京|上京|中京|右京|左京|西京|北区|南区|東山|山科|亀岡|茨木|岩田鉄筋取り付け)/.test(s)) return true
  // メモ的記述 (「○○君エブリ」「山﨑君エブリ、和志君エブリ」など)
  if (/君エブリ/.test(s)) return true
  return false
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
//
// 想定する1行目の構造:
//   元請、○日目、数量K、○人目‼️現場名(見積り書有り/無し)‼️部位‼️住所やメモ‼️…
//
// 解析ルール:
//   - 「=」または「応援=」で始まる行は **人員名のみ** として扱い、現場名・部位候補から完全に除外
//   - 1行目を ‼️ で分割し、「○人目」を含むセグメントの直後を現場名、次を部位、それ以降を住所/メモとして読み飛ばす
//   - 数量・運搬車両は行を問わずブロック全体から正規表現で抽出
//   - 人工数は「○人目」(通し番号の可能性) からは抽出せず、workers から計算 (calcManpowerFromWorkers)
//   - 日付はブロック内からは抽出しない（住所の "1-12-1/3号地" 等の誤検知防止）。呼び出し側で fallbackDate を渡す。
function parseBlock(rawBlock: string, fallbackDate: string): ParsedBlock | null {
  const warnings: string[] = []
  const allLines = rawBlock.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!allLines.length) return null

  // === 行を「人員名行 (=/応援=で始まる)」と「それ以外」に分離 ===
  // workers 行は現場名・部位の解析対象に絶対に入れない
  const workerLines: string[] = []
  const otherLines: string[] = []
  for (const ln of allLines) {
    // ‼️ や 異体字セレクタ を一旦除去した先頭文字で判定
    const head = ln.replace(/^[\s‼❗\uFE0F!！]+/, '')
    if (/^(?:応援\s*)?[=＝]/.test(head)) {
      workerLines.push(ln)
    } else {
      otherLines.push(ln)
    }
  }
  if (!otherLines.length) return null

  // === 数量 / 運搬車両 はブロック全体から抽出 ===
  // (「○人目」は通し番号の可能性があるため人工数として使わない)
  let quantity = 0
  const qm = rawBlock.match(/約?\s*([\d,]+)\s*[KkＫ]/)
  if (qm) quantity = Number(qm[1].replace(/,/g, '')) || 0
  if (!quantity) warnings.push('数量を読み取れませんでした')

  const vm = rawBlock.match(/(\d+\s*[トt]\s*[ンン]\s*(?:運搬|ダンプ|車))/)
  const vehicle_note = vm ? cleanSegment(vm[1]).replace(/\s+/g, '') : ''

  // === 人員名: workerLines から抽出。「= の後ろ」または「応援= の後ろ」を、、, で分割 ===
  // otherLines にも「=」を含む行が混入することがあるが、その場合も = 以降のみ拾う(安全策)
  let workers: string[] = []
  const eqRe = /(?:応援\s*)?[=＝]([^=＝\n]+)/g
  for (const ln of workerLines) {
    let m: RegExpExecArray | null
    eqRe.lastIndex = 0
    while ((m = eqRe.exec(ln)) !== null) {
      const ws = m[1]
        .split(/[‼❗、,，]+\uFE0F?/u)
        .map(cleanSegment)
        .map(w => w.replace(/[‼❗!！\uFE0F]+/g, '').trim())
        .filter(w => w && !/^\(.*\)$/.test(w))
      workers.push(...ws)
    }
  }
  // 重複除去 (同じ表記の人員名が複数回出現した場合は1つに)
  workers = Array.from(new Set(workers))
  if (!workers.length) warnings.push('人員名を読み取れませんでした')

  // === 人工数: 人員名リストから計算 ===
  // ルール:
  //   - 「×N」「xN」「XN」が付いている場合は N を加算 (例: 小泉組×4 → 4)
  //   - 無ければ 1 を加算 (例: 中村隆 → 1)
  const manpower = calcManpowerFromWorkers(workers)
  if (!manpower) warnings.push('人工数を読み取れませんでした')

  // === 元請 / 現場名 / 部位 を otherLines の1行目から位置ベースで抽出 ===
  let contractor = ''
  let site_name = ''
  let part = ''

  // 1行目 (worker 以外の最初の行) を ‼️ で分割
  const firstLine = otherLines[0]
  const firstSegs = firstLine.split(SEP_RE).map(cleanSegment).filter(Boolean)

  // [0] には「元請、○日目、数量K、○人目」の複合が入っている想定
  // 「○人目」を含む位置を見つけ、その次のセグメントが現場名、さらに次が部位
  let headerIdx = -1
  for (let i = 0; i < firstSegs.length; i++) {
    if (/人\s*目/.test(firstSegs[i])) {
      headerIdx = i
      break
    }
  }

  // 元請: 先頭セグメントを「、」「,」で分割した最初の項目
  // ただし headerIdx > 0 の場合は ‼️ より前にすでに分割されているケースもある → firstSegs[0] が「元請」だけのこともある
  const headerSeg = firstSegs[0] || ''
  const headerParts = headerSeg.split(/[、,，]/).map(s => cleanSegment(s)).filter(Boolean)
  if (headerParts.length) contractor = headerParts[0]

  // 現場名 = headerIdx 直後のセグメント (ノイズはスキップ)
  // 部位 = その次のセグメント
  if (headerIdx >= 0) {
    // ノイズ (終了予定/終わり次第/朝礼/時刻 等) はスキップして次の有効なセグメントを現場名とする
    let siteIdx = headerIdx + 1
    while (siteIdx < firstSegs.length && isNoiseBetweenHeaderAndSite(firstSegs[siteIdx])) {
      siteIdx++
    }
    const siteRaw = firstSegs[siteIdx]
    const partRaw = firstSegs[siteIdx + 1]
    if (siteRaw) {
      const c = stripQuoteParen(siteRaw).trim()
      if (c) site_name = c
    }
    if (partRaw) {
      const c = stripQuoteParen(partRaw).trim()
      // 部位行に住所・時間・メモが来た場合は採用しない
      if (c && !isNonPartSegment(c)) part = c
    }
  } else {
    // 「○人目」が1行目に無い場合の救済処理
    // パターンA: ‼️で分割した先頭 firstSegs[0] 内に「、元請、数量K、現場名(...)」と
    //            すべてが詰まっているケース (MIC, aIife木造)
    //            → firstSegs[0] を 、 で分割し、K を含む項目より後を現場名候補とする
    // パターンB: firstSegs[i] (i>0) に K が単独で入っているケース
    //            → firstSegs[qIdx + 1] を現場名候補とする (従来動作)

    // パターンA: 先頭セグメント内の「、」分割
    const head0 = firstSegs[0] || ''
    const head0Parts = head0.split(/[、,，]/).map(s => cleanSegment(s)).filter(Boolean)
    let kPartIdx = -1
    for (let i = 0; i < head0Parts.length; i++) {
      if (/^約?\s*[\d,]+\s*[KkＫ]\s*$/.test(head0Parts[i])) { kPartIdx = i; break }
    }
    if (kPartIdx >= 0 && kPartIdx + 1 < head0Parts.length) {
      // K の後ろ (、で続いている) を現場名として採用
      // 例: 「MIC、368K、国道423号(法貴バイパス)防災・安全交付金工事(見積り書有り)」
      //      → head0Parts = ["MIC","368K","国道423号(法貴バイパス)防災・安全交付金工事(見積り書有り)"]
      //      → 現場名 = head0Parts[2]
      const siteRaw = head0Parts.slice(kPartIdx + 1).join('、')
      const c = stripQuoteParen(siteRaw).trim()
      if (c) site_name = c
      // 部位は firstSegs[1] (次の ‼️ 区切り) から取得
      const partRaw = firstSegs[1]
      if (partRaw) {
        const pc = stripQuoteParen(partRaw).trim()
        if (pc && !isNonPartSegment(pc)) part = pc
      }
    } else {
      // パターンB: ‼️ で区切られた個別セグメントに K が単独で入っているケース
      let qIdx = -1
      for (let i = 0; i < firstSegs.length; i++) {
        if (/[KkＫ]/.test(firstSegs[i])) { qIdx = i; break }
      }
      if (qIdx >= 0) {
        const siteRaw = firstSegs[qIdx + 1]
        const partRaw = firstSegs[qIdx + 2]
        if (siteRaw) {
          const c = stripQuoteParen(siteRaw).trim()
          if (c) site_name = c
        }
        if (partRaw) {
          const c = stripQuoteParen(partRaw).trim()
          if (c && !isNonPartSegment(c)) part = c
        }
      }
    }
  }

  // 住所形式の現場名 (例: 「中京区壬生天池町35-20・35-21④」) を受け入れる
  // 既に site_name が拾えていれば住所判定で再度弾かない（位置ベース優先）

  if (!contractor) warnings.push('元請を読み取れませんでした')
  if (!site_name)  warnings.push('現場名を読み取れませんでした')
  if (!part)       warnings.push('部位を読み取れませんでした')

  return {
    contractor,
    site_name,
    part,
    quantity,
    manpower,
    workers,
    vehicle_note,
    work_date: fallbackDate,
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

  // 全体テキストの先頭ヘッダ（最初の空行までの行のみ）から日付を抽出
  // これにより、ブロック内の住所「1-12-1/3号地」のような数字が日付として誤抽出されないようにする
  const headerLines: string[] = []
  for (const ln of lines) {
    if (ln.trim() === '') {
      if (headerLines.length) break
      continue
    }
    headerLines.push(ln)
    if (headerLines.length >= 5) break
  }
  // ヘッダ行が「6/18日の予定です」等の短い予定記述だけの場合に絞って日付抽出する
  // (1ブロック目から始まる場合はヘッダ無しなのでスキップ)
  let headerDate = ''
  const headerJoined = headerLines.join(' ')
  // 「予定」を含む短いヘッダのみから抽出 (=数量Kや人工目を含む現場行は対象外)
  if (/予定/.test(headerJoined) && !/[KkＫ]/.test(headerJoined) && !/人\s*目/.test(headerJoined)) {
    headerDate = extractWorkDate(headerJoined, '')
  }

  // 取付日の優先順位:
  //   ① フォームの work_date (画面の取付日入力欄)
  //   ② テキスト先頭のヘッダ行 ("6/18日の予定です") から抽出
  //   ③ 今日の日付
  // ブロック内のテキストからは日付を抽出しない (住所の "1/3" 等の誤検知防止)
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
  delivery_vehicles?: number
  commute_vehicles?: number
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

      // === 重複チェック: 同じ現場・同じ部位・同じ取付日 ===
      const dupIns = await c.env.DB.prepare(
        'SELECT id FROM installations WHERE site_id = ? AND site_part_id = ? AND work_date = ? LIMIT 1'
      ).bind(site_id, site_part_id, b.work_date).first<{ id: number }>()
      if (dupIns) {
        results.push({
          index: i, ok: false,
          error: `すでに同じ取付日の同じ部位が登録されています\n元請: ${contractor}\n現場名: ${site_name}\n部位: ${part}\n取付日: ${b.work_date}`,
        })
        continue
      }

      // 3. 取付実績 (installations) の登録
      const mp = Number(b.manpower) || 0
      const vn = (b.vehicle_note || '').toString().trim()
      const dv = Math.max(0, Math.floor(Number(b.delivery_vehicles) || 0))
      const cv = Math.max(0, Math.floor(Number(b.commute_vehicles) || 0))
      const ins = await c.env.DB.prepare(`
        INSERT INTO installations
          (site_part_id, site_id, work_date, contractor, site_name, part,
           quantity, manpower, delivery_vehicles, commute_vehicles, vehicle_note, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        site_part_id, site_id, b.work_date, contractor, site_name, part,
        0, mp, dv, cv, vn, ''
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
