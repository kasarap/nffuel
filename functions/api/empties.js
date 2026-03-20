// Fuel Inventory — /api/empties — V9
// Stores log of emptied drums: {id, container, fuelType, count, emptiedAt}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.APP_KV;
  if (!kv) return json({ error: 'Missing KV binding APP_KV' }, 500);

  const url    = new URL(request.url);
  const method = request.method.toUpperCase();

  const project = sanitizeProject(url.searchParams.get('project'));
  if (!project) return json({ error: 'Missing or invalid project' }, 400);

  const key = `empties:${project}`;

  // GET — return all log entries newest first
  if (method === 'GET') {
    const data = await readLog(kv, key);
    data.entries.sort((a, b) => (b.emptiedAt || '').localeCompare(a.emptiedAt || ''));
    return json({ project, entries: data.entries });
  }

  // POST — add emptied drums, merging into existing row if same container+fuel
  if (method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body?.entry) return json({ error: 'Missing entry' }, 400);

    const container = safeStr(body.entry.container) || 'Default';
    const fuelType  = safeStr(body.entry.fuelType);
    const count     = Math.max(1, parseInt(body.entry.count, 10) || 1);

    const data = await readLog(kv, key);

    // Find existing entry for same container + fuel
    const existing = data.entries.find(e => e.container === container && e.fuelType === fuelType);

    if (existing) {
      existing.count     += count;
      existing.emptiedAt  = new Date().toISOString(); // update timestamp to latest
      await kv.put(key, JSON.stringify(data));
      return json({ ok: true, entry: existing });
    }

    const newEntry = {
      id:        crypto.randomUUID(),
      emptiedAt: new Date().toISOString(),
      container,
      fuelType,
      count,
    };
    data.entries.push(newEntry);
    await kv.put(key, JSON.stringify(data));
    return json({ ok: true, entry: newEntry });
  }

  // DELETE — remove a single log entry by id
  if (method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);
    const data   = await readLog(kv, key);
    const before = data.entries.length;
    data.entries = data.entries.filter(e => e.id !== id);
    if (data.entries.length === before) return json({ error: 'Not found' }, 404);
    await kv.put(key, JSON.stringify(data));
    return json({ ok: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function readLog(kv, key) {
  const raw = await kv.get(key, { type: 'json' });
  if (raw && typeof raw === 'object' && Array.isArray(raw.entries)) return raw;
  return { entries: [] };
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
