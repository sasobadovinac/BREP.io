import { deepClone } from '../utils/deepClone.js';

function normalizeText(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeAxisRef(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalizeVec3 = (value, fallback = [0, 0, 0]) => {
    if (!Array.isArray(value) || value.length < 3) return fallback.slice();
    return [
      toFiniteNumber(value[0], fallback[0]),
      toFiniteNumber(value[1], fallback[1]),
      toFiniteNumber(value[2], fallback[2]),
    ];
  };
  return {
    objectName: normalizeText(source.objectName, ''),
    anchorSolidName: normalizeText(source.anchorSolidName, ''),
    label: normalizeText(source.label, ''),
    axisStart: normalizeVec3(source.axisStart),
    axisEnd: normalizeVec3(source.axisEnd, [1, 0, 0]),
  };
}

function normalizeMotion(raw, index = 0) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const type = normalizeText(source.type, 'rotation').toLowerCase() === 'linear' ? 'linear' : 'rotation';
  const defaultName = type === 'linear' ? `Linear Motion ${index + 1}` : `Rotation Motion ${index + 1}`;
  const limitKey = type === 'linear' ? 'distance' : 'angle';
  const rawLimit = source[limitKey];
  const finiteLimit = Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : null;
  return {
    id: normalizeText(source.id, `simulation-motion-${index + 1}`),
    type,
    name: normalizeText(source.name, defaultName),
    solidName: normalizeText(source.solidName, ''),
    axisRef: normalizeAxisRef(source.axisRef),
    speed: toFiniteNumber(source.speed, type === 'linear' ? 10 : 90),
    [limitKey]: finiteLimit,
  };
}

export class SimulationStateManager {
  constructor(partHistory) {
    this.partHistory = partHistory || null;
    this.motions = [];
    this._listeners = new Set();
  }

  reset() {
    this.motions = [];
    this._emit();
  }

  getMotions() {
    this._normalizeMotionsArray(this.motions);
    return this.motions;
  }

  addMotion(type = 'rotation', motion = {}) {
    const list = this.getMotions();
    const nextType = String(type || motion?.type || 'rotation').toLowerCase() === 'linear' ? 'linear' : 'rotation';
    const normalized = normalizeMotion({
      id: motion?.id || this._generateMotionId(nextType),
      type: nextType,
      ...motion,
    }, list.length);
    list.push(normalized);
    this._emit();
    return normalized;
  }

  updateMotion(motionId, updater) {
    const list = this.getMotions();
    const id = normalizeText(motionId, '');
    const index = list.findIndex((entry) => String(entry?.id || '') === id);
    if (index < 0) return null;
    const current = list[index];
    let next = current;
    if (typeof updater === 'function') {
      try {
        const result = updater(deepClone(current));
        if (result && typeof result === 'object') next = result;
      } catch {
        next = current;
      }
    } else if (updater && typeof updater === 'object') {
      next = { ...current, ...updater };
    }
    list[index] = normalizeMotion(next, index);
    if (!list[index].id) list[index].id = current.id;
    this._emit();
    return list[index];
  }

  removeMotion(motionId) {
    const list = this.getMotions();
    const id = normalizeText(motionId, '');
    const index = list.findIndex((entry) => String(entry?.id || '') === id);
    if (index < 0) return null;
    const [removed] = list.splice(index, 1);
    this._normalizeMotionsArray(list);
    this._emit();
    return removed || null;
  }

  toSerializable() {
    return {
      motions: this.getMotions().map((entry) => deepClone(entry)),
    };
  }

  loadSerializable(rawState) {
    const state = (rawState && typeof rawState === 'object' && !Array.isArray(rawState))
      ? rawState
      : { motions: rawState };
    this.motions = Array.isArray(state.motions) ? Array.from(state.motions) : [];
    this._normalizeMotionsArray(this.motions);
    this._emit();
    return this.toSerializable();
  }

  addListener(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => {
      try { this._listeners.delete(listener); } catch {}
    };
  }

  removeListener(listener) {
    if (typeof listener !== 'function') return;
    try { this._listeners.delete(listener); } catch {}
  }

  notifyChanged() {
    this._emit();
  }

  _generateMotionId(type = 'rotation') {
    const prefix = type === 'linear' ? 'linear-motion' : 'rotation-motion';
    const ids = new Set(this.getMotions().map((entry) => String(entry?.id || '')));
    let index = 1;
    while (ids.has(`${prefix}-${index}`)) index += 1;
    return `${prefix}-${index}`;
  }

  _normalizeMotionsArray(arrayRef) {
    if (!Array.isArray(arrayRef)) {
      this.motions = [];
      return this.motions;
    }
    for (let index = 0; index < arrayRef.length; index += 1) {
      arrayRef[index] = normalizeMotion(arrayRef[index], index);
    }
    return arrayRef;
  }

  _emit() {
    if (!this._listeners || this._listeners.size === 0) return;
    const payload = {
      motions: this.getMotions(),
      manager: this,
    };
    for (const listener of Array.from(this._listeners)) {
      try { listener(payload); } catch {}
    }
  }
}
