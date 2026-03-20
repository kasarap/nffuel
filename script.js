// Fuel Inventory — V2
// Changes: National Foam brand theme (#E8003D), default drum capacity 55 gal

window.__appLoaded = true;

const FUEL_TYPES = ['IPA','Heptane','Hexane','87','Jet A','Ethanol','Diesel','Kerosene'];
const STATUS_LABELS = { 'in-use': 'In Use', empty: 'Empty', full: 'Full', reserved: 'Reserved' };

const els = {
  projectLabel:   document.getElementById('projectLabel'),
  btnSetProject:  document.getElementById('btnSetProject'),
  btnExportCsv:   document.getElementById('btnExportCsv'),

  newContainer:   document.getElementById('newContainer'),
  newFuelType:    document.getElementById('newFuelType'),
  newDrumLabel:   document.getElementById('newDrumLabel'),
  newCapacity:    document.getElementById('newCapacity'),
  newLevel:       document.getElementById('newLevel'),
  newStatus:      document.getElementById('newStatus'),
  newNotes:       document.getElementById('newNotes'),

  btnAddDrum:     document.getElementById('btnAddDrum'),
  btnUpdateDrum:  document.getElementById('btnUpdateDrum'),
  btnCancelEdit:  document.getElementById('btnCancelEdit'),
  btnClearForm:   document.getElementById('btnClearForm'),

  statusBar:      document.getElementById('statusBar'),
  status:         document.getElementById('status'),
  emptyTally:     document.getElementById('emptyTally'),
  inventoryRoot:  document.getElementById('inventoryRoot'),

  syncDialog:     document.getElementById('syncDialog'),
  syncNameInput:  document.getElementById('syncNameInput'),
  syncSave:       document.getElementById('syncSave'),
  syncCancel:     document.getElementById('syncCancel'),
};

let project = localStorage.getItem('fuel_project') || '';
let drums = [];
let editingId = null;
let pendingAction = null;

// ── Utilities ──────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.statusBar.dataset.error = isError ? '1' : '0';
}

function sanitizeProject(s) {
  if (!s) return '';
  return String(s).trim().replace(/\s+/g, ' ').slice(0, 80).replace(/[^\w .\-]/g, '');
}

function safeNum(v) {
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return isNaN(n) ? null : n;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fuelClass(fuel) {
  const map = {
    'IPA': 'fuel-IPA', 'Heptane': 'fuel-Heptane', 'Hexane': 'fuel-Hexane',
    '87': 'fuel-87', 'Jet A': 'fuel-JetA', 'Ethanol': 'fuel-Ethanol',
    'Diesel': 'fuel-Diesel', 'Kerosene': 'fuel-Kerosene',
  };
  return map[fuel] || 'fuel-IPA';
}

function levelClass(pct) {
  if (pct <= 20) return 'low';
  if (pct <= 50) return 'mid';
  return 'high';
}

// ── Project / Sync Name ────────────────────────────────────────────────────

function renderProject() {
  els.projectLabel.textContent = project || 'Not set';
}

function openSyncDialog() {
  els.syncNameInput.value = project || '';
  els.syncDialog.showModal();
  setTimeout(() => els.syncNameInput.focus(), 80);
}

function closeSyncDialog() {
  if (els.syncDialog.open) els.syncDialog.close();
}

function ensureProject(action = null) {
  if (project) return true;
  pendingAction = action;
  openSyncDialog();
  setStatus('Set a Sync Name first.', true);
  return false;
}

els.btnSetProject.addEventListener('click', openSyncDialog);

els.syncSave.addEventListener('click', async () => {
  const p = sanitizeProject(els.syncNameInput.value || '');
  if (!p) return setStatus('Sync Name is required.', true);
  project = p;
  localStorage.setItem('fuel_project', project);
  renderProject();
  closeSyncDialog();

  const action = pendingAction;
  pendingAction = null;

  if (action === 'add') { await doAddDrum(); return; }
  if (action === 'export') { await doExport(); return; }
  clearForm();
  await refresh();
  setStatus('Sync Name set.');
});

els.syncCancel.addEventListener('click', () => {
  pendingAction = null;
  closeSyncDialog();
});

// Close dialog on backdrop click (iOS-friendly)
els.syncDialog.addEventListener('click', e => {
  const rect = els.syncDialog.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top  || e.clientY > rect.bottom) {
    pendingAction = null;
    closeSyncDialog();
  }
});

// ── API ────────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error || data?.message || (typeof data?.raw === 'string' ? data.raw.slice(0, 200) : 'Request failed');
    throw new Error(`${msg} (HTTP ${res.status})`);
  }
  return data;
}

