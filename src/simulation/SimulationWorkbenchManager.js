import * as THREE from 'three';
import { CombinedTransformControls } from '../UI/controls/CombinedTransformControls.js';

const FIXED_METADATA_KEY = 'fixed';
const TRANSFORM_METADATA_KEY = 'simulationTransform';
const SIM_PROXY_PREFIX = '__SIM_PROXY__';
const VHACD_OPTIONS = Object.freeze({
  maxHulls: 64,
  voxelResolution: 1000000,
  maxVerticesPerHull: 64,
  shrinkWrap: true,
  fillMode: 'flood',
  findBestPlane: true,
  minEdgeLength: 1,
  messages: 'none',
});
const DEFAULT_TRANSFORM = Object.freeze({
  position: [0, 0, 0],
  rotationEuler: [0, 0, 0],
});

function cloneVec3(value, fallback = [0, 0, 0]) {
  const src = Array.isArray(value) ? value : fallback;
  return [
    Number.isFinite(Number(src[0])) ? Number(src[0]) : fallback[0],
    Number.isFinite(Number(src[1])) ? Number(src[1]) : fallback[1],
    Number.isFinite(Number(src[2])) ? Number(src[2]) : fallback[2],
  ];
}

function normalizeTransform(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    position: cloneVec3(raw.position, DEFAULT_TRANSFORM.position),
    rotationEuler: cloneVec3(raw.rotationEuler, DEFAULT_TRANSFORM.rotationEuler),
  };
}

function transformIsIdentity(transform) {
  const position = cloneVec3(transform?.position, DEFAULT_TRANSFORM.position);
  const rotationEuler = cloneVec3(transform?.rotationEuler, DEFAULT_TRANSFORM.rotationEuler);
  return position.every((value) => Math.abs(value) <= 1e-9)
    && rotationEuler.every((value) => Math.abs(value) <= 1e-9);
}

function copyLocalPose(object) {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  };
}

function buildLocalMatrix(pose) {
  return new THREE.Matrix4().compose(
    pose.position.clone(),
    pose.quaternion.clone(),
    pose.scale.clone(),
  );
}

function poseToOffset(basePose, currentObject) {
  const baseMatrix = buildLocalMatrix(basePose);
  const currentMatrix = new THREE.Matrix4().compose(
    currentObject.position.clone(),
    currentObject.quaternion.clone(),
    currentObject.scale.clone(),
  );
  const relative = new THREE.Matrix4().copy(baseMatrix).invert().multiply(currentMatrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  relative.decompose(position, quaternion, scale);
  const rotationEuler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: [position.x, position.y, position.z],
    rotationEuler: [rotationEuler.x, rotationEuler.y, rotationEuler.z],
  };
}

function normalizeMeshArrays(mesh) {
  if (!mesh) return null;
  const stride = Math.max(3, Number(mesh.numProp) || 3);
  const sourcePositions = Array.isArray(mesh.vertProperties) ? mesh.vertProperties : Array.from(mesh.vertProperties || []);
  const sourceIndices = Array.isArray(mesh.triVerts) ? mesh.triVerts : Array.from(mesh.triVerts || []);
  if (sourcePositions.length < 9 || sourceIndices.length < 3) return null;
  const positions = new Float64Array((sourcePositions.length / stride) * 3);
  for (let src = 0, dst = 0; src + 2 < sourcePositions.length; src += stride, dst += 3) {
    positions[dst + 0] = Number(sourcePositions[src + 0]) || 0;
    positions[dst + 1] = Number(sourcePositions[src + 1]) || 0;
    positions[dst + 2] = Number(sourcePositions[src + 2]) || 0;
  }
  return {
    positions,
    indices: new Uint32Array(sourceIndices),
  };
}

function buildProxyMaterial(baseColor, index, total) {
  const color = new THREE.Color(baseColor || '#9ca3af');
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const offset = total > 1 ? (index / Math.max(1, total)) * 0.18 : 0;
  color.setHSL((hsl.h + offset) % 1, Math.min(1, Math.max(0.35, hsl.s || 0.55)), Math.min(0.72, Math.max(0.42, hsl.l)));
  return new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    roughness: 0.55,
    metalness: 0.05,
    depthWrite: true,
  });
}

