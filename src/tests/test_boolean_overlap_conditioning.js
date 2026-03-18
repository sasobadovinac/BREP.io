import { BREP } from '../BREP/BREP.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}

function faceAxisMin(solid, faceName, axisIndex = 0) {
  const triangles = typeof solid?.getFace === 'function' ? solid.getFace(faceName) : [];
  let min = Number.POSITIVE_INFINITY;
  for (const tri of triangles) {
    for (const point of [tri?.p1, tri?.p2, tri?.p3]) {
      if (!Array.isArray(point) || point.length < 3) continue;
      min = Math.min(min, Number(point[axisIndex]));
    }
  }
  return min;
}

function faceAxisMax(solid, faceName, axisIndex = 0) {
  const triangles = typeof solid?.getFace === 'function' ? solid.getFace(faceName) : [];
  let max = Number.NEGATIVE_INFINITY;
  for (const tri of triangles) {
    for (const point of [tri?.p1, tri?.p2, tri?.p3]) {
      if (!Array.isArray(point) || point.length < 3) continue;
      max = Math.max(max, Number(point[axisIndex]));
    }
  }
  return max;
}

function makeTouchingCubePair(baseName, toolName) {
  const base = new BREP.Cube({ x: 1, y: 1, z: 1, name: baseName });
  const tool = new BREP.Cube({ x: 1, y: 1, z: 1, name: toolName });
  tool.bakeTRS({
    position: [1, 0, 0],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
  });
  return { base, tool };
}

function makeFakePartHistory() {
  return {
    scene: {
      getObjectByName() {
        return null;
      },
    },
  };
}

async function captureUnionOperandMinX(booleanParam) {
  const { base, tool } = makeTouchingCubePair('BASE', 'TOOL');
  const proto = Object.getPrototypeOf(base);
  const originalUnion = proto.union;
  let observedMinX = null;

  proto.union = function patchedUnion(other) {
    if (observedMinX === null) {
      observedMinX = faceAxisMin(other, 'TOOL_NX', 0);
    }
    return originalUnion.call(this, other);
  };

  try {
    await BREP.applyBooleanOperation(makeFakePartHistory(), base, {
      operation: 'UNION',
      targets: [tool],
      ...booleanParam,
    }, 'BOOL_OVERLAP_UNION');
  } finally {
    proto.union = originalUnion;
  }

  return observedMinX;
}

async function captureSubtractOperandMinX(booleanParam) {
  const { base: target, tool: cutter } = makeTouchingCubePair('TARGET', 'CUTTER');
  const proto = Object.getPrototypeOf(target);
  const originalSubtract = proto.subtract;
  let observedMinX = null;

  proto.subtract = function patchedSubtract(other) {
    if (observedMinX === null) {
      observedMinX = faceAxisMin(other, 'CUTTER_NX', 0);
    }
    return originalSubtract.call(this, other);
  };

  try {
    await BREP.applyBooleanOperation(makeFakePartHistory(), cutter, {
      operation: 'SUBTRACT',
      targets: [target],
      ...booleanParam,
    }, 'BOOL_OVERLAP_SUBTRACT');
  } finally {
    proto.subtract = originalSubtract;
  }

  return observedMinX;
}

async function captureSubtractOperandMinZForEntryCap(booleanParam) {
  const target = new BREP.Cube({ x: 1, y: 1, z: 1, name: 'TARGET_Z' });
  const cutter = new BREP.Cube({ x: 1, y: 1, z: 2, name: 'CUTTER_Z' });
  const proto = Object.getPrototypeOf(target);
  const originalSubtract = proto.subtract;
  let observedMinZ = null;
  let observedMaxZ = null;

  proto.subtract = function patchedSubtract(other) {
    if (observedMinZ === null) {
      observedMinZ = faceAxisMin(other, 'CUTTER_Z_NZ', 2);
      observedMaxZ = faceAxisMax(other, 'CUTTER_Z_NZ', 2);
    }
    return originalSubtract.call(this, other);
  };

  try {
    await BREP.applyBooleanOperation(makeFakePartHistory(), cutter, {
      operation: 'SUBTRACT',
      targets: [target],
      ...booleanParam,
    }, 'BOOL_OVERLAP_SUBTRACT_CAP');
  } finally {
    proto.subtract = originalSubtract;
  }

  return { observedMinZ, observedMaxZ };
}

export async function test_boolean_overlap_conditioning_union_enabled_by_default() {
  const observedMinX = await captureUnionOperandMinX({});
  assert(Number.isFinite(observedMinX), 'Expected union test to observe the conditioned tool face.');
  assert(observedMinX < 1 - 1e-7, `Expected default union conditioning to push TOOL_NX into the base solid, got minX=${observedMinX}`);
}

export async function test_boolean_overlap_conditioning_union_can_be_disabled() {
  const observedMinX = await captureUnionOperandMinX({ overlapConditioningEnabled: false });
  assert(Number.isFinite(observedMinX), 'Expected disabled union test to observe the tool face.');
  assert(Math.abs(observedMinX - 1) <= 1e-12, `Expected disabled union conditioning to leave TOOL_NX at x=1, got minX=${observedMinX}`);
}

export async function test_boolean_overlap_conditioning_subtract_enabled_by_default() {
  const observedMinX = await captureSubtractOperandMinX({});
  assert(Number.isFinite(observedMinX), 'Expected subtract test to observe the conditioned cutter face.');
  assert(observedMinX < 1 - 1e-7, `Expected default subtract conditioning to push CUTTER_NX into the target solid, got minX=${observedMinX}`);
}

export async function test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward() {
  const { observedMinZ, observedMaxZ } = await captureSubtractOperandMinZForEntryCap({});
  assert(Number.isFinite(observedMinZ) && Number.isFinite(observedMaxZ), 'Expected subtract cap test to observe the conditioned cutter cap face.');
  assert(observedMinZ < 0 - 1e-7, `Expected subtract conditioning to expand CUTTER_Z_NZ outward beyond z=0, got minZ=${observedMinZ}`);
  assert(Math.abs(observedMaxZ - observedMinZ) <= 1e-12, `Expected CUTTER_Z_NZ to remain planar after conditioning, got minZ=${observedMinZ}, maxZ=${observedMaxZ}`);
}

export async function test_boolean_overlap_conditioning_subtract_can_be_disabled() {
  const observedMinX = await captureSubtractOperandMinX({ overlapConditioningEnabled: false });
  assert(Number.isFinite(observedMinX), 'Expected disabled subtract test to observe the cutter face.');
  assert(Math.abs(observedMinX - 1) <= 1e-12, `Expected disabled subtract conditioning to leave CUTTER_NX at x=1, got minX=${observedMinX}`);
}