// ── Form Helpers ───────────────────────────────────────────────────────────

function getFormData() {
  return {
    container: (els.newContainer.value || '').trim() || 'Default',
    fuelType: els.newFuelType.value || '',
    label: (els.newDrumLabel.value || '').trim(),
    capacity: safeNum(els.newCapacity.value),
    level: safeNum(els.newLevel.value) ?? 0,
    status: els.newStatus.value || 'in-use',
    notes: (els.newNotes.value || '').trim(),
  };
}

function setFormData(d) {
  els.newContainer.value  = d?.container || '';
  els.newFuelType.value   = d?.fuelType  || '';
  els.newDrumLabel.value  = d?.label     || '';
  els.newCapacity.value   = d?.capacity != null ? String(d.capacity) : '';
  els.newLevel.value      = d?.level != null    ? String(d.level)    : '';
  els.newStatus.value     = d?.status    || 'in-use';
  els.newNotes.value      = d?.notes     || '';
}

function clearForm() {
  setFormData({});
  els.newStatus.value    = 'in-use';
  els.newCapacity.value  = '55';   // default 55 gal drums
  editingId = null;
  els.btnAddDrum.style.display    = '';
  els.btnUpdateDrum.style.display = 'none';
  els.btnCancelEdit.style.display = 'none';
  document.querySelectorAll('.drumCard.editing').forEach(c => c.classList.remove('editing'));
}

els.btnClearForm.addEventListener('click', () => { clearForm(); setStatus('Cleared.'); });

// ── Refresh / Render ───────────────────────────────────────────────────────

async function refresh() {
  if (!project) { drums = []; renderInventory(); return; }
  try {
    const data = await api(`/api/fuel?project=${encodeURIComponent(project)}`);
    drums = Array.isArray(data.drums) ? data.drums : [];
    renderInventory();
  } catch (e) {
    setStatus(e.message, true);
    throw e;
  }
}

function renderInventory() {
  const root = els.inventoryRoot;
  root.innerHTML = '';

  const emptyCount = drums.filter(d => d.status === 'empty').length;
  els.emptyTally.textContent = emptyCount > 0 ? `${emptyCount} empty drum${emptyCount === 1 ? '' : 's'}` : '';

  if (drums.length === 0) {
    root.innerHTML = `<div class="emptyState"><h3>No drums yet</h3><p>Add your first drum using the form above.</p></div>`;
    return;
  }

  // Group by container
  const groups = {};
  for (const d of drums) {
    const key = d.container || 'Default';
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  }

  // Sort containers alphabetically
  const sortedKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  for (const key of sortedKeys) {
    const grpDrums = groups[key];
    const groupEl = document.createElement('div');
    groupEl.className = 'containerGroup';

    const hdr = document.createElement('div');
    hdr.className = 'containerHeader';
    hdr.innerHTML = `
      <span class="containerName">${escapeHtml(key)}</span>
      <span class="containerLine"></span>
      <span class="containerCount">${grpDrums.length} drum${grpDrums.length === 1 ? '' : 's'}</span>
    `;
    groupEl.appendChild(hdr);

    const grid = document.createElement('div');
    grid.className = 'drumGrid';

    for (const drum of grpDrums) {
      grid.appendChild(makeDrumCard(drum));
    }

    groupEl.appendChild(grid);
    root.appendChild(groupEl);
  }
}

function makeDrumCard(drum) {
  const cap = drum.capacity;
  const lvl = drum.level ?? 0;
  const pct = (cap && cap > 0) ? Math.min(100, Math.round((lvl / cap) * 100)) : 0;
  const capStr = cap != null ? `${cap} gal` : '— gal';
  const lvlStr = `${lvl} gal`;
  const lcls = levelClass(pct);
  const fcls = fuelClass(drum.fuelType);
  const statusLabel = STATUS_LABELS[drum.status] || drum.status;

  const card = document.createElement('div');
  card.className = 'drumCard';
  card.dataset.id = drum.id;
  card.dataset.status = drum.status || 'in-use';

  card.innerHTML = `
    <div class="drumTop">
      <div class="drumLabel">${escapeHtml(drum.label || 'Drum')}</div>
      <span class="drumFuelBadge ${fcls}">${escapeHtml(drum.fuelType || '—')}</span>
    </div>
    <div class="levelWrap">
      <div class="levelLabel">
        <span>${lvlStr}</span>
        <span>${cap != null ? pct + '%' : '—'}</span>
        <span>${capStr}</span>
      </div>
      <div class="levelBar"><div class="levelFill ${lcls}" style="width:${pct}%"></div></div>
    </div>
    <div>
      <span class="statusBadge status-${drum.status || 'in-use'}">${escapeHtml(statusLabel)}</span>
    </div>
    ${drum.notes ? `<div class="drumNotes" title="${escapeHtml(drum.notes)}">${escapeHtml(drum.notes)}</div>` : ''}
    <div class="drumActions">
      <button class="btn ghost" data-act="edit" type="button">Edit</button>
      <button class="btn danger ghost" data-act="delete" type="button">Delete</button>
    </div>
  `;

  if (editingId === drum.id) card.classList.add('editing');

  card.querySelector('[data-act="edit"]').addEventListener('click', () => loadDrumForEdit(drum));
  card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteDrum(drum.id, drum.label));

  return card;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

