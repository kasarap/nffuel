// Fuel Inventory — /api/fuel — V13
// Stores flat rows: {id, container, fuelType, full, partial, empty}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.APP_KV;
  if (!kv) return json({ error: 'Missing KV binding APP_KV' }, 500);

  const url    = new URL(request.url);
  const method = request.method.toUpperCase();

  const project = sanitizeProject(url.searchParams.get('project'));
  if (!project) return json({ error: 'Missing or invalid project' }, 400);

  const key = `fuel:${project}`;

  if (method === 'GET') {
    const data = await readProject(kv, key);
    data.rows.sort((a, b) => {
      const ca = (a.container || '').toLowerCase();
      const cb = (b.container || '').toLowerCase();
      return ca !== cb ? ca.localeCompare(cb) : (a.fuelType || '').localeCompare(b.fuelType || '');
    });
    return json({ project, rows: data.rows });
  }

  if (method === 'POST') {
    const body = await request.json().catch(() => null);
    const row  = body?.row;
    if (!row) return json({ error: 'Missing row' }, 400);

    const data   = await readProject(kv, key);
    const now    = new Date().toISOString();
    const newRow = {
      id:        crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...normalizeRow(row),
    };

    data.rows.push(newRow);
    await kv.put(key, JSON.stringify(data));
    return json({ ok: true, row: newRow });
  }

  if (method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);

    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Missing body' }, 400);

    const data = await readProject(kv, key);
    const idx  = data.rows.findIndex(r => r.id === id);
    if (idx < 0) return json({ error: 'Not found' }, 404);

    const updated = { ...data.rows[idx] };
    if (body.full      !== undefined) updated.full      = Math.max(0, parseInt(body.full,    10) || 0);
    if (body.partial   !== undefined) updated.partial   = Math.max(0, parseInt(body.partial, 10) || 0);
    if (body.empty     !== undefined) updated.empty     = Math.max(0, parseInt(body.empty,   10) || 0);
    if (body.container !== undefined) updated.container = safeStr(body.container) || 'Default';
    if (body.row) Object.assign(updated, normalizeRow(body.row));
    updated.updatedAt = new Date().toISOString();

    data.rows[idx] = updated;
    await kv.put(key, JSON.stringify(data));
    return json({ ok: true, row: data.rows[idx] });
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);

    const data   = await readProject(kv, key);
    const before = data.rows.length;
    data.rows    = data.rows.filter(r => r.id !== id);

    if (data.rows.length === before) return json({ error: 'Not found' }, 404);
    await kv.put(key, JSON.stringify(data));
    return json({ ok: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function readProject(kv, key) {
  const raw = await kv.get(key, { type: 'json' });
  if (raw && typeof raw === 'object' && Array.isArray(raw.rows)) return raw;
  return { rows: [] };
}

function normalizeRow(r) {
  return {
    container: safeStr(r.container) || 'Default',
    fuelType:  safeStr(r.fuelType),
    full:      Math.max(0, parseInt(r.full,    10) || 0),
    partial:   Math.max(0, parseInt(r.partial, 10) || 0),
    empty:     Math.max(0, parseInt(r.empty,   10) || 0),
  };
}

function safeStr(v) {
  if (v == null) return '';
  return String(v).trim().slice(0, 200);
}

function sanitizeProject(s) {
  if (!s) return '';
  const out = String(s).trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!out || out.length < 2) return '';
  return out.replace(/[^\w .\-]/g, '');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
