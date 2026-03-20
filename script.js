// Fuel Inventory — V3
// Container tables, one row per fuel type, Use button subtracts gallons,
// drum count decrements every 55 gal used. No drum label field.

const DRUM_GAL    = 55;
const FUEL_TYPES  = ['IPA','Heptane','Hexane','87','Jet A','Ethanol','Diesel','Kerosene'];

// Colour dots per fuel
const FUEL_COLORS = {
  'IPA':      '#60a5fa',
  'Heptane':  '#fbbf24',
  'Hexane':   '#c084fc',
  '87':       '#4ade80',
  'Jet A':    '#f87171',
  'Ethanol':  '#2dd4bf',
  'Diesel':   '#fb923c',
  'Kerosene': '#a5b4fc',
};

const els = {
  projectLabel:   document.getElementById('projectLabel'),
  btnSetProject:  document.getElementById('btnSetProject'),
  btnExportCsv:   document.getElementById('btnExportCsv'),
  newContainer:   document.getElementById('newContainer'),
  newFuelType:    document.getElementById('newFuelType'),
  newDrums:       document.getElementById('newDrums'),
  btnAddFuel:     document.getElementById('btnAddFuel'),
  btnClearForm:   document.getElementById('btnClearForm'),
  statusBar:      document.getElementById('statusBar'),
  status:         document.getElementById('status'),
  emptyTally:     document.getElementById('emptyTally'),
  inventoryRoot:  document.getElementById('inventoryRoot'),
  // use dialog
  useDialog:      document.getElementById('useDialog'),
  useDialogFuel:  document.getElementById('useDialogFuel'),
  useDialogCont:  document.getElementById('useDialogContainer'),
  useStatDrums:   document.getElementById('useStatDrums'),
  useStatGals:    document.getElementById('useStatGals'),
  useAmount:      document.getElementById('useAmount'),
  usePreview:     document.getElementById('usePreview'),
  useConfirmBtn:  document.getElementById('useConfirmBtn'),
  useCancelBtn:   document.getElementById('useCancelBtn'),
  useDialogClose: document.getElementById('useDialogClose'),
  // sync dialog
  syncDialog:     document.getElementById('syncDialog'),
  syncNameInput:  document.getElementById('syncNameInput'),
  syncSave:       document.getElementById('syncSave'),
  syncCancel:     document.getElementById('syncCancel'),
  // edit container dialog
  editDialog:        document.getElementById('editDialog'),
  editDialogTitle:   document.getElementById('editDialogTitle'),
  editDialogBody:    document.getElementById('editDialogBody'),
  editDialogClose:   document.getElementById('editDialogClose'),
  editSaveBtn:       document.getElementById('editSaveBtn'),
  editCancelBtn:     document.getElementById('editCancelBtn'),
  editAddFuelRow:    document.getElementById('editAddFuelRow'),
};

let project     = localStorage.getItem('fuel_project') || '';
let rows        = [];   // flat array of {id, container, fuelType, drums, gallons}
let pendingAction = null;

let useCtx  = null; // {id, container, fuelType, drums, gallons}
let editCtx = null; // container name being edited

// ── Helpers ───────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.statusBar.dataset.error = isError ? '1' : '0';
}

function sanitizeProject(s) {
  if (!s) return '';
  return String(s).trim().replace(/\s+/g, ' ').slice(0, 80).replace(/[^\w .\-]/g, '');
}

function escHtml(s) {
  return String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;');
}

function safeInt(v, fallback = 0) {
  const n = parseInt(String(v).replace(/\D/g,''), 10);
  return isNaN(n) ? fallback : n;
}

function safeFloat(v) {
  const n = parseFloat(String(v).replace(/[^\d.]/g,''));
  return isNaN(n) ? 0 : n;
}

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
    const msg = data?.error || data?.message || (typeof data?.raw === 'string' ? data.raw.slice(0,200) : 'Request failed');
    throw new Error(`${msg} (HTTP ${res.status})`);
  }
  return data;
}

// ── Sync / Project ─────────────────────────────────────────────────────────

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
  if (action === 'add') { await doAdd(); return; }
  if (action === 'export') { await doExport(); return; }
  clearForm();
  await refresh();
  setStatus('Sync Name set.');
});

