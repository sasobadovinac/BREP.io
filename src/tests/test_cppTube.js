import { Tube, tubeHasNativeBuilder } from "../BREP/Tube.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

export async function test_cppTube_open_tube_preserves_expected_face_labels() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const tube = new Tube({
        points: [[0, 0, 0], [0, 20, 0], [10, 20, 0]],
        radius: 2,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_OPEN",
    });

    const faceNames = new Set(tube.getFaceNames());
    assert(faceNames.has("CPP_TUBE_OPEN_Outer"), "Expected open native tube to expose Outer face.");
    assert(faceNames.has("CPP_TUBE_OPEN_CapStart"), "Expected open native tube to expose CapStart face.");
    assert(faceNames.has("CPP_TUBE_OPEN_CapEnd"), "Expected open native tube to expose CapEnd face.");
    assert(!faceNames.has("CPP_TUBE_OPEN_Inner"), "Did not expect Inner face for solid native tube.");
    assert(tube.getTriangleCount() > 0, "Expected open native tube to contain triangles.");
}

export async function test_cppTube_closed_hollow_tube_preserves_expected_face_labels() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const tube = new Tube({
        points: [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 0]],
        radius: 3,
        innerRadius: 1,
        resolution: 24,
        closed: true,
        name: "CPP_TUBE_CLOSED",
    });

    const faceNames = new Set(tube.getFaceNames());
    assert(faceNames.has("CPP_TUBE_CLOSED_Outer"), "Expected closed native tube to expose Outer face.");
    assert(faceNames.has("CPP_TUBE_CLOSED_Inner"), "Expected closed hollow native tube to expose Inner face.");
    assert(!faceNames.has("CPP_TUBE_CLOSED_CapStart"), "Did not expect CapStart face for closed native tube.");
    assert(!faceNames.has("CPP_TUBE_CLOSED_CapEnd"), "Did not expect CapEnd face for closed native tube.");
    assert(Array.isArray(tube._auxEdges) && tube._auxEdges.length === 1, "Expected native tube to keep the centerline aux edge.");
    assert(tube._auxEdges[0]?.closedLoop === true, "Expected closed native tube centerline aux edge to be marked closed.");
    assert(tube.getTriangleCount() > 0, "Expected closed native tube to contain triangles.");
}

export async function test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const tubeA = new Tube({
        points: [[0, 0, 0], [0, 12, 0]],
        radius: 1.5,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_UNION_A",
    });
    const tubeB = new Tube({
        points: [[20, 0, 0], [20, 12, 0]],
        radius: 1.5,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_UNION_B",
    });

    const unioned = tubeA.union(tubeB);
    const faceNames = new Set(unioned.getFaceNames());
    assert(faceNames.has("CPP_TUBE_UNION_A_Outer"), "Expected unioned native tubes to preserve tube A Outer face.");
    assert(faceNames.has("CPP_TUBE_UNION_A_CapStart"), "Expected unioned native tubes to preserve tube A CapStart face.");
    assert(faceNames.has("CPP_TUBE_UNION_B_Outer"), "Expected unioned native tubes to preserve tube B Outer face.");
    assert(faceNames.has("CPP_TUBE_UNION_B_CapEnd"), "Expected unioned native tubes to preserve tube B CapEnd face.");
}
