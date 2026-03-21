import { Solid } from "../BREP/BetterSolid.js";
import { cppSolidCoreHasAuthoringBridge } from "../BREP/CppSolidCore.js";
import { THREE } from "../BREP/SolidShared.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

export async function test_cppSolidBakeTransform_updates_solid_authoring_state() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasAuthoringBridge) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 0, 0], [1, 1, 0])
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 1, 0], [0, 1, 0]);
    solid.addCenterline([0, 0, 0], [1, 0, 0], "CENTERLINE");
    solid.setFaceMetadata("FACE_TOP", {
        center: [0.5, 0.5, 0],
        axis: [1, 0, 0],
        kind: "planar",
    });

    const matrix = new THREE.Matrix4()
        .makeRotationZ(Math.PI / 2)
        .setPosition(3, 4, 5);

    const expectedVertices = [
        3, 4, 5,
        3, 5, 5,
        2, 5, 5,
        2, 4, 5,
    ];

    solid.bakeTransform(matrix);

    if (solid._vertProperties.length !== expectedVertices.length) {
        throw new Error(`Expected ${expectedVertices.length / 3} transformed vertices, received ${solid._vertProperties.length / 3}.`);
    }
    for (let i = 0; i < expectedVertices.length; i++) {
        if (!approx(solid._vertProperties[i], expectedVertices[i])) {
            throw new Error(`Solid vertex mismatch at index ${i}: expected ${expectedVertices[i]}, received ${solid._vertProperties[i]}.`);
        }
    }

    if (solid._faceNameToID.get("FACE_TOP") !== solid._triIDs[0]) {
        throw new Error("Solid face ID mapping was not preserved after native bakeTransform.");
    }

    const faceMeta = solid.getFaceMetadata("FACE_TOP");
    if (!approx(faceMeta.center?.[0], 2.5) || !approx(faceMeta.center?.[1], 4.5) || !approx(faceMeta.center?.[2], 5)) {
        throw new Error(`Expected transformed face center [2.5, 4.5, 5], received ${JSON.stringify(faceMeta.center)}.`);
    }
    if (!approx(faceMeta.axis?.[0], 0) || !approx(faceMeta.axis?.[1], 1) || !approx(faceMeta.axis?.[2], 0)) {
        throw new Error(`Expected transformed face axis [0, 1, 0], received ${JSON.stringify(faceMeta.axis)}.`);
    }

    const auxPoints = solid._auxEdges?.[0]?.points || [];
    if (auxPoints.length !== 2) {
        throw new Error("Expected transformed auxiliary edge points to remain available.");
    }
    if (!approx(auxPoints[0]?.[0], 3) || !approx(auxPoints[0]?.[1], 4) || !approx(auxPoints[0]?.[2], 5)) {
        throw new Error(`Unexpected transformed auxiliary edge start point: ${JSON.stringify(auxPoints[0])}.`);
    }
    if (!approx(auxPoints[1]?.[0], 3) || !approx(auxPoints[1]?.[1], 5) || !approx(auxPoints[1]?.[2], 5)) {
        throw new Error(`Unexpected transformed auxiliary edge end point: ${JSON.stringify(auxPoints[1])}.`);
    }
}
