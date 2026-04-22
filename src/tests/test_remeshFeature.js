import { RemeshFeature } from "../features/remesh/RemeshFeature.js";

export async function test_remesh_simplify_welds_by_tolerance_before_simplify() {
    const callLog = [];

    const outSolid = {
        type: "SOLID",
        simplify(tolerance) {
            callLog.push(["simplify", tolerance]);
            return this;
        },
        _weldVerticesByEpsilon(epsilon, options) {
            callLog.push(["weld", epsilon, options?.rebuildManifold]);
            if (options?.rebuildManifold !== false) {
                throw new Error("Expected pre-simplify weld to skip immediate manifold rebuild.");
            }
            return this;
        },
        fixTriangleWindingsByAdjacency() {
            callLog.push(["fixWindings"]);
            return this;
        },
        visualize() {
            callLog.push(["visualize"]);
        },
    };

    const targetSolid = {
        type: "SOLID",
        name: "REMESH_SRC",
        clone() {
            callLog.push(["clone"]);
            return outSolid;
        },
    };

    const fakeHistory = {
        scene: {
            async getObjectByName(name) {
                return name === "REMESH_SRC" ? targetSolid : null;
            },
        },
    };

    const feature = new RemeshFeature();
    feature.inputParams = {
        targetSolid: "REMESH_SRC",
        mode: "Simplify",
        tolerance: 0.05,
    };

    const effects = await feature.run(fakeHistory);
    if (!Array.isArray(effects?.added) || effects.added[0] !== outSolid) {
        throw new Error("Expected remesh simplify feature to return the cloned output solid.");
    }
    if (!Array.isArray(effects?.removed) || effects.removed[0] !== targetSolid) {
        throw new Error("Expected remesh simplify feature to mark the source solid for removal.");
    }

    const operationLog = callLog.map((entry) => {
        const [name, value, extra] = entry;
        if (name === "weld") return `${name}:${value}:${String(extra)}`;
        return value === undefined ? name : `${name}:${value}`;
    });
    const expected = ["clone", "weld:0.05:false", "fixWindings", "simplify:0.05", "visualize"];
    if (operationLog.join("|") !== expected.join("|")) {
        throw new Error(
            `Expected remesh simplify to weld before simplify using the same tolerance; received ${operationLog.join("|")}.`,
        );
    }
}
