// Fuel Inventory — /api/fuel — V1
// Cloudflare Pages Function — KV binding: APP_KV

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.APP_KV;
  if (!kv) return json({ error: 'Missing KV binding APP_KV' }, 500);

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  const projectRaw = url.searchParams.get('project');
  const project = sanitizeProject(projectRaw);
  if (!project) return json({ error: 'Missing or invalid project' }, 400);

  const key = `fuel:${project}`;

  if (method === 'GET') {
    const data = await readProject(kv, key);
    data.drums.sort((a, b) => {
      const ca = (a.container || '').toLowerCase();
      const cb = (b.container || '').toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb);
      return (a.label || '').localeCompare(b.label || '');
    });
    return json({ project, drums: data.drums });
  }

  if (method === 'POST') {
    const body = await request.json().catch(() => null);
    const drum = body?.drum;
    if (!drum) return json({ error: 'Missing drum' }, 400);

    const data = await readProject(kv, key);
    const now = new Date().toISOString();

    const newDrum = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...normalizeDrum(drum),
    };

    data.drums.push(newDrum);
    await kv.put(key, JSON.stringify(data));
    return json({ ok: true, drum: newDrum });
  }

  if (method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);

    const body = await request.json().catch(() => null);
    const drum = body?.drum;
    if (!drum) return json({ error: 'Missing drum' }, 400);

    const data = await readProject(kv, key);
    const idx = data.drums.findIndex(d => d.id === id);
    if (idx < 0) return json({ error: 'Not found' }, 404);

    data.drums[idx] = {
      ...data.drums[idx],
      ...normalizeDrum(drum),
      updatedAt: new Date().toISOString(),
    };

    await kv.put(key, JSON.stringify(data));
    return json({ ok: true, drum: data.drums[idx] });
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);

    const data = await readProject(kv, key);
    const before = data.drums.length;
    data.drums = data.drums.filter(d => d.id !== id);

    if (data.drums.length === before) return json({ error: 'Not found' }, 404);

    await kv.put(key, JSON.stringify(data));
    return json({ ok: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function readProject(kv, key) {
  const raw = await kv.get(key, { type: 'json' });
  if (raw && typeof raw === 'object' && Array.isArray(raw.drums)) return raw;
  return { drums: [] };
}

function normalizeDrum(d) {
  const cap = parseNum(d.capacity);
  const lvl = parseNum(d.level);
  return {
    container: safeStr(d.container) || 'Default',
    label:     safeStr(d.label),
    fuelType:  safeStr(d.fuelType),
    status:    safeStatus(d.status),
    capacity:  cap,
    level:     lvl ?? 0,
    notes:     safeStr(d.notes),
  };
}

function safeStr(v) {
  if (v == null) return '';
  return String(v).trim().slice(0, 200);
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function safeStatus(v) {
  const allowed = ['in-use', 'empty', 'full', 'reserved'];
  const s = safeStr(v).toLowerCase();
  return allowed.includes(s) ? s : 'in-use';
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
