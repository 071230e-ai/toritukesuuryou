import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const api = new Hono<{ Bindings: Bindings }>()

// ============================================================
// Parts (部位マスタ)
// ============================================================
api.get('/parts', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, sort_order FROM parts ORDER BY sort_order, id'
  ).all()
  return c.json(results)
})

api.post('/parts', async (c) => {
  const { name, sort_order } = await c.req.json<{ name: string; sort_order?: number }>()
  if (!name || !name.trim()) return c.json({ error: 'name required' }, 400)
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO parts (name, sort_order) VALUES (?, ?)'
    ).bind(name.trim(), sort_order ?? 500).run()
    return c.json({ id: r.meta.last_row_id, name: name.trim() })
  } catch {
    return c.json({ error: 'already exists or invalid' }, 400)
  }
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
// Sites (現場マスタ: 元請 × 現場名)
// ============================================================
// 一覧（各現場の集計サマリ込み）
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
  const sql = `
    SELECT s.id, s.contractor, s.site_name, s.note, s.created_at, s.updated_at,
      COALESCE(agg.work_days, 0)   AS work_days,
      COALESCE(agg.total_qty, 0)   AS total_qty,
      COALESCE(agg.total_mp, 0)    AS total_mp,
      COALESCE(agg.row_count, 0)   AS row_count
    FROM sites s
    LEFT JOIN (
      SELECT site_id,
        COUNT(DISTINCT work_date) AS work_days,
        SUM(quantity) AS total_qty,
        SUM(manpower) AS total_mp,
        COUNT(*)      AS row_count
      FROM installations
      WHERE site_id IS NOT NULL
      GROUP BY site_id
    ) agg ON agg.site_id = s.id
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
  const { contractor, site_name, note } = await c.req.json<{
    contractor: string; site_name: string; note?: string
  }>()
  if (!contractor?.trim() || !site_name?.trim()) {
    return c.json({ error: '元請と現場名は必須です' }, 400)
  }
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO sites (contractor, site_name, note) VALUES (?, ?, ?)'
    ).bind(contractor.trim(), site_name.trim(), note?.trim() ?? '').run()
    return c.json({ id: r.meta.last_row_id })
  } catch {
    return c.json({ error: '同じ元請・現場名の組み合わせはすでに登録されています' }, 400)
  }
})

api.put('/sites/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const { contractor, site_name, note } = await c.req.json<{
    contractor: string; site_name: string; note?: string
  }>()
  if (!contractor?.trim() || !site_name?.trim()) {
    return c.json({ error: '元請と現場名は必須です' }, 400)
  }
  try {
    // 同じ元請・現場名の取付実績の contractor / site_name も更新（表示用カラムなので同期）
    await c.env.DB.prepare(
      `UPDATE sites SET contractor = ?, site_name = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(contractor.trim(), site_name.trim(), note?.trim() ?? '', id).run()
    await c.env.DB.prepare(
      `UPDATE installations SET contractor = ?, site_name = ? WHERE site_id = ?`
    ).bind(contractor.trim(), site_name.trim(), id).run()
    return c.json({ ok: true })
  } catch {
    return c.json({ error: '更新に失敗しました（重複の可能性）' }, 400)
  }
})

