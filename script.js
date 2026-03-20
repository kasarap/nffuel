// Fuel Inventory — V10

const DRUM_GAL = 55;

const DEFAULT_FUEL_TYPES = ['IPA','Heptane','Hexane','87','Jet A','Ethanol','Diesel','Kerosene'];

function loadFuelTypes() {
  try {
    const stored = localStorage.getItem('fuel_types');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return [...DEFAULT_FUEL_TYPES];
}

function saveFuelTypes(list) {
  localStorage.setItem('fuel_types', JSON.stringify(list));
}

let FUEL_TYPES = loadFuelTypes();

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

// Generate a stable colour for custom fuel types not in the map
const EXTRA_COLORS = ['#f472b6','#34d399','#818cf8','#facc15','#38bdf8','#a78bfa','#fb923c','#4ade80'];
function fuelColor(name) {
  if (FUEL_COLORS[name]) return FUEL_COLORS[name];
  // Hash name to a colour index
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return EXTRA_COLORS[Math.abs(h) % EXTRA_COLORS.length];
}

const els = {
  projectLabel:   document.getElementById('projectLabel'),
  btnSetProject:  document.getElementById('btnSetProject'),
  btnExportCsv:   document.getElementById('btnExportCsv'),
  btnAddContainer:   document.getElementById('btnAddContainer'),
  btnManageFuels:    document.getElementById('btnManageFuels'),
  statusBar:      document.getElementById('statusBar'),
  status:         document.getElementById('status'),
  emptyTally:     document.getElementById('emptyTally'),
  inventoryRoot:  document.getElementById('inventoryRoot'),
  emptiesRoot:    document.getElementById('emptiesRoot'),
  // add dialog
  addDialog:      document.getElementById('addDialog'),
  addDialogClose: document.getElementById('addDialogClose'),
  addCancelBtn:   document.getElementById('addCancelBtn'),
  addConfirmBtn:  document.getElementById('addConfirmBtn'),
  newContainer:   document.getElementById('newContainer'),
  newFuelType:    document.getElementById('newFuelType'),
  newDrums:       document.getElementById('newDrums'),
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
  // manage fuel types dialog
  fuelDialog:        document.getElementById('fuelDialog'),
  fuelDialogClose:   document.getElementById('fuelDialogClose'),
  fuelDialogList:    document.getElementById('fuelDialogList'),
  fuelNewInput:      document.getElementById('fuelNewInput'),
  fuelAddBtn:        document.getElementById('fuelAddBtn'),
  fuelDoneBtn:       document.getElementById('fuelDoneBtn'),
  // salt pail
  saltPailRoot:        document.getElementById('saltPailRoot'),
  saltPailDialog:      document.getElementById('saltPailDialog'),
  saltPailDialogClose: document.getElementById('saltPailDialogClose'),
  saltPailInput:       document.getElementById('saltPailInput'),
  saltPailCancelBtn:   document.getElementById('saltPailCancelBtn'),
  saltPailSaveBtn:     document.getElementById('saltPailSaveBtn'),
  // edit empty dialog
  editEmptyDialog:      document.getElementById('editEmptyDialog'),
  editEmptyDialogClose: document.getElementById('editEmptyDialogClose'),
  editEmptyDialogBody:  document.getElementById('editEmptyDialogBody'),
  editEmptySaveBtn:     document.getElementById('editEmptySaveBtn'),
  editEmptyCancelBtn:   document.getElementById('editEmptyCancelBtn'),
};

let project     = localStorage.getItem('fuel_project') || '';
let rows        = [];
let empties     = [];   // log of emptied drums [{id, container, fuelType, count, emptiedAt}]
let saltPailQty = 0;
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
  if (action === 'add') { openAddDialog(); return; }
  if (action === 'export') { await doExport(); return; }
  clearForm();
  await refresh();
  setStatus('Sync Name set.');
});

els.syncCancel.addEventListener('click', () => { pendingAction = null; closeSyncDialog(); });

els.syncDialog.addEventListener('click', e => {
  if (e.target === els.syncDialog) { pendingAction = null; closeSyncDialog(); }
});

// ── Add Dialog ─────────────────────────────────────────────────────────────

function openAddDialog() {
  els.newContainer.value = '';
  els.newDrums.value     = '1';
  buildFuelOptions(els.newFuelType);
  els.addDialog.showModal();
  setTimeout(() => els.newContainer.focus(), 80);
}