function disposeHierarchy(root) {
  if (!root?.traverse) return;
  root.traverse((node) => {
    if (node?.geometry?.dispose) {
      try { node.geometry.dispose(); } catch {}
    }
    if (Array.isArray(node?.material)) {
      for (const material of node.material) {
        try { material?.dispose?.(); } catch {}
      }
    } else {
      try { node?.material?.dispose?.(); } catch {}
    }
  });
}

export class SimulationWorkbenchManager {
  constructor(viewer) {
    this.viewer = viewer || null;
    this._active = false;
    this._baseLocalPose = new Map();
    this._runtimeState = new Map();
    this._sourceVisibility = new Map();
    this._decompositionCache = new Map();
    this._proxyGroups = new Map();
    this._transformSession = null;
    this._rapier = null;
    this._rapierLoadPromise = null;
    this._vhacd = null;
    this._vhacdLoadPromise = null;
    this._physicsWorld = null;
    this._bodyState = new Map();
    this._raf = 0;
    this._lastStepTime = 0;
    this._scratch = {
      parentInverse: new THREE.Matrix4(),
      worldPosition: new THREE.Vector3(),
      localPosition: new THREE.Vector3(),
      worldQuaternion: new THREE.Quaternion(),
      parentQuaternion: new THREE.Quaternion(),
      parentQuaternionInverse: new THREE.Quaternion(),
      box: new THREE.Box3(),
      center: new THREE.Vector3(),
    };
  }

  dispose() {
    this.setActive(false);
  }

  isActive() {
    return this._active;
  }

  isSimulationWorkbenchActive() {
    return this.viewer?._getActiveWorkbenchId?.() === 'SIMULATION';
  }

  getSolidFixed(solid) {
    if (!solid?.name) return false;
    const own = this.viewer?.partHistory?.metadataManager?.getOwnMetadata?.(solid.name) || {};
    return own[FIXED_METADATA_KEY] === true;
  }

  setSolidFixed(solid, fixed) {
    if (!solid?.name) return false;
    const manager = this.viewer?.partHistory?.metadataManager;
    if (!manager) return false;
    const data = manager.getOwnMetadata(solid.name);
    if (fixed) data[FIXED_METADATA_KEY] = true;
    else delete data[FIXED_METADATA_KEY];
    manager.setMetadataObject(solid.name, data);
    if (this._active) {
      void this._rebuildPhysicsWorld();
    }
    return true;
  }

  getStoredTransform(solid) {
    if (!solid?.name) return normalizeTransform(null);
    const own = this.viewer?.partHistory?.metadataManager?.getOwnMetadata?.(solid.name) || {};
    return normalizeTransform(own[TRANSFORM_METADATA_KEY]);
  }

  setStoredTransform(solid, transform) {
    if (!solid?.name) return false;
    const manager = this.viewer?.partHistory?.metadataManager;
    if (!manager) return false;
    const normalized = normalizeTransform(transform);
    const data = manager.getOwnMetadata(solid.name);
    if (transformIsIdentity(normalized)) delete data[TRANSFORM_METADATA_KEY];
    else data[TRANSFORM_METADATA_KEY] = normalized;
    manager.setMetadataObject(solid.name, data);
    return true;
  }

  setActive(active) {
    const next = !!active;
    if (next === this._active) {
      if (next) {
        this._applyRuntimeTransforms();
      } else {
        this._restoreBaseLocalPoses();
      }
      return;
    }
    this._active = next;
    if (this._active) {
      this._captureBaseLocalPoses();
      this._captureSourceVisibility();
      this._hydrateRuntimeStateFromMetadata();
      this._applyRuntimeTransforms();
      this._setSourceSolidsVisible(true);
      void this._prepareSimulationAssets();
      this._ensurePhysicsLoop();
      return;
    }
    this._stopTransformSession();
    this._destroyPhysicsWorld();
    this._stopPhysicsLoop();
    this._clearProxyGroups();
    this._setSourceSolidsVisible(true);
    this._restoreBaseLocalPoses();
    this._runtimeState.clear();
    this._baseLocalPose.clear();
    this._sourceVisibility.clear();
    this._decompositionCache.clear();
  }

  toggleSolidTransform(solid) {
    if (!solid || solid.type !== 'SOLID') return;
    if (!this.isSimulationWorkbenchActive()) return;
    const session = this._transformSession;
    if (session && session.solid === solid) {
      const currentMode = (typeof session.controls?.getMode === 'function')
        ? session.controls.getMode()
        : (session.controls?.mode || session.mode || 'translate');
      if (currentMode === 'translate') {
        try { session.controls?.setMode('rotate'); } catch { session.controls.mode = 'rotate'; }
        session.mode = 'rotate';
        try { session.globalState?.updateForCamera?.(); } catch {}
        try { this.viewer?.render?.(); } catch {}
        return;
      }
      this._stopTransformSession();
      return;
    }
    this._startTransformSession(solid);
  }

