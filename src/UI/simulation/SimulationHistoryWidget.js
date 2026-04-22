import * as THREE from 'three';
import { SelectionFilter } from '../SelectionFilter.js';

function normalizeText(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function formatNumber(value, precision = 2) {
  const next = Number(value);
  if (!Number.isFinite(next)) return '';
  return next.toFixed(precision).replace(/\.?0+$/, '');
}

function resolveAxisFromSelection(selection, viewer) {
  const items = Array.isArray(selection) ? selection : [];
  if (items.length !== 1) return null;
  const target = items[0]?.object || items[0]?.target || items[0];
  if (!target || String(target?.type || '').toUpperCase() !== 'EDGE') return null;
  const extractWorldPositions = () => {
    try {
      if (typeof target.points === 'function') {
        const pts = target.points(true);
        if (Array.isArray(pts) && pts.length >= 2) {
          return pts
            .map((point) => [Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0])
            .filter((point) => point.length === 3);
        }
      }
    } catch {}
    try {
      target.updateMatrixWorld?.(true);
      const attr = target.geometry?.getAttribute?.('position');
      if (!attr || attr.count < 2) return [];
      const points = [];
      for (let index = 0; index < attr.count; index += 1) {
        const point = new THREE.Vector3(
          attr.getX(index),
          attr.getY(index),
          attr.getZ(index),
        );
        point.applyMatrix4(target.matrixWorld);
        points.push([point.x, point.y, point.z]);
      }
      return points;
    } catch {
      return [];
    }
  };
  const positions = extractWorldPositions();
  if (positions.length < 2) return null;
  const solid = viewer?._findParentSolid?.(target) || null;
  return {
    objectName: normalizeText(target.name, ''),
    anchorSolidName: normalizeText(solid?.name, ''),
    label: solid?.name ? `${solid.name} / ${target.name || 'Axis'}` : normalizeText(target.name, 'Axis'),
    axisStart: positions[0],
    axisEnd: positions[positions.length - 1],
  };
}

export class SimulationHistoryWidget {
  constructor(viewer) {
    this.viewer = viewer || null;
    this.uiElement = document.createElement('div');
    this.uiElement.className = 'simulation-history-widget-root';
    this._managerListener = null;
    this._modelListener = null;
    this._simListener = null;

    this._ensureStyles();
    this._buildUI();
    this._bindListeners();
    this.refresh();
  }

  dispose() {
    if (typeof this._managerListener === 'function') {
      try { this._managerListener(); } catch {}
    }
    if (typeof this._modelListener === 'function') {
      try { this._modelListener(); } catch {}
    }
    if (typeof this._simListener === 'function') {
      try { this._simListener(); } catch {}
    }
    this._managerListener = null;
    this._modelListener = null;
    this._simListener = null;
  }

  _getStateManager() {
    return this.viewer?.partHistory?.simulationStateManager || null;
  }

  async _getWorkbenchManager() {
    return this.viewer?.simulationWorkbenchManager || await this.viewer?._ensureSimulationWorkbenchManager?.();
  }

  refresh() {
    this._renderTransport();
    this._renderList();
  }

  refreshFromHistory() {
    this.refresh();
  }

  _bindListeners() {
    const manager = this._getStateManager();
    if (manager?.addListener) {
      this._managerListener = manager.addListener(() => this.refresh());
    }
    if (this.viewer?.partHistory?.addModelChangeListener) {
      this._modelListener = this.viewer.partHistory.addModelChangeListener(() => this.refresh());
    }
    this._attachSimulationListener();
  }

  async _attachSimulationListener() {
    const manager = await this._getWorkbenchManager();
    if (!manager?.addListener) return;
    this._simListener = manager.addListener(() => this._renderTransport());
    this._renderTransport();
  }

  _buildUI() {
    this.transportEl = document.createElement('div');
    this.transportEl.className = 'simulation-history-transport';
    this.uiElement.appendChild(this.transportEl);

    this.listEl = document.createElement('div');
    this.listEl.className = 'simulation-history-list';
    this.uiElement.appendChild(this.listEl);

    this.footerEl = document.createElement('div');
    this.footerEl.className = 'simulation-history-footer';
    this.uiElement.appendChild(this.footerEl);

    const addRotationBtn = document.createElement('button');
    addRotationBtn.type = 'button';
    addRotationBtn.className = 'simulation-history-btn simulation-history-btn-primary';
    addRotationBtn.textContent = 'Rotation Motion';
    addRotationBtn.addEventListener('click', () => this._addMotion('rotation'));
    this.footerEl.appendChild(addRotationBtn);

    const addLinearBtn = document.createElement('button');
    addLinearBtn.type = 'button';
    addLinearBtn.className = 'simulation-history-btn';
    addLinearBtn.textContent = 'Linear Motion';
    addLinearBtn.addEventListener('click', () => this._addMotion('linear'));
    this.footerEl.appendChild(addLinearBtn);
  }

  _renderTransport() {
    const manager = this.viewer?.simulationWorkbenchManager || null;
    const isPlaying = !!manager?.isPlaying?.();
    this.transportEl.textContent = '';

    const playPauseBtn = document.createElement('button');
    playPauseBtn.type = 'button';
    playPauseBtn.className = 'simulation-history-btn simulation-history-btn-primary';
    playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
    playPauseBtn.addEventListener('click', async () => {
      const runtime = await this._getWorkbenchManager();
      runtime?.setPlaying?.(!runtime?.isPlaying?.());
      this._renderTransport();
    });
    this.transportEl.appendChild(playPauseBtn);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'simulation-history-btn';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', async () => {
      const runtime = await this._getWorkbenchManager();
      runtime?.resetSimulationState?.();
      this._renderTransport();
    });
    this.transportEl.appendChild(resetBtn);
  }

  _renderList() {
    const manager = this._getStateManager();
    const motions = Array.isArray(manager?.getMotions?.()) ? manager.getMotions() : [];
    this.listEl.textContent = '';
    if (!motions.length) {
      const empty = document.createElement('div');
      empty.className = 'simulation-history-empty';
      empty.textContent = 'No motions configured.';
      this.listEl.appendChild(empty);
      return;
    }

    for (const motion of motions) {
      const item = document.createElement('div');
      item.className = 'simulation-history-item';

      const header = document.createElement('div');
      header.className = 'simulation-history-item-header';
      const title = document.createElement('div');
      title.className = 'simulation-history-item-title';
      title.textContent = normalizeText(motion.name, motion.type === 'linear' ? 'Linear Motion' : 'Rotation Motion');
      header.appendChild(title);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'simulation-history-btn simulation-history-btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => this._removeMotion(motion.id));
      header.appendChild(deleteBtn);
      item.appendChild(header);

      item.appendChild(this._buildTextField(motion, 'name', 'Name'));
      item.appendChild(this._buildSolidField(motion));
      item.appendChild(this._buildAxisField(motion));
      item.appendChild(this._buildNumberField(motion, 'speed', motion.type === 'linear' ? 'Speed' : 'Speed (deg/s)'));
      item.appendChild(this._buildNumberField(
        motion,
        motion.type === 'linear' ? 'distance' : 'angle',
        motion.type === 'linear' ? 'Distance Limit' : 'Angle Limit',
        { placeholder: 'Leave blank for continuous motion' },
      ));

      const hint = document.createElement('div');
      hint.className = 'simulation-history-hint';
      hint.textContent = motion.type === 'linear'
        ? 'Uses the selected edge or centerline as the translation direction.'
        : 'Uses the selected edge or centerline as the rotation axis.';
      item.appendChild(hint);

      this.listEl.appendChild(item);
    }
  }

  _buildTextField(motion, key, label) {
    const row = document.createElement('label');
    row.className = 'simulation-history-field';
    const caption = document.createElement('span');
    caption.className = 'simulation-history-label';
    caption.textContent = label;
    row.appendChild(caption);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'simulation-history-input';
    input.value = normalizeText(motion?.[key], '');
    input.addEventListener('change', () => this._updateMotion(motion.id, { [key]: input.value }));
    row.appendChild(input);
    return row;
  }

  _buildNumberField(motion, key, label, options = {}) {
    const row = document.createElement('label');
    row.className = 'simulation-history-field';
    const caption = document.createElement('span');
    caption.className = 'simulation-history-label';
    caption.textContent = label;
    row.appendChild(caption);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'simulation-history-input';
    input.value = motion?.[key] == null ? '' : String(motion[key]);
    if (options.placeholder) input.placeholder = options.placeholder;
    input.addEventListener('change', () => {
      const raw = normalizeText(input.value, '');
      this._updateMotion(motion.id, { [key]: raw === '' ? null : Number(raw) });
    });
    row.appendChild(input);
    return row;
  }

  _buildSolidField(motion) {
    const row = document.createElement('div');
    row.className = 'simulation-history-field';

    const caption = document.createElement('span');
    caption.className = 'simulation-history-label';
    caption.textContent = 'Solid';
    row.appendChild(caption);

    const controls = document.createElement('div');
    controls.className = 'simulation-history-inline';
    row.appendChild(controls);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'simulation-history-input';
    input.value = normalizeText(motion?.solidName, '');
    input.placeholder = 'Solid name';
    input.addEventListener('change', () => this._updateMotion(motion.id, { solidName: input.value }));
    controls.appendChild(input);

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'simulation-history-btn';
    pickBtn.textContent = 'Use Selected';
    pickBtn.addEventListener('click', () => {
      const selection = SelectionFilter.getSelectedObjects();
      const target = Array.isArray(selection) && selection.length === 1
        ? (selection[0]?.object || selection[0]?.target || selection[0])
        : null;
      const solid = this.viewer?._findParentSolid?.(target) || (target?.type === 'SOLID' ? target : null);
      if (!solid?.name) {
        this.viewer?._toast?.('Select a single solid.');
        return;
      }
      this._updateMotion(motion.id, { solidName: solid.name });
    });
    controls.appendChild(pickBtn);

    return row;
  }

  _buildAxisField(motion) {
    const row = document.createElement('div');
    row.className = 'simulation-history-field';

    const caption = document.createElement('span');
    caption.className = 'simulation-history-label';
    caption.textContent = 'Axis / Direction';
    row.appendChild(caption);

    const preview = document.createElement('div');
    preview.className = 'simulation-history-axis-preview';
    preview.textContent = normalizeText(motion?.axisRef?.label, 'No edge or centerline selected');
    row.appendChild(preview);

    const controls = document.createElement('div');
    controls.className = 'simulation-history-inline';
    row.appendChild(controls);

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'simulation-history-btn';
    pickBtn.textContent = 'Use Selected Edge';
    pickBtn.addEventListener('click', () => {
      const axisRef = resolveAxisFromSelection(SelectionFilter.getSelectedObjects(), this.viewer);
      if (!axisRef) {
        this.viewer?._toast?.('Select a single edge or centerline.');
        return;
      }
      this._updateMotion(motion.id, { axisRef });
    });
    controls.appendChild(pickBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'simulation-history-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      this._updateMotion(motion.id, {
        axisRef: {
          objectName: '',
          anchorSolidName: '',
          label: '',
          axisStart: [0, 0, 0],
          axisEnd: [1, 0, 0],
        },
      });
    });
    controls.appendChild(clearBtn);

    const summary = document.createElement('div');
    summary.className = 'simulation-history-summary';
    const start = Array.isArray(motion?.axisRef?.axisStart) ? motion.axisRef.axisStart : [0, 0, 0];
    const end = Array.isArray(motion?.axisRef?.axisEnd) ? motion.axisRef.axisEnd : [1, 0, 0];
    summary.textContent = `Start: ${formatNumber(start[0])}, ${formatNumber(start[1])}, ${formatNumber(start[2])}  End: ${formatNumber(end[0])}, ${formatNumber(end[1])}, ${formatNumber(end[2])}`;
    row.appendChild(summary);

    return row;
  }

  _addMotion(type) {
    const manager = this._getStateManager();
    if (!manager?.addMotion) return;
    manager.addMotion(type);
    this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'simulation-motion' });
  }

  _updateMotion(id, patch) {
    const manager = this._getStateManager();
    if (!manager?.updateMotion) return;
    manager.updateMotion(id, patch);
    this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'simulation-motion' });
  }

  _removeMotion(id) {
    const manager = this._getStateManager();
    if (!manager?.removeMotion) return;
    manager.removeMotion(id);
    this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'simulation-motion' });
  }

  _ensureStyles() {
    if (document.getElementById('simulation-history-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'simulation-history-widget-styles';
    style.textContent = `
      .simulation-history-widget-root {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
      }
      .simulation-history-transport,
      .simulation-history-footer,
      .simulation-history-inline {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .simulation-history-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .simulation-history-item {
        border: 1px solid rgba(59, 130, 246, 0.22);
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.58);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .simulation-history-item-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .simulation-history-item-title {
        color: #f8fafc;
        font-weight: 700;
      }
      .simulation-history-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .simulation-history-label {
        color: rgba(226, 232, 240, 0.72);
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .simulation-history-input,
      .simulation-history-axis-preview,
      .simulation-history-summary {
        width: 100%;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(2, 6, 23, 0.65);
        color: #f8fafc;
        padding: 8px 10px;
        box-sizing: border-box;
        min-height: 36px;
      }
      .simulation-history-axis-preview,
      .simulation-history-summary,
      .simulation-history-empty,
      .simulation-history-hint {
        font-size: 12px;
      }
      .simulation-history-summary,
      .simulation-history-empty,
      .simulation-history-hint {
        color: rgba(191, 219, 254, 0.82);
      }
      .simulation-history-btn {
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(30, 41, 59, 0.92);
        color: #f8fafc;
        padding: 8px 10px;
        cursor: pointer;
      }
      .simulation-history-btn-primary {
        background: rgba(37, 99, 235, 0.92);
        border-color: rgba(96, 165, 250, 0.42);
      }
      .simulation-history-btn-danger {
        background: rgba(127, 29, 29, 0.92);
        border-color: rgba(248, 113, 113, 0.38);
      }
    `;
    document.head.appendChild(style);
  }
}