function loadDrumForEdit(drum) {
  setFormData(drum);
  editingId = drum.id;
  els.btnAddDrum.style.display    = 'none';
  els.btnUpdateDrum.style.display = '';
  els.btnCancelEdit.style.display = '';
  renderInventory(); // re-render to show editing highlight
  els.newContainer.focus();
  setStatus('Editing drum — make changes and click Save Edit.');
}

async function doAddDrum() {
  const d = getFormData();
  if (!d.fuelType) return setStatus('Select a fuel type.', true);
  if (!d.label) return setStatus('Enter a drum label.', true);

  try {
    setStatus('Saving…');
    await api(`/api/fuel?project=${encodeURIComponent(project)}`, {
      method: 'POST',
      body: JSON.stringify({ drum: d }),
    });
    await refresh();
    clearForm();
    setStatus('Drum added.');
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function doUpdateDrum() {
  if (!editingId) return;
  const d = getFormData();
  if (!d.fuelType) return setStatus('Select a fuel type.', true);
  if (!d.label) return setStatus('Enter a drum label.', true);

  try {
    setStatus('Updating…');
    await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(editingId)}`, {
      method: 'PUT',
      body: JSON.stringify({ drum: d }),
    });
    await refresh();
    clearForm();
    setStatus('Drum updated.');
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function deleteDrum(id, label) {
  const ok = confirm(`Delete drum "${label || id}"?`);
  if (!ok) return;
  try {
    setStatus('Deleting…');
    await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (editingId === id) clearForm();
    await refresh();
    setStatus('Drum deleted.');
  } catch (e) {
    setStatus(e.message, true);
  }
}

els.btnAddDrum.addEventListener('click', () => {
  if (!ensureProject('add')) return;
  doAddDrum();
});

els.btnUpdateDrum.addEventListener('click', () => {
  if (!ensureProject()) return;
  doUpdateDrum();
});

els.btnCancelEdit.addEventListener('click', () => { clearForm(); setStatus('Edit cancelled.'); });

// ── Export CSV ─────────────────────────────────────────────────────────────

function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

async function doExport() {
  if (!ensureProject('export')) return;
  try {
    setStatus('Exporting…');
    const data = await api(`/api/fuel/export?project=${encodeURIComponent(project)}`);
    const rows = Array.isArray(data.drums) ? data.drums : [];

    const headers = ['Container','Label','Fuel Type','Status','Level (gal)','Capacity (gal)','% Full','Notes'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      const cap = r.capacity ?? '';
      const lvl = r.level ?? 0;
      const pct = (cap && cap > 0) ? Math.round((lvl / cap) * 100) : '';
      lines.push([r.container, r.label, r.fuelType, r.status, lvl, cap, pct, r.notes || ''].map(csvCell).join(','));
    }
    const csv = lines.join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fuel-inventory-${project.replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    setStatus('Exported CSV.');
  } catch (e) {
    setStatus(e.message, true);
  }
}

els.btnExportCsv.addEventListener('click', doExport);

// ── Error handling ─────────────────────────────────────────────────────────

window.addEventListener('error', e => { setStatus(`JS error: ${e.message || 'unknown'}`, true); });
window.addEventListener('unhandledrejection', e => { setStatus(`Error: ${String(e.reason || 'unknown')}`, true); });

// ── Startup ────────────────────────────────────────────────────────────────

(async () => {
  setStatus('Starting…');
  renderProject();

  let apiOk = true;
  try { await api('/api/ping'); }
  catch (e) { apiOk = false; setStatus(`API not reachable: ${e.message}`, true); }

  if (apiOk) {
    try {
      await refresh();
      if (els.statusBar.dataset.error !== '1') setStatus('Ready.');
    } catch (_) { /* error shown by refresh */ }
  }
})();
