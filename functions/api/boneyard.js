// Fuel Inventory — /api/boneyard — V13
// Stores total boneyard drum count per project: { quantity: number }

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.APP_KV;
  if (!kv) return json({ error: 'Missing KV binding APP_KV' }, 500);

  const url    = new URL(request.url);
  const method = request.method.toUpperCase();

  const project = sanitizeProject(url.searchParams.get('project'));
  if (!project) return json({ error: 'Missing or invalid project' }, 400);

  const key = `boneyard:${project}`;

  if (method === 'GET') {
    const data = await readData(kv, key);
    return json({ project, quantity: data.quantity });
  }

  if (method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body || body.quantity === undefined) return json({ error: 'Missing quantity' }, 400);
    const quantity = Math.max(0, parseInt(body.quantity, 10) || 0);
    await kv.put(key, JSON.stringify({ quantity }));
    return json({ ok: true, quantity });
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function readData(kv, key) {
  const raw = await kv.get(key, { type: 'json' });
  if (raw && typeof raw === 'object' && raw.quantity !== undefined) return raw;
  return { quantity: 0 };
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
