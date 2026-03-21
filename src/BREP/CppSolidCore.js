import { Manifold } from "./SolidShared.js";
import { manifold } from "./setupManifold.js";

const parseMetadataJson = (raw) => {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
};

const cloneSnapshotEntries = (entries = []) => Array.from(entries || [], (entry) => [
    entry?.[0],
    entry?.[1],
]);

const toPlainEntryArray = (mapLike, serializer = (value) => value) => {
    if (!(mapLike instanceof Map)) return [];
    return Array.from(mapLike.entries(), ([key, value]) => [key, serializer(value)]);
};

const serializeMetadata = (metadata) => JSON.stringify(metadata && typeof metadata === "object" ? metadata : {});

const rebuildVertexKeyMap = (vertProperties = [], numProp = 3) => {
    const map = new Map();
    const stride = Math.max(3, Number(numProp) || 3);
    for (let i = 0; i + 2 < vertProperties.length; i += stride) {
        const x = vertProperties[i + 0];
        const y = vertProperties[i + 1];
        const z = vertProperties[i + 2];
        map.set(`${x},${y},${z}`, (i / stride) | 0);
    }
    return map;
};

export const cppSolidCoreHasAuthoringBridge = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.setAuthoringState === "function"
                && typeof probe.bakeTransform === "function"
                && typeof probe.getAuthoringState === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeWeldVerticesByEpsilon = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.weldVerticesByEpsilon === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeOffsetFace = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.offsetFace === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativePushFace = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.pushFace === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeManifoldPrep = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.prepareManifoldMesh === "function"
                && typeof probe.isCoherentlyOrientedManifold === "function"
                && typeof probe.fixTriangleWindingsByAdjacency === "function"
                && typeof probe.invertNormals === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const requireCppSolidCoreCapability = (supported, methodName) => {
    if (supported) return;
    throw new Error(`${methodName} requires the custom local manifold build with BrepSolidCore support.`);
};

export const buildSolidAuthoringStateSnapshot = (solid) => ({
    numProp: Number(solid?._numProp ?? 3),
    vertProperties: Array.from(solid?._vertProperties ?? []),
    triVerts: Array.from(solid?._triVerts ?? []),
    triIDs: Array.from(solid?._triIDs ?? []),
    faceNameToID: toPlainEntryArray(solid?._faceNameToID),
    idToFaceName: toPlainEntryArray(solid?._idToFaceName),
    faceMetadataJson: toPlainEntryArray(solid?._faceMetadata, serializeMetadata),
    edgeMetadataJson: toPlainEntryArray(solid?._edgeMetadata, serializeMetadata),
});

const invertFaceNameToIDEntries = (entries = []) => {
    const idToFaceName = new Map();
    for (const [faceName, id] of cloneSnapshotEntries(entries)) {
        idToFaceName.set(id, faceName);
    }
    return idToFaceName;
};

const buildResolvedSnapshotIDToFaceName = (snapshot) => {
    const triIDs = Array.from(snapshot?.triIDs ?? []);
    const triIDSet = new Set(triIDs);
    const triIDsSorted = Array.from(triIDSet).sort((a, b) => Number(a) - Number(b));

    let idToFaceName = new Map(cloneSnapshotEntries(snapshot?.idToFaceName));
    if (idToFaceName.size === 0) {
        idToFaceName = invertFaceNameToIDEntries(snapshot?.faceNameToID);
    }

    const coversAllTriangleIDs = triIDsSorted.every((id) => idToFaceName.has(id));
    if (coversAllTriangleIDs || triIDsSorted.length === 0) {
        return idToFaceName;
    }

    if (idToFaceName.size === triIDsSorted.length) {
        const orderedNames = Array.from(idToFaceName.entries())
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map((entry) => String(entry?.[1] || ""));
        const resolved = new Map();
        for (let i = 0; i < triIDsSorted.length; i++) {
            resolved.set(triIDsSorted[i], orderedNames[i] || `FACE_${triIDsSorted[i]}`);
        }
        return resolved;
    }

    for (const id of triIDsSorted) {
        if (!idToFaceName.has(id)) idToFaceName.set(id, `FACE_${id}`);
    }
    return idToFaceName;
};

const remapSnapshotFaceIDsToReservedRange = (snapshot) => {
    const sourceIDToFaceName = buildResolvedSnapshotIDToFaceName(snapshot);

    const remappedFaceNameToID = new Map();
    const remappedIDToFaceName = new Map();
    const idRemap = new Map();
    const ensureReservedID = (rawId, fallbackName = "") => {
        const key = Number(rawId);
        if (idRemap.has(key)) return idRemap.get(key);
        const reservedID = Manifold.reserveIDs(1);
        idRemap.set(key, reservedID);
        const faceName = String(sourceIDToFaceName.get(rawId) ?? fallbackName ?? "").trim() || `FACE_${reservedID}`;
        remappedIDToFaceName.set(reservedID, faceName);
        remappedFaceNameToID.set(faceName, reservedID);
        return reservedID;
    };

    for (const [rawId, faceName] of sourceIDToFaceName.entries()) {
        ensureReservedID(rawId, faceName);
    }

    const remappedTriIDs = Array.from(snapshot?.triIDs ?? [], (rawId) => ensureReservedID(rawId, sourceIDToFaceName.get(rawId)));

    return {
        triIDs: remappedTriIDs,
        faceNameToID: remappedFaceNameToID,
        idToFaceName: remappedIDToFaceName,
    };
};