function closeAddDialog() {
  if (els.addDialog.open) els.addDialog.close();
}

els.btnAddContainer.addEventListener('click', () => {
  if (!ensureProject('add')) return;
  openAddDialog();
});

els.addDialogClose.addEventListener('click', closeAddDialog);
els.addCancelBtn.addEventListener('click', closeAddDialog);

els.addDialog.addEventListener('click', e => {
  if (e.target === els.addDialog) closeAddDialog();
});

els.addConfirmBtn.addEventListener('click', async () => {
  if (!ensureProject('add')) return;
  await doAdd();
});

els.newDrums.addEventListener('keydown', e => { if (e.key === 'Enter') els.addConfirmBtn.click(); });

// ── Add Fuel ───────────────────────────────────────────────────────────────

async function doAdd() {
  const container = (els.newContainer.value || '').trim() || 'Default';
  const fuelType  = els.newFuelType.value || '';
  const drums     = safeInt(els.newDrums.value, 1);

  if (!fuelType) return setStatus('Select a fuel type.', true);
  if (drums < 1) return setStatus('Enter at least 1 drum.', true);

  const existing = rows.find(r => r.container === container && r.fuelType === fuelType);

  try {
    closeAddDialog();
    setStatus('Saving…');
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
        body: JSON.stringify({ row: { container, fuelType, drums, gallons: drums * DRUM_GAL } }),
      });
    }
    await refresh();
    setStatus(existing
      ? `Added ${drums} drum(s) to ${fuelType} in ${container}.`
      : `Added ${drums} drum(s) of ${fuelType} to ${container}.`);
  } catch (e) {
    setStatus(e.message, true);
  }
}

// ── Refresh / Render ───────────────────────────────────────────────────────

async function refresh() {
  if (!project) { rows = []; empties = []; saltPailQty = 0; renderInventory(); renderSaltPails(); renderEmpties(); return; }
  try {
    const fuelData = await api(`/api/fuel?project=${encodeURIComponent(project)}`);
    rows = Array.isArray(fuelData.rows) ? fuelData.rows : [];
  } catch (e) {
    setStatus(e.message, true);
    throw e;
  }
  // Empties endpoint may not exist on older deployments — fail silently
  try {
    const emptyData = await api(`/api/empties?project=${encodeURIComponent(project)}`);
    empties = Array.isArray(emptyData.entries) ? emptyData.entries : [];
  } catch (_) {
    empties = [];
  }
  // Salt pails — fail silently on older deployments
  try {
    const spData = await api(`/api/saltpails?project=${encodeURIComponent(project)}`);
    saltPailQty = typeof spData.quantity === 'number' ? spData.quantity : 0;
  } catch (_) {
    saltPailQty = 0;
  }
  renderInventory();
  renderSaltPails();
  renderEmpties();
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
    cRows.sort((a, b) => (a.fuelType || '').localeCompare(b.fuelType || ''));

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
          <th class="center">Use</th>
          <th class="center">Status</th>
          <th></th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement('tbody');

    for (const row of cRows) {
      const drums   = row.drums   || 0;
      const gallons = row.gallons || 0;

      // Total capacity = original full drums (use max of current drums and drums implied by gallons)
      const totalDrums    = Math.max(drums, Math.ceil(gallons / DRUM_GAL));
      const totalGalForBar = totalDrums * DRUM_GAL;
      const pct = totalGalForBar > 0 ? Math.min(100, (gallons / totalGalForBar) * 100) : 0;

      let fillClass = 'high';
      if (pct <= 20) fillClass = 'low';
      else if (pct <= 50) fillClass = 'mid';

      let chipClass = 'chip-ok', chipLabel = 'OK';
      if (drums <= 0)    { chipClass = 'chip-empty'; chipLabel = 'Depleted'; }
      else if (drums <= 1 && pct <= 30) { chipClass = 'chip-low'; chipLabel = 'Low'; }

      const dotColor = fuelColor(row.fuelType);
      const galStr   = gallons % 1 === 0 ? gallons : gallons.toFixed(1);

      // Build tick marks: one per drum boundary (at 1/n, 2/n … (n-1)/n of bar width)
      let ticksHtml = '';
      if (totalDrums > 1 && totalDrums <= 20) {
        for (let i = 1; i < totalDrums; i++) {
          const pos = (i / totalDrums) * 100;
          ticksHtml += `<div class="galTick" style="left:${pos}%"></div>`;
        }
      }

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
            <div class="galPct"><span>${galStr} gal</span><span>${Math.round(pct)}%</span></div>
            <div class="galBar">
              <div class="galFill ${fillClass}" style="width:${pct.toFixed(1)}%"></div>
              ${ticksHtml}
            </div>
          </div>
        </td>
        <td class="center">
          <button class="btn useBtn" data-act="use" type="button"${drums <= 0 ? ' disabled' : ''}>Use</button>
        </td>
        <td class="center">
          <span class="statusChip ${chipClass}">${chipLabel}</span>
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

    // Log emptied drums
    if (drumDelta > 0) {
      await api(`/api/empties?project=${encodeURIComponent(project)}`, {
        method: 'POST',
        body: JSON.stringify({ entry: {
          container: snap.container,
          fuelType:  snap.fuelType,
          count:     drumDelta,
        }}),
      });
    }

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
  if (e.target === els.useDialog) closeUseDialog();
});

