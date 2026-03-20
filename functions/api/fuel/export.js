// Fuel Inventory — /api/fuel/export — V1
// GET all drums for CSV export

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.APP_KV;
  if (!kv) return json({ error: 'Missing KV binding APP_KV' }, 500);

  if (request.method.toUpperCase() !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const projectRaw = url.searchParams.get('project');
  const project = sanitizeProject(projectRaw);
  if (!project) return json({ error: 'Missing or invalid project' }, 400);

  const key = `fuel:${project}`;
  const raw = await kv.get(key, { type: 'json' });
  const data = (raw && typeof raw === 'object' && Array.isArray(raw.drums))
    ? raw : { drums: [] };

  data.drums.sort((a, b) => {
    const ca = (a.container || '').toLowerCase();
    const cb = (b.container || '').toLowerCase();
    if (ca !== cb) return ca.localeCompare(cb);
    return (a.label || '').localeCompare(b.label || '');
  });

  return json({ project, exportedAt: new Date().toISOString(), drums: data.drums });
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
