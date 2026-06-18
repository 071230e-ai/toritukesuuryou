import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const api = new Hono<{ Bindings: Bindings }>()

// ---------- Parts (部位マスタ) ----------
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
  } catch (e: any) {
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

// ---------- Suggestions (元請/現場/人員) ----------
api.get('/suggestions', async (c) => {
  const [contractors, sites, workers] = await Promise.all([
    c.env.DB.prepare('SELECT DISTINCT contractor AS v FROM installations ORDER BY contractor').all(),
    c.env.DB.prepare('SELECT DISTINCT site_name AS v FROM installations ORDER BY site_name').all(),
    c.env.DB.prepare('SELECT DISTINCT worker_name AS v FROM installation_workers ORDER BY worker_name').all(),
  ])
  return c.json({
    contractors: (contractors.results as any[]).map(r => r.v),
    sites: (sites.results as any[]).map(r => r.v),
    workers: (workers.results as any[]).map(r => r.v),
  })
})

// ---------- Installations ----------
// 検索 (期間 / 元請 / 現場 / 部位 / 人員 / フリーワード)
api.get('/installations', async (c) => {
  const q = c.req.query()
  const where: string[] = []
  const params: any[] = []
  if (q.from) { where.push('i.work_date >= ?'); params.push(q.from) }
  if (q.to)   { where.push('i.work_date <= ?'); params.push(q.to) }
  if (q.contractor) { where.push('i.contractor = ?'); params.push(q.contractor) }
  if (q.site) { where.push('i.site_name = ?'); params.push(q.site) }
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
    SELECT i.id, i.work_date, i.contractor, i.site_name, i.part, i.quantity, i.manpower, i.note,
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

interface InstallPayload {
  work_date: string
  contractor: string
  site_name: string
  part: string
  quantity: number
  manpower: number
  note?: string
  workers?: string[]
}

api.post('/installations', async (c) => {
  const body = await c.req.json<InstallPayload>()
  if (!body.work_date || !body.contractor || !body.site_name || !body.part) {
    return c.json({ error: '必須項目が不足しています' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO installations (work_date, contractor, site_name, part, quantity, manpower, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.work_date, body.contractor.trim(), body.site_name.trim(), body.part.trim(),
    Number(body.quantity) || 0, Number(body.manpower) || 0, body.note ?? ''
  ).run()
  const id = r.meta.last_row_id as number
  if (body.workers && body.workers.length) {
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
  await c.env.DB.prepare(
    `UPDATE installations
     SET work_date = ?, contractor = ?, site_name = ?, part = ?,
         quantity = ?, manpower = ?, note = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    body.work_date, body.contractor.trim(), body.site_name.trim(), body.part.trim(),
    Number(body.quantity) || 0, Number(body.manpower) || 0, body.note ?? '', id
  ).run()
  await c.env.DB.prepare('DELETE FROM installation_workers WHERE installation_id = ?').bind(id).run()
  if (body.workers && body.workers.length) {
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

// ---------- Analytics ----------
function buildFilter(q: Record<string, string>) {
  const where: string[] = []
  const params: any[] = []
  if (q.from) { where.push('i.work_date >= ?'); params.push(q.from) }
  if (q.to)   { where.push('i.work_date <= ?'); params.push(q.to) }
  if (q.contractor) { where.push('i.contractor = ?'); params.push(q.contractor) }
  if (q.site) { where.push('i.site_name = ?'); params.push(q.site) }
  if (q.part) { where.push('i.part = ?'); params.push(q.part) }
  if (q.worker) {
    where.push('EXISTS (SELECT 1 FROM installation_workers w WHERE w.installation_id = i.id AND w.worker_name = ?)')
    params.push(q.worker)
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

// 全体サマリ + ランキング
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
    SELECT i.contractor AS name,
      SUM(i.quantity) AS qty, SUM(i.manpower) AS mp
    FROM installations i
    ${whereSql}
    GROUP BY i.contractor ORDER BY qty DESC LIMIT 10
  `).bind(...params).all()

  const bySite = await c.env.DB.prepare(`
    SELECT i.site_name AS name, i.contractor AS contractor,
      SUM(i.quantity) AS qty, SUM(i.manpower) AS mp
    FROM installations i
    ${whereSql}
    GROUP BY i.contractor, i.site_name ORDER BY qty DESC LIMIT 10
  `).bind(...params).all()

  const byPart = await c.env.DB.prepare(`
    SELECT i.part AS name, SUM(i.quantity) AS qty, SUM(i.manpower) AS mp
    FROM installations i
    ${whereSql}
    GROUP BY i.part ORDER BY qty DESC
  `).bind(...params).all()

  // 人員別: 1取付の数量・人工を作業員数で按分
  const byWorkerSql = `
    SELECT w.worker_name AS name,
      SUM(i.quantity * 1.0 / wc.cnt) AS qty,
      SUM(i.manpower * 1.0 / wc.cnt) AS mp
    FROM installations i
    JOIN installation_workers w ON w.installation_id = i.id
    JOIN (SELECT installation_id, COUNT(*) AS cnt FROM installation_workers GROUP BY installation_id) wc
      ON wc.installation_id = i.id
    ${whereSql}
    GROUP BY w.worker_name ORDER BY qty DESC LIMIT 20
  `
  const byWorker = await c.env.DB.prepare(byWorkerSql).bind(...params).all()

  return c.json({
    total: totalRow,
    byContractor: byContractor.results,
    bySite: bySite.results,
    byPart: byPart.results,
    byWorker: byWorker.results,
  })
})

// 現場別サマリ
api.get('/analytics/sites', async (c) => {
  const q = c.req.query()
  const { whereSql, params } = buildFilter(q)
  const { results } = await c.env.DB.prepare(`
    SELECT i.contractor, i.site_name,
      COUNT(DISTINCT i.work_date) AS work_days,
      SUM(i.quantity) AS total_qty,
      SUM(i.manpower) AS total_mp
    FROM installations i
    ${whereSql}
    GROUP BY i.contractor, i.site_name
    ORDER BY total_qty DESC
  `).bind(...params).all()
  return c.json(results)
})

export default api