  _captureBaseLocalPoses() {
    for (const solid of this._listSceneSolids()) {
      if (!this._baseLocalPose.has(solid.uuid)) {
        this._baseLocalPose.set(solid.uuid, copyLocalPose(solid));
      }
    }
  }

  _captureSourceVisibility() {
    for (const solid of this._listSceneSolids()) {
      if (!this._sourceVisibility.has(solid.uuid)) {
        this._sourceVisibility.set(solid.uuid, solid.visible !== false);
      }
    }
  }

  _hydrateRuntimeStateFromMetadata() {
    for (const solid of this._listSceneSolids()) {
      this._runtimeState.set(solid.uuid, normalizeTransform(this.getStoredTransform(solid)));
    }
  }

  _restoreBaseLocalPoses() {
    for (const solid of this._listSceneSolids()) {
      const base = this._baseLocalPose.get(solid.uuid);
      if (!base) continue;
      solid.position.copy(base.position);
      solid.quaternion.copy(base.quaternion);
      solid.scale.copy(base.scale);
      solid.updateMatrixWorld?.(true);
    }
    try { this.viewer?.render?.(); } catch {}
  }

  _applyRuntimeTransforms() {
    this._captureBaseLocalPoses();
    for (const solid of this._listSceneSolids()) {
      this._applyRuntimeTransformToSolid(solid);
    }
    try { this.viewer?.render?.(); } catch {}
  }

