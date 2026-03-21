import { Solid } from "../BREP/BetterSolid.js";
import {
    cppSolidCoreHasNativeManifoldPrep,
    cppSolidCoreHasNativeOffsetFace,
    cppSolidCoreHasNativePushFace,
    cppSolidCoreHasNativeWeldVerticesByEpsilon,
} from "../BREP/CppSolidCore.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

export async function test_cppSolidNative_setEpsilon_welds_vertices() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeWeldVerticesByEpsilon) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("FACE_A", [0, 0, 0], [1, 0, 0], [0, 1, 0])
        .addTriangle("FACE_B", [0, 0, 0], [0, 0, 1], [1, 0, 0])
        .addTriangle("FACE_C", [1, 0, 0], [0, 0, 1.0000001], [0, 1, 0])
        .addTriangle("FACE_D", [0, 0, 0], [0, 1, 0], [0, 0, 1.0000001]);

    const beforeVertices = solid._vertProperties.length / 3;
    if (beforeVertices !== 5) {
        throw new Error(`Expected 5 authored vertices before weld, received ${beforeVertices}.`);
    }

    solid.setEpsilon(1e-5);

    const afterVertices = solid._vertProperties.length / 3;
    if (afterVertices !== 4) {
        throw new Error(`Expected 4 authored vertices after weld, received ${afterVertices}.`);
    }
    if (solid._triVerts.length / 3 !== 4) {
        throw new Error(`Expected 4 triangles after weld, received ${solid._triVerts.length / 3}.`);
    }
}

export async function test_cppSolidNative_pushFace_updates_planar_face_vertices() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativePushFace) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 0, 0], [1, 1, 0])
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 1, 0], [0, 1, 0]);

    solid.pushFace("FACE_TOP", 0.25, { warnMissing: false, warnInvalidNormal: false });

    for (let i = 2; i < solid._vertProperties.length; i += 3) {
        if (!approx(solid._vertProperties[i], 0.25)) {
            throw new Error(`Expected FACE_TOP z=0.25 after native pushFace, received ${solid._vertProperties[i]} at index ${i}.`);
        }
    }
    if (solid._faceNameToID.get("FACE_TOP") !== solid._triIDs[0]) {
        throw new Error("Expected face ID mapping to remain stable after native pushFace.");
    }
}

export async function test_cppSolidNative_offsetFace_updates_planar_face_vertices() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeOffsetFace) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 0, 0], [1, 1, 0])
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 1, 0], [0, 1, 0]);

    solid.offsetFace("FACE_TOP", 0.25);

    for (let i = 2; i < solid._vertProperties.length; i += 3) {
        if (!approx(solid._vertProperties[i], 0.25)) {
            throw new Error(`Expected FACE_TOP z=0.25 after native offsetFace, received ${solid._vertProperties[i]} at index ${i}.`);
        }
    }
    if (solid._faceNameToID.get("FACE_TOP") !== solid._triIDs[0]) {
        throw new Error("Expected face ID mapping to remain stable after native offsetFace.");
    }
}

export async function test_cppSolidNative_invertNormals_and_manifoldize_rebuilds_coherent_mesh() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeManifoldPrep) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("F0", [0, 0, 0], [1, 0, 0], [0, 1, 0])
        .addTriangle("F1", [0, 0, 0], [1, 0, 0], [0, 0, 1])
        .addTriangle("F2", [1, 0, 0], [0, 1, 0], [0, 0, 1])
        .addTriangle("F3", [0, 1, 0], [0, 0, 0], [0, 0, 1]);

    if (solid._isCoherentlyOrientedManifold()) {
        throw new Error("Expected test fixture to begin with inconsistent winding.");
    }

    solid._manifoldize();

    if (!solid._isCoherentlyOrientedManifold()) {
        throw new Error("Expected native _manifoldize() to repair triangle winding coherence.");
    }
    if (!solid._manifold) {
        throw new Error("Expected native _manifoldize() to cache a manifold instance.");
    }
}
