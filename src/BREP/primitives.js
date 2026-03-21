import { Solid } from './BetterSolid.js';
import { applySolidAuthoringStateSnapshot } from './CppSolidCore.js';
import { manifold } from './setupManifold.js';

function hasNativePrimitiveBuilder() {
  return typeof manifold?.buildPrimitiveAuthoringState === 'function';
}

function requireNativePrimitiveBuilder() {
  if (hasNativePrimitiveBuilder()) return;
  throw new Error('Primitive generation requires the custom local manifold build with native primitive support.');
}

function applyNativePrimitiveSnapshot(target, snapshot, name) {
  applySolidAuthoringStateSnapshot(target, snapshot, { remapFaceIDs: true });
  target._dirty = true;
  target._manifold = null;
  target._faceIndex = null;
  target._auxEdges = [];
  target.name = name || 'Solid';
  return target;
}

class PrimitiveBase extends Solid {
  constructor(defaults, name, primitiveKind) {
    super();
    this.params = { ...defaults, name: name ?? defaults?.name ?? 'Solid' };
    this.name = this.params.name;
    this._primitiveKind = primitiveKind;
    this.generate();
  }

  buildNativeSnapshot() {
    requireNativePrimitiveBuilder();
    return manifold.buildPrimitiveAuthoringState({
      kind: this._primitiveKind,
      ...this.params,
      name: this.params?.name || this.name || 'Solid',
    });
  }

  generate() {
    const snapshot = this.buildNativeSnapshot();
    return applyNativePrimitiveSnapshot(this, snapshot, this.params?.name);
  }
}

export class Pyramid extends PrimitiveBase {
  constructor({ bL = 1, s = 4, h = 1, name = 'Pyramid' } = {}) {
    super({ bL, s, h, name }, name, 'pyramid');
  }
}

export class Sphere extends PrimitiveBase {
  constructor({ r = 1, resolution = 24, name = 'Sphere' } = {}) {
    super({ r, resolution, name }, name, 'sphere');
  }
}

export class Torus extends PrimitiveBase {
  constructor({ mR = 2, tR = 0.5, resolution = 48, arcDegrees = 360, name = 'Torus' } = {}) {
    super({ mR, tR, resolution, arcDegrees, name }, name, 'torus');
  }
}

export class Cube extends PrimitiveBase {
  constructor({ x = 1, y = 1, z = 1, name = 'Cube' } = {}) {
    super({ x, y, z, name }, name, 'cube');
  }
}

export class Cylinder extends PrimitiveBase {
  constructor({ radius = 1, height = 1, resolution = 32, name = 'Cylinder' } = {}) {
    super({ radius, height, resolution, name }, name, 'cylinder');
  }
}

export class Cone extends PrimitiveBase {
  constructor({ r1 = 0.5, r2 = 1, h = 1, resolution = 32, name = 'Cone' } = {}) {
    super({ r1, r2, h, resolution, name }, name, 'cone');
  }
}

export { hasNativePrimitiveBuilder as primitiveHasNativeBuilder };