api.delete('/sites/:id', async (c) => {
  const id = Number(c.req.param('id'))
  // この現場の取付実績を確認
  const cnt = await c.env.DB.prepare(
    'SELECT COUNT(*) AS c FROM installations WHERE site_id = ?'
  ).bind(id).first<{ c: number }>()
  const force = c.req.query('force') === '1'
  if (cnt && cnt.c > 0 && !force) {
    return c.json({ error: `この現場には ${cnt.c} 件の取付実績があります。force=1 で実績ごと削除できます`, count: cnt.c }, 400)
  }
  if (force && cnt && cnt.c > 0) {
    // 関連する worker と installation を削除
    await c.env.DB.prepare(`
      DELETE FROM installation_workers WHERE installation_id IN (
        SELECT id FROM installations WHERE site_id = ?
      )`).bind(id).run()
    await c.env.DB.prepare('DELETE FROM installations WHERE site_id = ?').bind(id).run()
  }
  await c.env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// 現場ごとの取付実績一覧
api.get('/sites/:id/installations', async (c) => {
  const id = Number(c.req.param('id'))
  const { results } = await c.env.DB.prepare(`
    SELECT i.id, i.work_date, i.part, i.quantity, i.manpower, i.note,
      (SELECT GROUP_CONCAT(worker_name, ',') FROM installation_workers w WHERE w.installation_id = i.id) AS workers
    FROM installations i
    WHERE i.site_id = ?
    ORDER BY i.work_date DESC, i.id DESC
  `).bind(id).all()
  const data = (results as any[]).map(r => ({
    ...r,
    workers: r.workers ? String(r.workers).split(',') : []
  }))
  return c.json(data)
})

// ============================================================
// Suggestions (人員名のみ。元請/現場は sites に登録するのでサジェスト不要)
// ============================================================
api.get('/suggestions', async (c) => {
  const workers = await c.env.DB.prepare(
    'SELECT DISTINCT worker_name AS v FROM installation_workers ORDER BY worker_name'
  ).all()
  return c.json({
    workers: (workers.results as any[]).map(r => r.v),
  })
})

// ============================================================
// Installations (取付実績)
// ============================================================
interface InstallPayload {
  work_date: string
  site_id: number
  part: string
  quantity: number
  manpower: number
  note?: string
  workers?: string[]
}

// 一覧 / 検索（分析画面のフィルタ用）
api.get('/installations', async (c) => {
  const q = c.req.query()
  const where: string[] = []
  const params: any[] = []
  if (q.from) { where.push('i.work_date >= ?'); params.push(q.from) }
  if (q.to)   { where.push('i.work_date <= ?'); params.push(q.to) }
  if (q.contractor) { where.push('i.contractor = ?'); params.push(q.contractor) }
  if (q.site) { where.push('i.site_name = ?'); params.push(q.site) }
  if (q.site_id) { where.push('i.site_id = ?'); params.push(Number(q.site_id)) }
  if (q.part) { where.push('i.part = ?'); params.push(q.part) }
  if (q.worker) {
    where.push('EXISTS (SELECT 1 FROM installation_workers w WHERE w.installation_id = i.id AND w.worker_name = ?)')
    params.push(q.worker)
  }
  if (q.search) {
    where.push('(i.contractor LIKE ? OR i.site_name LIKE ? OR i.part LIKE ? OR EXISTS (SELECT 1 FROM installation_workers w WHERE w.installation_id = i.id AND w.worker_name LIKE ?))')
    const kw = `%${q.search}%`
    params.push(kw, kw, kw, kw)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const sql = `
    SELECT i.id, i.site_id, i.work_date, i.contractor, i.site_name, i.part,
      i.quantity, i.manpower, i.note,
      (SELECT GROUP_CONCAT(worker_name, ',') FROM installation_workers w WHERE w.installation_id = i.id) AS workers
    FROM installations i
    ${whereSql}
    ORDER BY i.work_date DESC, i.id DESC
  `
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const data = (results as any[]).map(r => ({
    ...r,
    workers: r.workers ? String(r.workers).split(',') : []
  }))
  return c.json(data)
})

api.get('/installations/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare(
    'SELECT * FROM installations WHERE id = ?'
  ).bind(id).first()
  if (!row) return c.json({ error: 'not found' }, 404)
  const workers = await c.env.DB.prepare(
    'SELECT worker_name FROM installation_workers WHERE installation_id = ?'
  ).bind(id).all()
  return c.json({ ...row, workers: (workers.results as any[]).map(w => w.worker_name) })
})

api.post('/installations', async (c) => {
  const body = await c.req.json<InstallPayload>()
  if (!body.work_date || !body.site_id || !body.part) {
    return c.json({ error: '取付日・現場・部位は必須です' }, 400)
  }
  // 現場情報取得（contractor/site_name を実績テーブルにも持たせる）
  const site = await c.env.DB.prepare(
    'SELECT contractor, site_name FROM sites WHERE id = ?'
  ).bind(body.site_id).first<{ contractor: string; site_name: string }>()
  if (!site) return c.json({ error: '現場が見つかりません' }, 400)

  const r = await c.env.DB.prepare(
    `INSERT INTO installations (site_id, work_date, contractor, site_name, part, quantity, manpower, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.site_id, body.work_date, site.contractor, site.site_name, body.part.trim(),
    Number(body.quantity) || 0, Number(body.manpower) || 0, body.note ?? ''
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
  if (!body.work_date || !body.site_id || !body.part) {
    return c.json({ error: '取付日・現場・部位は必須です' }, 400)
  }
  const site = await c.env.DB.prepare(
    'SELECT contractor, site_name FROM sites WHERE id = ?'
  ).bind(body.site_id).first<{ contractor: string; site_name: string }>()
  if (!site) return c.json({ error: '現場が見つかりません' }, 400)

  await c.env.DB.prepare(
    `UPDATE installations
     SET site_id = ?, work_date = ?, contractor = ?, site_name = ?, part = ?,
         quantity = ?, manpower = ?, note = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    body.site_id, body.work_date, site.contractor, site.site_name, body.part.trim(),
    Number(body.quantity) || 0, Number(body.manpower) || 0, body.note ?? '', id
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
// Analytics
// ============================================================
function buildFilter(q: Record<string, string>) {
  const where: string[] = []
  const params: any[] = []
  if (q.from) { where.push('i.work_date >= ?'); params.push(q.from) }
  if (q.to)   { where.push('i.work_date <= ?'); params.push(q.to) }
  if (q.contractor) { where.push('i.contractor = ?'); params.push(q.contractor) }
  if (q.site) { where.push('i.site_name = ?'); params.push(q.site) }
  if (q.site_id) { where.push('i.site_id = ?'); params.push(Number(q.site_id)) }
  if (q.part) { where.push('i.part = ?'); params.push(q.part) }
  if (q.worker) {
    where.push('EXISTS (SELECT 1 FROM installation_workers w WHERE w.installation_id = i.id AND w.worker_name = ?)')
    params.push(q.worker)
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

// ダッシュボード
api.get('/analytics/dashboard', async (c) => {
  const q = c.req.query()
  const { whereSql, params } = buildFilter(q)

  const totalRow = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(i.quantity), 0) AS total_qty,
      COALESCE(SUM(i.manpower), 0) AS total_mp,
      COUNT(*) AS row_count
    FROM installations i
    ${whereSql}
  `).bind(...params).first<{ total_qty: number; total_mp: number; row_count: number }>()

  const byContractor = await c.env.DB.prepare(`
    SELECT i.contractor AS name, SUM(i.quantity) AS qty, SUM(i.manpower) AS mp
    FROM installations i ${whereSql}
    GROUP BY i.contractor ORDER BY qty DESC LIMIT 10
  `).bind(...params).all()

  const bySite = await c.env.DB.prepare(`
    SELECT i.site_name AS name, i.contractor AS contractor,
      SUM(i.quantity) AS qty, SUM(i.manpower) AS mp
    FROM installations i ${whereSql}
    GROUP BY i.contractor, i.site_name ORDER BY qty DESC LIMIT 10
  `).bind(...params).all()

  const byPart = await c.env.DB.prepare(`
    SELECT i.part AS name, SUM(i.quantity) AS qty, SUM(i.manpower) AS mp
    FROM installations i ${whereSql}
    GROUP BY i.part ORDER BY qty DESC
  `).bind(...params).all()

  const byWorker = await c.env.DB.prepare(`
    SELECT w.worker_name AS name,
      SUM(i.quantity * 1.0 / wc.cnt) AS qty,
      SUM(i.manpower * 1.0 / wc.cnt) AS mp
    FROM installations i
    JOIN installation_workers w ON w.installation_id = i.id
    JOIN (SELECT installation_id, COUNT(*) AS cnt FROM installation_workers GROUP BY installation_id) wc
      ON wc.installation_id = i.id
    ${whereSql}
    GROUP BY w.worker_name ORDER BY qty DESC LIMIT 20
  `).bind(...params).all()

  return c.json({
    total: totalRow,
    byContractor: byContractor.results,
    bySite: bySite.results,
    byPart: byPart.results,
    byWorker: byWorker.results,
  })
})

// 元請・現場ごとのサマリ
api.get('/analytics/sites', async (c) => {
  const q = c.req.query()
  const { whereSql, params } = buildFilter(q)
  const { results } = await c.env.DB.prepare(`
    SELECT i.contractor, i.site_name, i.site_id,
      COUNT(DISTINCT i.work_date) AS work_days,
      SUM(i.quantity) AS total_qty,
      SUM(i.manpower) AS total_mp
    FROM installations i
    ${whereSql}
    GROUP BY i.contractor, i.site_name, i.site_id
    ORDER BY total_qty DESC
  `).bind(...params).all()
  return c.json(results)
})

export default api
