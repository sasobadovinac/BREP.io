#include <emscripten/bind.h>

#include "brep_solid_core.h"

EMSCRIPTEN_BINDINGS(manifold_plus_solid_bindings) {
  emscripten::class_<manifoldplus::BrepSolidCore>("BrepSolidCore")
      .constructor<>()
      .function("clear", &manifoldplus::BrepSolidCore::Clear)
      .function("setAuthoringState", &manifoldplus::BrepSolidCore::SetAuthoringState)
      .function("getOrCreateFaceId",
                &manifoldplus::BrepSolidCore::GetOrCreateFaceId)
      .function("getPointIndex", &manifoldplus::BrepSolidCore::GetPointIndex)
      .function("addTriangle", &manifoldplus::BrepSolidCore::AddTriangle)
      .function("bakeTransform", &manifoldplus::BrepSolidCore::BakeTransform)
      .function("weldVerticesByEpsilon",
                &manifoldplus::BrepSolidCore::WeldVerticesByEpsilon)
      .function("offsetFace", &manifoldplus::BrepSolidCore::OffsetFace)
      .function("pushFace", &manifoldplus::BrepSolidCore::PushFace)
      .function("isCoherentlyOrientedManifold",
                &manifoldplus::BrepSolidCore::IsCoherentlyOrientedManifold)
      .function("fixTriangleWindingsByAdjacency",
                &manifoldplus::BrepSolidCore::FixTriangleWindingsByAdjacency)
      .function("invertNormals", &manifoldplus::BrepSolidCore::InvertNormals)
      .function("prepareManifoldMesh",
                &manifoldplus::BrepSolidCore::PrepareManifoldMesh)
      .function("setFaceMetadataJson",
                &manifoldplus::BrepSolidCore::SetFaceMetadataJson)
      .function("getFaceMetadataJson",
                &manifoldplus::BrepSolidCore::GetFaceMetadataJson)
      .function("setEdgeMetadataJson",
                &manifoldplus::BrepSolidCore::SetEdgeMetadataJson)
      .function("getEdgeMetadataJson",
                &manifoldplus::BrepSolidCore::GetEdgeMetadataJson)
      .function("getFaceNames", &manifoldplus::BrepSolidCore::GetFaceNames)
      .function("getAuthoringState",
                &manifoldplus::BrepSolidCore::GetAuthoringState)
      .function("vertexCount", &manifoldplus::BrepSolidCore::VertexCount)
      .function("triangleCount", &manifoldplus::BrepSolidCore::TriangleCount);
}