// Confirm on Enter key in amount field
els.useAmount.addEventListener('keydown', e => {
  if (e.key === 'Enter') els.useConfirmBtn.click();
});

// ── Edit Container Dialog ──────────────────────────────────────────────────

function openEditDialog(containerName, cRows) {
  editCtx = containerName;
  els.editDialogTitle.value = containerName;

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

    const dotColor = fuelColor(row.fuelType);
    div.innerHTML = `
      <div class="editRowFuel">
        <span class="fuelDot" style="background:${dotColor}"></span>
        <span class="editFuelName">${escHtml(row.fuelType)}</span>
      </div>
      <div class="editField">
        <label class="lbl">Drums</label>
        <input class="editDrums" type="text" inputmode="numeric" value="${row.drums}" />
      </div>
      <div class="editRowNote">resets to full</div>
      <button class="deleteRowBtn editDeleteBtn" type="button" title="Remove">✕</button>
    `;

    div.querySelector('.editDeleteBtn').addEventListener('click', async () => {
      const ok = confirm(`Remove ${row.fuelType} from ${editCtx}?`);
      if (!ok) return;
      try {
        setStatus('Removing…');
        await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        await refresh();
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
        ${[...FUEL_TYPES].sort((a,b)=>a.localeCompare(b)).map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('')}
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
  // Snapshot ALL input values synchronously before any async work
  const newName  = (els.editDialogTitle.value || '').trim() || editCtx;
  const renamed  = newName !== editCtx;
  const body     = els.editDialogBody;
  const editRows = [...body.querySelectorAll('.editRow')];

  const updates = [];
  for (const div of editRows) {
    const id = String(div.dataset.id || '');
    const drumsInput = div.querySelector('.editDrums');
    const drums   = safeInt(drumsInput ? drumsInput.value : '0', 0);
    const gallons = drums * DRUM_GAL; // reset to full on drum count edit
    if (id) updates.push({ id, drums, gallons, ...(renamed ? { container: newName } : {}) });
  }

  // If renamed but no fuel rows exist yet, nothing to PUT — still fine
  try {
    setStatus('Saving…');
    for (const u of updates) {
      const payload = { drums: u.drums, gallons: u.gallons };
      if (u.container) payload.container = u.container;
      await api(`/api/fuel?project=${encodeURIComponent(project)}&id=${encodeURIComponent(u.id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }
    closeEditDialog();
    await refresh();
    setStatus(renamed ? `Renamed to "${newName}".` : `${newName} updated.`);
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

// Only close on click of the dialog backdrop itself (not its contents)
els.editDialog.addEventListener('click', e => {
  if (e.target === els.editDialog) closeEditDialog();
});

// ── Manage Fuel Types Dialog ───────────────────────────────────────────────

function buildFuelOptions(selectEl) {
  const sorted = [...FUEL_TYPES].sort((a, b) => a.localeCompare(b));
  selectEl.innerHTML = '<option value="" disabled selected>Select fuel</option>' +
    sorted.map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('');
}

function refreshAllFuelSelects() {
  // Re-populate every fuel dropdown currently in the DOM
  document.querySelectorAll('#newFuelType, #editNewFuelType').forEach(sel => {
    const cur = sel.value;
    buildFuelOptions(sel);
    if (FUEL_TYPES.includes(cur)) sel.value = cur;
  });
}

function renderFuelDialogList() {
  const list = els.fuelDialogList;
  list.innerHTML = '';
  for (const fuel of FUEL_TYPES) {
    const row = document.createElement('div');
    row.className = 'fuelTypeRow';
    const dot = fuelColor(fuel);
    row.innerHTML = `
      <span class="fuelDot" style="background:${dot}"></span>
      <span class="fuelTypeName2">${escHtml(fuel)}</span>
      <button class="deleteRowBtn fuelRemoveBtn" data-fuel="${escHtml(fuel)}" type="button" title="Remove">✕</button>
    `;
    row.querySelector('.fuelRemoveBtn').addEventListener('click', () => {
      FUEL_TYPES = FUEL_TYPES.filter(f => f !== fuel);
      saveFuelTypes(FUEL_TYPES);
      renderFuelDialogList();
      refreshAllFuelSelects();
    });
    list.appendChild(row);
  }
}

function openFuelDialog() {
  renderFuelDialogList();
  els.fuelNewInput.value = '';
  els.fuelDialog.showModal();
  setTimeout(() => els.fuelNewInput.focus(), 80);
}

function closeFuelDialog() {
  if (els.fuelDialog.open) els.fuelDialog.close();
}

els.btnManageFuels.addEventListener('click', openFuelDialog);
els.fuelDialogClose.addEventListener('click', closeFuelDialog);
els.fuelDoneBtn.addEventListener('click', closeFuelDialog);
els.fuelDialog.addEventListener('click', e => { if (e.target === els.fuelDialog) closeFuelDialog(); });

els.fuelAddBtn.addEventListener('click', () => {
  const name = (els.fuelNewInput.value || '').trim();
  if (!name) return;
  if (FUEL_TYPES.map(f => f.toLowerCase()).includes(name.toLowerCase())) {
    setStatus(`"${name}" already exists.`, true);
    return;
  }
  FUEL_TYPES.push(name);
  saveFuelTypes(FUEL_TYPES);
  renderFuelDialogList();
  refreshAllFuelSelects();
  els.fuelNewInput.value = '';
  els.fuelNewInput.focus();
  setStatus(`Added fuel type "${name}".`);
});

els.fuelNewInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.fuelAddBtn.click(); });

// ── Empty Drum Log ─────────────────────────────────────────────────────────

function renderEmpties() {
  const root = els.emptiesRoot;
  if (!root) return;
  root.innerHTML = '';

  // Section header
  const hdr = document.createElement('div');
  hdr.className = 'containerHeader';
  hdr.innerHTML = `
    <span class="containerName" style="color:var(--accent)">Empty Drum Log</span>
    <span class="containerLine"></span>
    <span class="containerMeta">${empties.length} drum${empties.length !== 1 ? 's' : ''} total</span>
    <button class="btn editContainerBtn" type="button" id="editEmptiesBtn">Edit</button>
  `;
  hdr.querySelector('#editEmptiesBtn').addEventListener('click', () => openEditEmptyDialog());
  root.appendChild(hdr);

  if (empties.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'emptyState';
    empty.style.cssText = 'padding:24px;font-size:13px;';
    empty.textContent = 'No drums emptied yet — they\'ll appear here as you use fuel.';
    root.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'tableWrap';

  const table = document.createElement('table');
  table.className = 'fuelTable';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Fuel Type</th>
        <th class="center">Drums</th>
        <th></th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  for (const entry of empties) {
    const dotColor = fuelColor(entry.fuelType);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="fuelTypeName">
          <span class="fuelDot" style="background:${dotColor}"></span>
          <strong>${escHtml(entry.fuelType)}</strong>
        </div>
      </td>
      <td class="center">
        <span style="font-size:16px;font-weight:700;color:#fff;">${entry.count}</span>
      </td>
      <td class="center">
        <button class="deleteRowBtn" data-act="del-empty" type="button" title="Remove entry">✕</button>
      </td>
    `;

    tr.querySelector('[data-act="del-empty"]').addEventListener('click', () => deleteEmptyEntry(entry.id));
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  root.appendChild(wrap);
}

async function deleteEmptyEntry(id) {
  const ok = confirm('Remove this entry from the empty drum log?');
  if (!ok) return;
  try {
    setStatus('Removing…');
    await api(`/api/empties?project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    empties = empties.filter(e => e.id !== id);
    renderEmpties();
    setStatus('Entry removed.');
  } catch (e) {
    setStatus(e.message, true);
  }
}


// ── Salt Pail Quantity ─────────────────────────────────────────────────────

function renderSaltPails() {
  const root = els.saltPailRoot;
  if (!root) return;
  root.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'containerHeader';
  hdr.innerHTML = `
    <span class="containerName" style="color:var(--accent)">Salt Pail Quantity</span>
    <span class="containerLine"></span>
  `;
  root.appendChild(hdr);

  const wrap = document.createElement('div');
  wrap.className = 'tableWrap';

  const table = document.createElement('table');
  table.className = 'fuelTable';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Item</th>
        <th class="center">Quantity</th>
        <th class="center">Edit</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><strong>Salt Pails</strong></td>
    <td class="center">
      <span style="font-size:22px;font-weight:700;color:#fff;">${saltPailQty}</span>
    </td>
    <td class="center">
      <button class="btn useBtn" type="button" id="saltPailEditRowBtn">Edit</button>
    </td>
  `;
  tr.querySelector('#saltPailEditRowBtn').addEventListener('click', openSaltPailDialog);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  wrap.appendChild(table);
  root.appendChild(wrap);
}

function openSaltPailDialog() {
  if (!ensureProject()) return;
  els.saltPailInput.value = saltPailQty;
  els.saltPailDialog.showModal();
  setTimeout(() => { els.saltPailInput.focus(); els.saltPailInput.select(); }, 80);
}

function closeSaltPailDialog() {
  if (els.saltPailDialog.open) els.saltPailDialog.close();
}

els.saltPailDialogClose.addEventListener('click', closeSaltPailDialog);
els.saltPailCancelBtn.addEventListener('click', closeSaltPailDialog);
els.saltPailDialog.addEventListener('click', e => { if (e.target === els.saltPailDialog) closeSaltPailDialog(); });

els.saltPailSaveBtn.addEventListener('click', async () => {
  const qty = safeInt(els.saltPailInput.value, 0);
  try {
    setStatus('Saving…');
    await api(`/api/saltpails?project=${encodeURIComponent(project)}`, {
      method: 'PUT',
      body: JSON.stringify({ quantity: qty }),
    });
    saltPailQty = qty;
    closeSaltPailDialog();
    renderSaltPails();
    setStatus(`Salt pail quantity updated to ${qty}.`);
  } catch (e) {
    setStatus(e.message, true);
  }
});

els.saltPailInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.saltPailSaveBtn.click(); });

// ── Edit Empty Drum Log Dialog ─────────────────────────────────────────────

function openEditEmptyDialog() {
  renderEditEmptyBody();
  els.editEmptyDialog.showModal();
}

function closeEditEmptyDialog() {
  if (els.editEmptyDialog.open) els.editEmptyDialog.close();
}

function renderEditEmptyBody() {
  const body = els.editEmptyDialogBody;
  body.innerHTML = '';

  if (empties.length === 0) {
    // Fall through — still render the add-row so the user can add entries
  }

  for (const entry of empties) {
    const dotColor = fuelColor(entry.fuelType);
    const div = document.createElement('div');
    div.className = 'editRow';
    div.dataset.id = entry.id;
    div.innerHTML = `
      <div class="editRowFuel" style="flex:1.5">
        <span class="fuelDot" style="background:${dotColor}"></span>
        <span class="editFuelName">${escHtml(entry.fuelType)}</span>
      </div>
      <div class="editField">
        <label class="lbl">Drums</label>
        <input class="editDrums" type="text" inputmode="numeric" value="${entry.count}" />
      </div>
      <div class="editField" style="flex:1.2">
        <label class="lbl">Fuel Type</label>
        <select class="editEmptyFuelType">
          ${[...FUEL_TYPES].sort((a,b)=>a.localeCompare(b)).map(f => `<option value="${escHtml(f)}"${f === entry.fuelType ? ' selected' : ''}>${escHtml(f)}</option>`).join('')}
        </select>
      </div>
      <button class="deleteRowBtn editDeleteBtn" type="button" title="Remove">✕</button>
    `;

    div.querySelector('.editDeleteBtn').addEventListener('click', async () => {
      const ok = confirm(`Remove this empty drum entry?`);
      if (!ok) return;
      try {
        setStatus('Removing…');
        await api(`/api/empties?project=${encodeURIComponent(project)}&id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
        empties = empties.filter(e => e.id !== entry.id);
        renderEditEmptyBody();
        renderEmpties();
        setStatus('Entry removed.');
      } catch (e) {
        setStatus(e.message, true);
      }
    });

    body.appendChild(div);
  }

  // Add new empty entry row
  const addDiv = document.createElement('div');
  addDiv.className = 'editAddRow';
  addDiv.innerHTML = `
    <div class="editField" style="flex:2">
      <label class="lbl">Add Fuel Type</label>
      <select id="editEmptyNewFuelType">
        <option value="" disabled selected>Select fuel</option>
        ${[...FUEL_TYPES].sort((a,b)=>a.localeCompare(b)).map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('')}
      </select>
    </div>
    <div class="editField">
      <label class="lbl">Drums</label>
      <input id="editEmptyNewCount" type="text" inputmode="numeric" placeholder="1" value="1" />
    </div>
    <button id="editEmptyAddBtn" class="btn primary" type="button" style="align-self:end">+ Add</button>
  `;

  addDiv.querySelector('#editEmptyAddBtn').addEventListener('click', async () => {
    const fuelType = addDiv.querySelector('#editEmptyNewFuelType').value;
    const count    = Math.max(1, safeInt(addDiv.querySelector('#editEmptyNewCount').value, 1));
    if (!fuelType) return setStatus('Select a fuel type.', true);
    try {
      setStatus('Adding…');
      await api(`/api/empties?project=${encodeURIComponent(project)}`, {
        method: 'POST',
        body: JSON.stringify({ entry: { container: '', fuelType, count } }),
      });
      const emptyData = await api(`/api/empties?project=${encodeURIComponent(project)}`);
      empties = Array.isArray(emptyData.entries) ? emptyData.entries : [];
      renderEditEmptyBody();
      renderEmpties();
      setStatus(`Added ${count} empty drum(s) of ${fuelType}.`);
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  body.appendChild(addDiv);
}

els.editEmptyDialogClose.addEventListener('click', closeEditEmptyDialog);
els.editEmptyCancelBtn.addEventListener('click', closeEditEmptyDialog);
els.editEmptyDialog.addEventListener('click', e => { if (e.target === els.editEmptyDialog) closeEditEmptyDialog(); });

els.editEmptySaveBtn.addEventListener('click', async () => {
  const body = els.editEmptyDialogBody;
  const editRows = [...body.querySelectorAll('.editRow')];

  // Snapshot values synchronously
  const updates = [];
  for (const div of editRows) {
    const id       = String(div.dataset.id || '');
    const countEl  = div.querySelector('.editDrums');
    const fuelEl   = div.querySelector('.editEmptyFuelType');
    const count    = safeInt(countEl ? countEl.value : '1', 1);
    const fuelType = fuelEl ? fuelEl.value : '';
    if (id) updates.push({ id, count, fuelType });
  }

  try {
    setStatus('Saving…');
    // Delete and re-POST to update (empties API only supports POST/DELETE/GET)
    for (const u of updates) {
      const existing = empties.find(e => e.id === u.id);
      if (!existing) continue;
      // Delete old
      await api(`/api/empties?project=${encodeURIComponent(project)}&id=${encodeURIComponent(u.id)}`, { method: 'DELETE' });
      // Re-add with new values
      await api(`/api/empties?project=${encodeURIComponent(project)}`, {
        method: 'POST',
        body: JSON.stringify({ entry: { container: existing.container, fuelType: u.fuelType, count: u.count } }),
      });
    }
    // Refresh empties from server
    const emptyData = await api(`/api/empties?project=${encodeURIComponent(project)}`);
    empties = Array.isArray(emptyData.entries) ? emptyData.entries : [];
    closeEditEmptyDialog();
    renderEmpties();
    setStatus('Empty drum log updated.');
  } catch (e) {
    setStatus(e.message, true);
  }
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

  // Ping is a health check only — don't block data load if it fails
  try { await api('/api/ping'); } catch (_) {}

  try {
    await refresh();
    if (els.statusBar.dataset.error !== '1') setStatus('Ready.');
  } catch (_) {}
})();