els.syncCancel.addEventListener('click', () => { pendingAction = null; closeSyncDialog(); });

els.syncDialog.addEventListener('click', e => {
  const r = els.syncDialog.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
    pendingAction = null; closeSyncDialog();
  }
});

// ── Form ───────────────────────────────────────────────────────────────────

function clearForm() {
  els.newContainer.value = '';
  els.newFuelType.value  = '';
  els.newDrums.value     = '1';
}

els.btnClearForm.addEventListener('click', () => { clearForm(); setStatus('Cleared.'); });

// ── Add Fuel ───────────────────────────────────────────────────────────────

async function doAdd() {
  const container = (els.newContainer.value || '').trim() || 'Default';
  const fuelType  = els.newFuelType.value || '';
  const drums     = safeInt(els.newDrums.value, 1);

  if (!fuelType)   return setStatus('Select a fuel type.', true);
  if (drums < 1)   return setStatus('Enter at least 1 drum.', true);

  // Check if this container+fuel combo already exists — merge instead of duplicate
  const existing = rows.find(r => r.container === container && r.fuelType === fuelType);

  try {
    setStatus('Saving…');
    if (existing) {
      // Add to existing row
      const newDrums   = existing.drums + drums;
      const newGallons = existing.gallons + (drums * DRUM_GAL);
      await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(existing.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ drums: newDrums, gallons: newGallons }),
      });
    } else {
      await api(`/api/fuel?project=${encodeURIComponent(project)}`, {
        method: 'POST',
        body: JSON.stringify({ row: { container, fuelType, drums, gallons: drums * DRUM_GAL } }),
      });
    }
    await refresh();
    clearForm();
    setStatus(existing ? `Added ${drums} drum(s) to existing ${fuelType} in ${container}.` : `Added ${drums} drum(s) of ${fuelType} to ${container}.`);
  } catch (e) {
    setStatus(e.message, true);
  }
}

els.btnAddFuel.addEventListener('click', () => {
  if (!ensureProject('add')) return;
  doAdd();
});

// ── Refresh / Render ───────────────────────────────────────────────────────

async function refresh() {
  if (!project) { rows = []; renderInventory(); return; }
  try {
    const data = await api(`/api/fuel?project=${encodeURIComponent(project)}`);
    rows = Array.isArray(data.rows) ? data.rows : [];
    renderInventory();
  } catch (e) {
    setStatus(e.message, true);
    throw e;
  }
}