export const applySolidAuthoringStateSnapshot = (solid, snapshot, opts = {}) => {
    const numProp = Math.max(3, Number(snapshot?.numProp ?? 3));
    const vertProperties = Array.from(snapshot?.vertProperties ?? []);
    const remappedIDs = opts?.remapFaceIDs ? remapSnapshotFaceIDsToReservedRange(snapshot) : null;
    solid._numProp = numProp;
    solid._vertProperties = vertProperties;
    solid._triVerts = Array.from(snapshot?.triVerts ?? []);
    solid._triIDs = remappedIDs ? remappedIDs.triIDs : Array.from(snapshot?.triIDs ?? []);
    solid._faceNameToID = remappedIDs ? remappedIDs.faceNameToID : new Map(cloneSnapshotEntries(snapshot?.faceNameToID));
    solid._idToFaceName = remappedIDs ? remappedIDs.idToFaceName : new Map(cloneSnapshotEntries(snapshot?.idToFaceName));
    solid._faceMetadata = new Map(Array.from(snapshot?.faceMetadataJson ?? [], (entry) => [
        entry?.[0],
        parseMetadataJson(entry?.[1]),
    ]));
    solid._edgeMetadata = new Map(Array.from(snapshot?.edgeMetadataJson ?? [], (entry) => [
        entry?.[0],
        parseMetadataJson(entry?.[1]),
    ]));
    solid._vertKeyToIndex = rebuildVertexKeyMap(vertProperties, numProp);
};

export const syncSolidAuthoringStateToCpp = (solid, core) => {
    core.setAuthoringState(buildSolidAuthoringStateSnapshot(solid));
    return core;
};

export const syncSolidAuthoringStateFromCpp = (solid, core) => {
    const snapshot = core.getAuthoringState();
    applySolidAuthoringStateSnapshot(solid, snapshot);
    return snapshot;
};

export class CppSolidCore {
    constructor(nativeCore = null) {
        if (nativeCore) {
            this._native = nativeCore;
            return;
        }
        if (typeof manifold?.BrepSolidCore !== "function") {
            throw new Error("BrepSolidCore is only available in the custom local manifold build.");
        }
        this._native = new manifold.BrepSolidCore();
    }

    clear() {
        this._native.clear();
        return this;
    }

    setAuthoringState(state) {
        this._native.setAuthoringState(state);
        return this;
    }

    addTriangle(faceName, v1, v2, v3) {
        this._native.addTriangle(faceName, v1, v2, v3);
        return this;
    }

    setFaceMetadata(faceName, metadata = {}) {
        this._native.setFaceMetadataJson(faceName, JSON.stringify(metadata || {}));
        return this;
    }

    getFaceMetadata(faceName) {
        return parseMetadataJson(this._native.getFaceMetadataJson(faceName));
    }

    setEdgeMetadata(edgeName, metadata = {}) {
        this._native.setEdgeMetadataJson(edgeName, JSON.stringify(metadata || {}));
        return this;
    }

    getEdgeMetadata(edgeName) {
        return parseMetadataJson(this._native.getEdgeMetadataJson(edgeName));
    }

    getFaceNames() {
        return Array.from(this._native.getFaceNames() || []);
    }

    getAuthoringState() {
        const snapshot = this._native.getAuthoringState();
        return {
            numProp: Number(snapshot?.numProp ?? 3),
            vertProperties: Array.from(snapshot?.vertProperties ?? []),
            triVerts: Array.from(snapshot?.triVerts ?? []),
            triIDs: Array.from(snapshot?.triIDs ?? []),
            faceNameToID: new Map(cloneSnapshotEntries(snapshot?.faceNameToID)),
            idToFaceName: new Map(cloneSnapshotEntries(snapshot?.idToFaceName)),
            faceMetadataJson: new Map(cloneSnapshotEntries(snapshot?.faceMetadataJson)),
            edgeMetadataJson: new Map(cloneSnapshotEntries(snapshot?.edgeMetadataJson)),
            vertexCount: Number(snapshot?.vertexCount ?? 0),
            triangleCount: Number(snapshot?.triangleCount ?? 0),
        };
    }

    bakeTransform(matrix) {
        const values = (matrix && typeof matrix === "object" && "elements" in matrix)
            ? Array.from(matrix.elements || [])
            : Array.from(matrix || []);
        this._native.bakeTransform(values);
        return this;
    }

    weldVerticesByEpsilon(epsilon) {
        this._native.weldVerticesByEpsilon(epsilon);
        return this;
    }

    offsetFace(faceName, distance) {
        return this._native.offsetFace(faceName, distance);
    }

    pushFace(faceName, distance) {
        return this._native.pushFace(faceName, distance);
    }

    isCoherentlyOrientedManifold() {
        return !!this._native.isCoherentlyOrientedManifold();
    }

    fixTriangleWindingsByAdjacency() {
        return !!this._native.fixTriangleWindingsByAdjacency();
    }

    invertNormals() {
        this._native.invertNormals();
        return this;
    }

    prepareManifoldMesh() {
        const snapshot = this._native.prepareManifoldMesh();
        return {
            numProp: Number(snapshot?.numProp ?? 3),
            vertProperties: Array.from(snapshot?.vertProperties ?? []),
            triVerts: Array.from(snapshot?.triVerts ?? []),
            faceID: Array.from(snapshot?.faceID ?? []),
            mergeFromVert: Array.from(snapshot?.mergeFromVert ?? []),
            mergeToVert: Array.from(snapshot?.mergeToVert ?? []),
            vertexCount: Number(snapshot?.vertexCount ?? 0),
            triangleCount: Number(snapshot?.triangleCount ?? 0),
        };
    }

    vertexCount() {
        return Number(this._native.vertexCount());
    }

    triangleCount() {
        return Number(this._native.triangleCount());
    }

    dispose() {
        try {
            if (this._native && typeof this._native.delete === "function") {
                this._native.delete();
            }
        } finally {
            this._native = null;
        }
    }
}