  _applyRuntimeTransformToSolid(solid) {
    const base = this._baseLocalPose.get(solid.uuid);
    if (!base) return;
    const runtime = normalizeTransform(this._runtimeState.get(solid.uuid));
    const offsetQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...runtime.rotationEuler, 'XYZ'),
    );
    const nextMatrix = buildLocalMatrix(base).multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...runtime.position),
        offsetQuaternion,
        new THREE.Vector3(1, 1, 1),
      ),
    );
    nextMatrix.decompose(solid.position, solid.quaternion, solid.scale);
    solid.updateMatrixWorld?.(true);
    this._syncProxyGroupTransform(solid);
  }

  _updateRuntimeTransformFromSolid(solid, { persist = false } = {}) {
    const base = this._baseLocalPose.get(solid.uuid);
    if (!base) return;
    const offset = normalizeTransform(poseToOffset(base, solid));
    this._runtimeState.set(solid.uuid, offset);
    if (persist) {
      this.setStoredTransform(solid, offset);
      this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'simulation-transform' });
    }
    this._syncProxyGroupTransform(solid);
  }

  async _prepareSimulationAssets() {
    if (!this._active) return;
    try {
      await Promise.all(this._listSceneSolids().map((solid) => this._ensureDecomposition(solid)));
      this._buildProxyGroups();
      await this._rebuildPhysicsWorld();
    } catch (error) {
      console.warn('[SimulationWorkbench] Failed to prepare simulation assets:', error);
    }
  }

  async _loadRapier() {
    if (this._rapier) return this._rapier;
    if (!this._rapierLoadPromise) {
      this._rapierLoadPromise = import('@dimforge/rapier3d/rapier.js')
        .then((module) => module?.default || module)
        .then((rapier) => {
          this._rapier = rapier;
          return rapier;
        })
        .catch((error) => {
          this._rapierLoadPromise = null;
          throw error;
        });
    }
    return this._rapierLoadPromise;
  }

  async _loadVhacd() {
    if (this._vhacd) return this._vhacd;
    if (!this._vhacdLoadPromise) {
      this._vhacdLoadPromise = import('vhacd-js/lib/vhacd.js')
        .then((module) => module?.ConvexMeshDecomposition?.create?.())
        .then((instance) => {
          this._vhacd = instance || null;
          return this._vhacd;
        })
        .catch((error) => {
          this._vhacdLoadPromise = null;
          throw error;
        });
    }
    return this._vhacdLoadPromise;
  }

  async _ensureDecomposition(solid) {
    if (!solid?.uuid) return [];
    const cached = this._decompositionCache.get(solid.uuid);
    if (cached) return cached.hulls;
    const rawMesh = this._extractSolidMesh(solid);
    if (!rawMesh) {
      this._decompositionCache.set(solid.uuid, { hulls: [] });
      return [];
    }
    let hulls = [];
    try {
      const vhacd = await this._loadVhacd();
      if (vhacd?.computeConvexHulls) {
        hulls = vhacd.computeConvexHulls(rawMesh, VHACD_OPTIONS) || [];
      }
    } catch (error) {
      console.warn('[SimulationWorkbench] Failed to decompose mesh with vhacd-js:', error);
    }
    if (!Array.isArray(hulls) || hulls.length === 0) {
      hulls = [rawMesh];
    }
    this._decompositionCache.set(solid.uuid, { hulls });
    return hulls;
  }

  _extractSolidMesh(solid) {
    let mesh = null;
    try {
      mesh = solid.getMesh?.();
      return normalizeMeshArrays(mesh);
    } catch {
      return null;
    } finally {
      try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch {}
    }
  }

  _buildProxyGroups() {
    this._clearProxyGroups();
    for (const solid of this._listSceneSolids()) {
      const record = this._decompositionCache.get(solid.uuid);
      const hulls = Array.isArray(record?.hulls) ? record.hulls : [];
      const group = this._createProxyGroup(solid, hulls);
      if (!group) continue;
      this._proxyGroups.set(solid.uuid, group);
      this._syncProxyGroupTransform(solid);
      try { this.viewer?.render?.(); } catch {}
    }
  }

  _createProxyGroup(solid, hulls) {
    const parent = solid.parent || this.viewer?.scene || null;
    if (!parent?.add || !Array.isArray(hulls) || hulls.length === 0) return null;
    const group = new THREE.Group();
    group.name = `${SIM_PROXY_PREFIX}:${solid.name || solid.uuid || ''}`;
    group.userData.excludeFromFit = false;
    group.userData.simulationProxy = true;
    group.visible = false;
    const metadataColor = this.viewer?.partHistory?.metadataManager?.getMetadata?.(solid.name || '')?.color || null;
    hulls.forEach((hull, index) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(hull.positions || []), 3));
      geometry.setIndex(Array.from(hull.indices || []));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, buildProxyMaterial(metadataColor, index, hulls.length));
      mesh.userData.excludeFromFit = false;
      mesh.userData.simulationProxy = true;
      mesh.userData.sourceSolidUuid = solid.uuid;
      group.add(mesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 20),
        new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 }),
      );
      edges.userData.excludeFromFit = false;
      edges.userData.simulationProxy = true;
      group.add(edges);
    });
    parent.add(group);
    return group;
  }

  _syncProxyGroupTransform(solid) {
    const group = this._proxyGroups.get(solid.uuid);
    if (!group) return;
    group.position.copy(solid.position);
    group.quaternion.copy(solid.quaternion);
    group.scale.copy(solid.scale);
    group.visible = false;
    group.updateMatrixWorld?.(true);
  }

  _clearProxyGroups() {
    for (const group of this._proxyGroups.values()) {
      try { group.parent?.remove?.(group); } catch {}
      disposeHierarchy(group);
    }
    this._proxyGroups.clear();
  }

  _setSourceSolidsVisible(visible) {
    for (const solid of this._listSceneSolids()) {
      if (visible) {
        solid.visible = this._sourceVisibility.get(solid.uuid) !== false;
      } else {
        solid.visible = false;
      }
    }
    for (const group of this._proxyGroups.values()) {
      group.visible = false;
    }
    try { this.viewer?.render?.(); } catch {}
  }

  async _rebuildPhysicsWorld() {
    if (!this._active) return;
    const [rapier] = await Promise.all([
      this._loadRapier(),
      Promise.all(this._listSceneSolids().map((solid) => this._ensureDecomposition(solid))),
    ]);
    if (!this._active || !rapier) return;
    this._destroyPhysicsWorld();
    this._bodyState.clear();
    const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    world.maxCcdSubsteps = 2;
    this._physicsWorld = world;
    const selectedSolid = this._transformSession?.solid || null;
    for (const solid of this._listSceneSolids()) {
      const bodyDesc = (selectedSolid && solid === selectedSolid)
        ? rapier.RigidBodyDesc.kinematicPositionBased()
        : (this.getSolidFixed(solid) ? rapier.RigidBodyDesc.fixed() : rapier.RigidBodyDesc.dynamic());
      const position = solid.getWorldPosition(new THREE.Vector3());
      const quaternion = solid.getWorldQuaternion(new THREE.Quaternion());
      bodyDesc.setTranslation(position.x, position.y, position.z);
      bodyDesc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
      bodyDesc.setLinearDamping(2.5);
      bodyDesc.setAngularDamping(2.5);
      bodyDesc.setCcdEnabled(true);
      const body = world.createRigidBody(bodyDesc);
      const hulls = this._decompositionCache.get(solid.uuid)?.hulls || [];
      for (const hull of hulls) {
        const collider = this._createColliderForHull(rapier, hull);
        if (!collider) continue;
        collider.setRestitution(0.05);
        collider.setFriction(0.9);
        world.createCollider(collider, body);
      }
      this._bodyState.set(solid.uuid, {
        solid,
        body,
        proxyGroup: this._proxyGroups.get(solid.uuid) || null,
      });
    }
  }

  _destroyPhysicsWorld() {
    try { this._physicsWorld?.free?.(); } catch {}
    this._physicsWorld = null;
    this._bodyState.clear();
  }

  _createColliderForHull(rapier, hull) {
    const positions = hull?.positions ? new Float32Array(hull.positions) : null;
    const indices = hull?.indices ? new Uint32Array(hull.indices) : null;
    if (!positions || positions.length < 9 || !indices || indices.length < 3) return null;
    const collider = rapier.ColliderDesc.convexMesh(positions, indices);
    if (collider) return collider;
    return rapier.ColliderDesc.convexHull(positions);
  }

  _ensurePhysicsLoop() {
    if (this._raf) return;
    this._lastStepTime = 0;
    const step = (ts) => {
      this._raf = 0;
      if (!this._active) return;
      this._stepPhysics(ts);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopPhysicsLoop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    this._lastStepTime = 0;
  }

  _stepPhysics(timestamp) {
    const world = this._physicsWorld;
    if (!world) return;
    const dt = this._lastStepTime > 0
      ? Math.min(1 / 20, Math.max(1 / 240, (timestamp - this._lastStepTime) / 1000))
      : 1 / 60;
    this._lastStepTime = timestamp;
    world.timestep = dt;

    const selectedSolid = this._transformSession?.solid || null;
    if (selectedSolid) {
      const bodyState = this._bodyState.get(selectedSolid.uuid);
      if (bodyState?.body) {
        const worldPosition = selectedSolid.getWorldPosition(new THREE.Vector3());
        const worldQuaternion = selectedSolid.getWorldQuaternion(new THREE.Quaternion());
        bodyState.body.setNextKinematicTranslation(worldPosition);
        bodyState.body.setNextKinematicRotation(worldQuaternion);
      }
    }

    world.step();
    let changed = false;
    for (const bodyState of this._bodyState.values()) {
      const { solid, body } = bodyState;
      if (!solid || !body) continue;
      if (selectedSolid && solid === selectedSolid) {
        this._syncProxyGroupTransform(solid);
        continue;
      }
      if (this.getSolidFixed(solid)) {
        this._syncProxyGroupTransform(solid);
        continue;
      }
      const translation = body.translation();
      const rotation = body.rotation();
      if (!translation || !rotation) continue;
      this._setSolidWorldPose(solid, translation, rotation);
      this._updateRuntimeTransformFromSolid(solid, { persist: false });
      changed = true;
    }
    if (changed) {
      try { this.viewer?.render?.(); } catch {}
    }
  }

  _setSolidWorldPose(solid, translation, rotation) {
    const parent = solid.parent || this.viewer?.scene || null;
    const scratch = this._scratch;
    scratch.worldPosition.set(translation.x, translation.y, translation.z);
    scratch.worldQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    if (parent?.isObject3D) {
      parent.updateMatrixWorld?.(true);
      scratch.parentInverse.copy(parent.matrixWorld).invert();
      parent.getWorldQuaternion(scratch.parentQuaternion);
      scratch.parentQuaternionInverse.copy(scratch.parentQuaternion).invert();
      scratch.localPosition.copy(scratch.worldPosition).applyMatrix4(scratch.parentInverse);
      solid.position.copy(scratch.localPosition);
      solid.quaternion.copy(scratch.parentQuaternionInverse.multiply(scratch.worldQuaternion));
    } else {
      solid.position.copy(scratch.worldPosition);
      solid.quaternion.copy(scratch.worldQuaternion);
    }
    solid.updateMatrixWorld?.(true);
    this._syncProxyGroupTransform(solid);
  }

  _startTransformSession(solid) {
    if (!solid || !this._active) return;
    this._stopTransformSession();
    const controls = new CombinedTransformControls(this.viewer.camera, this.viewer.renderer?.domElement);
    try { controls.setMode('translate'); } catch { controls.mode = 'translate'; }
    const target = new THREE.Object3D();
    target.name = `SimulationTransformTarget:${solid.name || solid.uuid || ''}`;
    this.viewer.scene.updateMatrixWorld?.(true);
    solid.updateMatrixWorld?.(true);
    const box = this._scratch.box;
    const center = box.setFromObject(this._proxyGroups.get(solid.uuid) || solid).isEmpty()
      ? solid.getWorldPosition(this._scratch.center)
      : box.getCenter(this._scratch.center);
    const worldPosition = solid.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = solid.getWorldQuaternion(new THREE.Quaternion());
    const offsetLocal = worldPosition.clone().sub(center).applyQuaternion(worldQuaternion.clone().invert());
    target.position.copy(center);
    target.quaternion.copy(worldQuaternion);
    this.viewer.scene.add(target);
    controls.attach(target);
    this.viewer.scene.add(controls);

    const applyToSolid = (persist = false) => {
      const targetWorldPosition = target.getWorldPosition(new THREE.Vector3());
      const targetWorldQuaternion = target.getWorldQuaternion(new THREE.Quaternion());
      const solidWorldPosition = targetWorldPosition.clone().add(offsetLocal.clone().applyQuaternion(targetWorldQuaternion));
      this._setSolidWorldPose(solid, solidWorldPosition, targetWorldQuaternion);
      this._updateRuntimeTransformFromSolid(solid, { persist });
      if (persist) {
        void this._rebuildPhysicsWorld();
      }
      try { this.viewer?.render?.(); } catch {}
    };

    const changeHandler = () => applyToSolid(false);
    const dragHandler = (event) => {
      const dragging = !!event?.value;
      try { if (this.viewer?.controls) this.viewer.controls.enabled = !dragging; } catch {}
      if (!dragging) applyToSolid(true);
    };
    const objectChangeHandler = () => {
      if (!controls.dragging) applyToSolid(true);
    };
    const updateForCamera = () => {
      try { controls.update?.(); } catch {}
    };
    const cameraChangeHandler = () => updateForCamera();
    controls.addEventListener('change', changeHandler);
    controls.addEventListener('dragging-changed', dragHandler);
    controls.addEventListener('objectChange', objectChangeHandler);
    try { this.viewer?.controls?.addEventListener?.('change', cameraChangeHandler); } catch {}

    const globalState = { controls, viewer: this.viewer, target, updateForCamera };
    try { window.__BREP_activeXform = globalState; } catch {}
    this._transformSession = {
      solid,
      controls,
      target,
      changeHandler,
      dragHandler,
      objectChangeHandler,
      cameraChangeHandler,
      globalState,
      mode: 'translate',
    };
    void this._rebuildPhysicsWorld();
    updateForCamera();
    applyToSolid(false);
  }

  _stopTransformSession() {
    const session = this._transformSession;
    if (!session) return;
    try { session.controls?.removeEventListener('change', session.changeHandler); } catch {}
    try { session.controls?.removeEventListener('dragging-changed', session.dragHandler); } catch {}
    try { session.controls?.removeEventListener('objectChange', session.objectChangeHandler); } catch {}
    try { this.viewer?.controls?.removeEventListener?.('change', session.cameraChangeHandler); } catch {}
    try { session.controls?.detach?.(); } catch {}
    try { this.viewer?.scene?.remove?.(session.controls); } catch {}
    try { this.viewer?.scene?.remove?.(session.target); } catch {}
    try { session.controls?.dispose?.(); } catch {}
    try {
      if (window.__BREP_activeXform === session.globalState) {
        window.__BREP_activeXform = null;
      }
    } catch {}
    this._transformSession = null;
    try { if (this.viewer?.controls) this.viewer.controls.enabled = true; } catch {}
    void this._rebuildPhysicsWorld();
    try { this.viewer?.render?.(); } catch {}
  }

  _listSceneSolids() {
    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene || null;
    const solids = [];
    if (!scene?.traverse) return solids;
    scene.traverse((obj) => {
      if (obj?.type === 'SOLID') solids.push(obj);
    });
    return solids;
  }
}