function renderInventory() {
  const root = els.inventoryRoot;
  root.innerHTML = '';

  const emptyCount = rows.filter(r => r.drums <= 0).length;
  els.emptyTally.textContent = emptyCount > 0
    ? `${emptyCount} fuel${emptyCount > 1 ? 's' : ''} depleted`
    : '';

  if (rows.length === 0) {
    root.innerHTML = `<div class="emptyState"><h3>No fuel inventory yet</h3><p>Add drums using the form above.</p></div>`;
    return;
  }

  // Group by container
  const groups = {};
  for (const r of rows) {
    const k = r.container || 'Default';
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }

  const sortedContainers = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  for (const cName of sortedContainers) {
    const cRows = groups[cName];
    cRows.sort((a, b) => FUEL_TYPES.indexOf(a.fuelType) - FUEL_TYPES.indexOf(b.fuelType));

    const totalDrums = cRows.reduce((s, r) => s + (r.drums || 0), 0);

    const block = document.createElement('div');
    block.className = 'containerBlock';

    // Container header
    const hdr = document.createElement('div');
    hdr.className = 'containerHeader';
    hdr.innerHTML = `
      <span class="containerName">${escHtml(cName)}</span>
      <span class="containerLine"></span>
      <span class="containerMeta">${totalDrums} drum${totalDrums !== 1 ? 's' : ''} · ${cRows.length} fuel${cRows.length !== 1 ? 's' : ''}</span>
      <button class="btn editContainerBtn" type="button">Edit</button>
    `;
    hdr.querySelector('.editContainerBtn').addEventListener('click', () => openEditDialog(cName, cRows));
    block.appendChild(hdr);

    // Table
    const wrap = document.createElement('div');
    wrap.className = 'tableWrap';

    const table = document.createElement('table');
    table.className = 'fuelTable';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Fuel Type</th>
          <th class="center">Drums</th>
          <th>Remaining</th>
          <th class="center">Status</th>
          <th class="center">Use</th>
          <th></th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement('tbody');

    for (const row of cRows) {
      const drums   = row.drums   || 0;
      const gallons = row.gallons || 0;
      const totalGalForBar = Math.max(row.drums, Math.ceil(gallons / DRUM_GAL)) * DRUM_GAL;
      const pct = totalGalForBar > 0 ? Math.min(100, Math.round((gallons / totalGalForBar) * 100)) : 0;

      let fillClass = 'high';
      if (pct <= 20) fillClass = 'low';
      else if (pct <= 50) fillClass = 'mid';

      let chipClass = 'chip-ok', chipLabel = 'OK';
      if (drums <= 0)    { chipClass = 'chip-empty'; chipLabel = 'Depleted'; }
      else if (drums <= 1 && pct <= 30) { chipClass = 'chip-low'; chipLabel = 'Low'; }

      const dotColor = FUEL_COLORS[row.fuelType] || '#888';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="fuelTypeName">
            <span class="fuelDot" style="background:${dotColor}"></span>
            <strong>${escHtml(row.fuelType)}</strong>
          </div>
        </td>
        <td class="center">
          <div class="drumCount">${drums}</div>
        </td>
        <td>
          <div class="galWrap">
            <div class="galPct">${pct}%</div>
            <div class="galBar"><div class="galFill ${fillClass}" style="width:${pct}%"></div></div>
          </div>
        </td>
        <td class="center">
          <span class="statusChip ${chipClass}">${chipLabel}</span>
        </td>
        <td class="center">
          <button class="btn useBtn" data-act="use" type="button"${drums <= 0 ? ' disabled' : ''}>Use</button>
        </td>
        <td class="center">
          <button class="deleteRowBtn" data-act="delete" type="button" title="Remove row">✕</button>
        </td>
      `;

      tr.querySelector('[data-act="use"]')?.addEventListener('click', () => openUseDialog(row));
      tr.querySelector('[data-act="delete"]')?.addEventListener('click', () => deleteRow(row.id, row.fuelType, cName));

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    block.appendChild(wrap);
    root.appendChild(block);
  }
}

// ── Delete Row ─────────────────────────────────────────────────────────────

async function deleteRow(id, fuelType, container) {
  const ok = confirm(`Remove ${fuelType} from ${container}?`);
  if (!ok) return;
  try {
    setStatus('Removing…');
    await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refresh();
    setStatus('Removed.');
  } catch (e) {
    setStatus(e.message, true);
  }
}

// ── Use Dialog ─────────────────────────────────────────────────────────────

function openUseDialog(row) {
  useCtx = { ...row };
  els.useDialogFuel.textContent = row.fuelType;
  els.useDialogCont.textContent = row.container;
  els.useStatDrums.textContent  = row.drums;
  const galStr = (row.gallons % 1 === 0) ? row.gallons : row.gallons.toFixed(1);
  els.useStatGals.textContent   = galStr;
  els.useAmount.value           = '';
  els.usePreview.textContent    = '';
  els.usePreview.className      = 'usePreview';
  els.useDialog.showModal();
  setTimeout(() => els.useAmount.focus(), 80);
}

function closeUseDialog() {
  if (els.useDialog.open) els.useDialog.close();
  useCtx = null;
}

function updateUsePreview() {
  if (!useCtx) return;
  const used = safeFloat(els.useAmount.value);
  if (!used || used <= 0) { els.usePreview.textContent = ''; els.usePreview.className = 'usePreview'; return; }

  const newGallons  = Math.max(0, useCtx.gallons - used);
  const drumsUsed   = Math.floor((useCtx.gallons - newGallons) / DRUM_GAL +
                       (useCtx.gallons % DRUM_GAL < (useCtx.gallons - newGallons) % DRUM_GAL ? 0 : 0));
  // How many full drums are consumed by this subtraction
  const oldFullDrums = Math.ceil(useCtx.gallons / DRUM_GAL);
  const newFullDrums = Math.ceil(newGallons / DRUM_GAL);
  const drumDelta    = oldFullDrums - newFullDrums;

  let msg = `→ ${newGallons % 1 === 0 ? newGallons : newGallons.toFixed(1)} gal remaining`;
  if (drumDelta > 0) msg += `, ${drumDelta} drum${drumDelta > 1 ? 's' : ''} emptied`;

  const newDrums = Math.max(0, useCtx.drums - drumDelta);

  if (used > useCtx.gallons) {
    els.usePreview.textContent = `⚠ Exceeds available gallons (${useCtx.gallons} gal)`;
    els.usePreview.className   = 'usePreview danger';
  } else {
    els.usePreview.textContent = msg;
    els.usePreview.className   = newDrums === 0 ? 'usePreview warn' : 'usePreview';
  }
}

els.useAmount.addEventListener('input', updateUsePreview);

els.useConfirmBtn.addEventListener('click', async () => {
  if (!useCtx) return;
  const used = safeFloat(els.useAmount.value);
  if (!used || used <= 0) return setStatus('Enter gallons used.', true);
  if (used > useCtx.gallons) return setStatus(`Only ${useCtx.gallons} gal available.`, true);

  // Snapshot everything we need BEFORE closing (closeUseDialog nulls useCtx)
  const snap = { ...useCtx };

  const newGallons   = Math.max(0, Math.round((snap.gallons - used) * 100) / 100);
  const oldFullDrums = Math.ceil(snap.gallons / DRUM_GAL);
  const newFullDrums = newGallons > 0 ? Math.ceil(newGallons / DRUM_GAL) : 0;
  const drumDelta    = oldFullDrums - newFullDrums;
  const newDrums     = Math.max(0, snap.drums - drumDelta);

  closeUseDialog();

  try {
    setStatus('Updating…');
    await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(snap.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ drums: newDrums, gallons: newGallons }),
    });
    await refresh();
    const drumMsg = drumDelta > 0 ? ` (${drumDelta} drum${drumDelta > 1 ? 's' : ''} emptied)` : '';
    setStatus(`Subtracted ${used} gal from ${snap.fuelType}${drumMsg}.`);
  } catch (e) {
    setStatus(e.message, true);
  }
});

els.useCancelBtn.addEventListener('click', closeUseDialog);
els.useDialogClose.addEventListener('click', closeUseDialog);

els.useDialog.addEventListener('click', e => {
  const r = els.useDialog.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeUseDialog();
});

// Confirm on Enter key in amount field
els.useAmount.addEventListener('keydown', e => {
  if (e.key === 'Enter') els.useConfirmBtn.click();
});

// ── Edit Container Dialog ──────────────────────────────────────────────────

function openEditDialog(containerName, cRows) {
  editCtx = containerName;
  els.editDialogTitle.textContent = containerName;

  // Build editable rows
  renderEditBody(cRows);
  els.editDialog.showModal();
}

function renderEditBody(cRows) {
  const body = els.editDialogBody;
  body.innerHTML = '';

  for (const row of cRows) {
    const div = document.createElement('div');
    div.className = 'editRow';
    div.dataset.id = row.id;

    const dotColor = FUEL_COLORS[row.fuelType] || '#888';
    div.innerHTML = `
      <div class="editRowFuel">
        <span class="fuelDot" style="background:${dotColor}"></span>
        <span class="editFuelName">${escHtml(row.fuelType)}</span>
      </div>
      <div class="editField">
        <label class="lbl">Drums</label>
        <input class="editDrums" type="text" inputmode="numeric" value="${row.drums}" />
      </div>
      <div class="editField">
        <label class="lbl">Gallons</label>
        <input class="editGallons" type="text" inputmode="decimal" value="${row.gallons}" />
      </div>
      <button class="deleteRowBtn editDeleteBtn" type="button" title="Remove">✕</button>
    `;

    div.querySelector('.editDeleteBtn').addEventListener('click', async () => {
      const ok = confirm(`Remove ${row.fuelType} from ${editCtx}?`);
      if (!ok) return;
      try {
        setStatus('Removing…');
        await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        await refresh();
        // Re-open dialog with updated rows for this container (if any remain)
        const remaining = rows.filter(r => r.container === editCtx);
        if (remaining.length > 0) {
          renderEditBody(remaining);
        } else {
          closeEditDialog();
        }
        setStatus(`Removed ${row.fuelType} from ${editCtx}.`);
      } catch (e) {
        setStatus(e.message, true);
      }
    });

    body.appendChild(div);
  }

  // "Add fuel to this container" row
  const addDiv = document.createElement('div');
  addDiv.className = 'editAddRow';
  addDiv.id = 'editAddFuelRow';
  addDiv.innerHTML = `
    <div class="editField" style="flex:2">
      <label class="lbl">Add Fuel Type</label>
      <select id="editNewFuelType">
        <option value="" disabled selected>Select fuel</option>
        ${FUEL_TYPES.map(f => `<option value="${f}">${f}</option>`).join('')}
      </select>
    </div>
    <div class="editField">
      <label class="lbl">Drums</label>
      <input id="editNewDrums" type="text" inputmode="numeric" placeholder="1" value="1" />
    </div>
    <button id="editAddRowBtn" class="btn primary" type="button" style="align-self:end">+ Add</button>
  `;

  addDiv.querySelector('#editAddRowBtn').addEventListener('click', async () => {
    const fuelType = addDiv.querySelector('#editNewFuelType').value;
    const drums    = safeInt(addDiv.querySelector('#editNewDrums').value, 1);
    if (!fuelType) return setStatus('Select a fuel type.', true);

    // Check if already exists in this container
    const existing = rows.find(r => r.container === editCtx && r.fuelType === fuelType);
    try {
      setStatus('Adding…');
      if (existing) {
        const newDrums   = existing.drums + drums;
        const newGallons = existing.gallons + (drums * DRUM_GAL);
        await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(existing.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ drums: newDrums, gallons: newGallons }),
        });
      } else {
        await api(`/api/fuel?project=${encodeURIComponent(project)}`, {
          method: 'POST',
          body: JSON.stringify({ row: { container: editCtx, fuelType, drums, gallons: drums * DRUM_GAL } }),
        });
      }
      await refresh();
      const updated = rows.filter(r => r.container === editCtx);
      renderEditBody(updated);
      setStatus(`Added ${drums} drum(s) of ${fuelType} to ${editCtx}.`);
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  body.appendChild(addDiv);
}

async function saveEditDialog() {
  const body    = els.editDialogBody;
  const editRows = [...body.querySelectorAll('.editRow')];

  const updates = [];
  for (const div of editRows) {
    const id      = div.dataset.id;
    const drums   = safeInt(div.querySelector('.editDrums').value, 0);
    const gallons = safeFloat(div.querySelector('.editGallons').value);
    updates.push({ id, drums, gallons });
  }

  try {
    setStatus('Saving…');
    await Promise.all(updates.map(u =>
      api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(u.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ drums: u.drums, gallons: u.gallons }),
      })
    ));
    closeEditDialog();
    await refresh();
    setStatus(`${editCtx} updated.`);
  } catch (e) {
    setStatus(e.message, true);
  }
}

function closeEditDialog() {
  if (els.editDialog.open) els.editDialog.close();
  editCtx = null;
}

els.editSaveBtn.addEventListener('click', saveEditDialog);
els.editCancelBtn.addEventListener('click', closeEditDialog);
els.editDialogClose.addEventListener('click', closeEditDialog);

els.editDialog.addEventListener('click', e => {
  const r = els.editDialog.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeEditDialog();
});

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
    const exportRows = Array.isArray(data.rows) ? data.rows : [];

    const headers = ['Container', 'Fuel Type', 'Drums', 'Gallons Remaining'];
    const lines   = [headers.join(',')];
    for (const r of exportRows) {
      lines.push([r.container, r.fuelType, r.drums, r.gallons].map(csvCell).join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `fuel-inventory-${project.replace(/\s+/g,'_')}.csv`;
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

// ── Error Handling ─────────────────────────────────────────────────────────

window.addEventListener('error', e => setStatus(`JS error: ${e.message || 'unknown'}`, true));
window.addEventListener('unhandledrejection', e => setStatus(`Error: ${String(e.reason || 'unknown')}`, true));

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
    } catch (_) {}
  }
})();
