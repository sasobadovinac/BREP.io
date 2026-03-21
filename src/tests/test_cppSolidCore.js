import { CppSolidCore } from "../BREP/CppSolidCore.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

export async function test_cppSolidCore_preserves_face_ids_and_metadata() {
    if (manifoldBuildSource !== "local") {
        return;
    }
    const core = new CppSolidCore();
    try {
        core
            .addTriangle("FACE_A", [0, 0, 0], [1, 0, 0], [0, 1, 0])
            .addTriangle("FACE_A", [0, 0, 0], [0, 1, 0], [0, 0, 1])
            .addTriangle("FACE_B", [0, 0, 0], [1, 0, 0], [0, 0, 1]);

        core.setFaceMetadata("FACE_A", { radius: 12.5, kind: "cylindrical" });
        core.setEdgeMetadata("FACE_A|FACE_B[0]", { smooth: false });

        const snapshot = core.getAuthoringState();
        if (snapshot.vertexCount !== 4) {
            throw new Error(`Expected 4 unique vertices, received ${snapshot.vertexCount}.`);
        }
        if (snapshot.triangleCount !== 3) {
            throw new Error(`Expected 3 triangles, received ${snapshot.triangleCount}.`);
        }

        const faceAId = snapshot.faceNameToID.get("FACE_A");
        const faceBId = snapshot.faceNameToID.get("FACE_B");
        if (!Number.isFinite(faceAId) || !Number.isFinite(faceBId) || faceAId === faceBId) {
            throw new Error("Expected distinct preserved face IDs for FACE_A and FACE_B.");
        }

        if (snapshot.idToFaceName.get(faceAId) !== "FACE_A") {
            throw new Error("FACE_A ID did not round-trip through the C++ core.");
        }
        if (snapshot.idToFaceName.get(faceBId) !== "FACE_B") {
            throw new Error("FACE_B ID did not round-trip through the C++ core.");
        }

        const faceMeta = core.getFaceMetadata("FACE_A");
        if (faceMeta.radius !== 12.5 || faceMeta.kind !== "cylindrical") {
            throw new Error("Face metadata did not round-trip through the C++ core.");
        }

        const edgeMeta = core.getEdgeMetadata("FACE_A|FACE_B[0]");
        if (edgeMeta.smooth !== false) {
            throw new Error("Edge metadata did not round-trip through the C++ core.");
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_setAuthoringState_and_bakeTransform() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ],
            triVerts: [0, 1, 2],
            triIDs: [42],
            faceNameToID: [["FACE_A", 42]],
            idToFaceName: [[42, "FACE_A"]],
            faceMetadataJson: [["FACE_A", JSON.stringify({ kind: "planar" })]],
            edgeMetadataJson: [["FACE_A|EDGE_0", JSON.stringify({ smooth: true })]],
        });

        core.bakeTransform([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            5, -2, 3, 1,
        ]);

        const snapshot = core.getAuthoringState();
        const expectedVerts = [
            5, -2, 3,
            6, -2, 3,
            5, -1, 3,
        ];
        if (snapshot.vertProperties.length !== expectedVerts.length) {
            throw new Error("Unexpected transformed vertex buffer length.");
        }
        for (let i = 0; i < expectedVerts.length; i++) {
            if (Math.abs(snapshot.vertProperties[i] - expectedVerts[i]) > 1e-6) {
                throw new Error(`Transformed vertex mismatch at index ${i}: expected ${expectedVerts[i]}, received ${snapshot.vertProperties[i]}.`);
            }
        }

        if (snapshot.faceNameToID.get("FACE_A") !== 42) {
            throw new Error("Face name to ID mapping was not preserved across setAuthoringState/bakeTransform.");
        }
        if (snapshot.idToFaceName.get(42) !== "FACE_A") {
            throw new Error("Face ID to name mapping was not preserved across setAuthoringState/bakeTransform.");
        }
        if (core.getFaceMetadata("FACE_A").kind !== "planar") {
            throw new Error("Face metadata was not preserved across setAuthoringState/bakeTransform.");
        }
        if (core.getEdgeMetadata("FACE_A|EDGE_0").smooth !== true) {
            throw new Error("Edge metadata was not preserved across setAuthoringState/bakeTransform.");
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_weldVerticesByEpsilon_compacts_authoring_buffers() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
                1.0000001, 0, 0,
            ],
            triVerts: [0, 1, 2, 0, 3, 2],
            triIDs: [7, 7],
            faceNameToID: [["FACE_A", 7]],
            idToFaceName: [[7, "FACE_A"]],
            faceMetadataJson: [],
            edgeMetadataJson: [],
        });

        core.weldVerticesByEpsilon(1e-5);
        const snapshot = core.getAuthoringState();

        if (snapshot.vertexCount !== 3) {
            throw new Error(`Expected 3 welded vertices, received ${snapshot.vertexCount}.`);
        }
        if (snapshot.triangleCount !== 2) {
            throw new Error(`Expected 2 triangles after weld, received ${snapshot.triangleCount}.`);
        }
        if (snapshot.faceNameToID.get("FACE_A") !== 7 || snapshot.idToFaceName.get(7) !== "FACE_A") {
            throw new Error("Face mappings were not preserved across weldVerticesByEpsilon.");
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_pushFace_moves_vertices_for_face() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                1, 1, 0,
                0, 1, 0,
            ],
            triVerts: [0, 1, 2, 0, 2, 3],
            triIDs: [9, 9],
            faceNameToID: [["FACE_TOP", 9]],
            idToFaceName: [[9, "FACE_TOP"]],
            faceMetadataJson: [],
            edgeMetadataJson: [],
        });

        const result = core.pushFace("FACE_TOP", 0.25);
        if (!result?.faceFound || !result?.moved) {
            throw new Error(`Expected pushFace to move FACE_TOP, received ${JSON.stringify(result)}.`);
        }

        const snapshot = core.getAuthoringState();
        const expectedZ = 0.25;
        for (let i = 2; i < snapshot.vertProperties.length; i += 3) {
            if (Math.abs(snapshot.vertProperties[i] - expectedZ) > 1e-6) {
                throw new Error(`Expected pushed face z=${expectedZ}, received ${snapshot.vertProperties[i]} at index ${i}.`);
            }
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_offsetFace_moves_vertices_for_face() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                1, 1, 0,
                0, 1, 0,
            ],
            triVerts: [0, 1, 2, 0, 2, 3],
            triIDs: [12, 12],
            faceNameToID: [["FACE_TOP", 12]],
            idToFaceName: [[12, "FACE_TOP"]],
            faceMetadataJson: [],
            edgeMetadataJson: [],
        });

        const result = core.offsetFace("FACE_TOP", 0.5);
        if (!result?.faceFound || !result?.moved) {
            throw new Error(`Expected offsetFace to move FACE_TOP, received ${JSON.stringify(result)}.`);
        }

        const snapshot = core.getAuthoringState();
        for (let i = 2; i < snapshot.vertProperties.length; i += 3) {
            if (Math.abs(snapshot.vertProperties[i] - 0.5) > 1e-6) {
                throw new Error(`Expected offset face z=0.5, received ${snapshot.vertProperties[i]} at index ${i}.`);
            }
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_prepareManifoldMesh_repairs_orientation() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
                0, 0, 1,
            ],
            triVerts: [
                0, 1, 2,
                0, 1, 3,
                1, 2, 3,
                2, 0, 3,
            ],
            triIDs: [21, 22, 23, 24],
            faceNameToID: [
                ["F0", 21],
                ["F1", 22],
                ["F2", 23],
                ["F3", 24],
            ],
            idToFaceName: [
                [21, "F0"],
                [22, "F1"],
                [23, "F2"],
                [24, "F3"],
            ],
            faceMetadataJson: [],
            edgeMetadataJson: [],
        });

        if (core.isCoherentlyOrientedManifold()) {
            throw new Error("Expected tetrahedron with inconsistent winding to start incoherent.");
        }

        const prepared = core.prepareManifoldMesh();
        if (!core.isCoherentlyOrientedManifold()) {
            throw new Error("Expected prepareManifoldMesh to repair triangle winding coherence.");
        }
        if ((prepared?.triangleCount ?? 0) !== 4 || (prepared?.vertexCount ?? 0) !== 4) {
            throw new Error(`Unexpected prepared manifold mesh counts: ${JSON.stringify(prepared)}.`);
        }
        if (!Array.isArray(prepared?.triVerts) || prepared.triVerts.length !== 12) {
            throw new Error("Expected prepareManifoldMesh to return triangle indices.");
        }
        if (!Array.isArray(prepared?.faceID) || prepared.faceID.length !== 4) {
            throw new Error("Expected prepareManifoldMesh to preserve triangle face IDs.");
        }
        if (!Array.isArray(prepared?.mergeFromVert) || !Array.isArray(prepared?.mergeToVert)) {
            throw new Error("Expected prepareManifoldMesh to expose merge arrays.");
        }
        if (prepared.mergeFromVert.length !== prepared.mergeToVert.length) {
            throw new Error("Expected prepareManifoldMesh merge arrays to stay aligned.");
        }
    } finally {
        core.dispose();
    }
}
