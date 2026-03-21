#include "brep_solid_core.h"

#include <manifold/manifold.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace manifoldplus {

namespace {

double ReadNumericProperty(const emscripten::val& point, const char* name,
                           uint32_t index) {
  const emscripten::val indexed = point[index];
  if (!indexed.isUndefined() && !indexed.isNull()) {
    return indexed.as<double>();
  }

  const emscripten::val named = point[name];
  if (!named.isUndefined() && !named.isNull()) {
    return named.as<double>();
  }

  throw std::runtime_error(std::string("Point is missing coordinate: ") + name);
}

}  // namespace

void BrepSolidCore::Clear() {
  vert_properties_.clear();
  tri_verts_.clear();
  tri_ids_.clear();
  vert_key_to_index_.clear();
  face_name_to_id_.clear();
  id_to_face_name_.clear();
  face_metadata_json_.clear();
  edge_metadata_json_.clear();
}

void BrepSolidCore::SetAuthoringState(const emscripten::val& snapshot) {
  Clear();

  const emscripten::val num_prop_val = snapshot["numProp"];
  if (!num_prop_val.isUndefined() && !num_prop_val.isNull()) {
    const double num_prop = num_prop_val.as<double>();
    if (!std::isfinite(num_prop) || num_prop < 3.0) {
      throw std::runtime_error("Authoring state numProp must be finite and >= 3.");
    }
    num_prop_ = static_cast<uint32_t>(num_prop);
  }

  vert_properties_ = ReadFloatArray(snapshot["vertProperties"], "vertProperties");
  tri_verts_ = ReadUint32Array(snapshot["triVerts"], "triVerts");
  tri_ids_ = ReadUint32Array(snapshot["triIDs"], "triIDs");
  face_name_to_id_ =
      ReadStringUint32Map(snapshot["faceNameToID"], "faceNameToID");
  id_to_face_name_ =
      ReadUint32StringMap(snapshot["idToFaceName"], "idToFaceName");
  face_metadata_json_ =
      ReadStringMap(snapshot["faceMetadataJson"], "faceMetadataJson");
  edge_metadata_json_ =
      ReadStringMap(snapshot["edgeMetadataJson"], "edgeMetadataJson");

  if (num_prop_ == 0 || (vert_properties_.size() % num_prop_) != 0) {
    throw std::runtime_error(
        "Authoring state vertProperties length must be a multiple of numProp.");
  }
  if ((tri_verts_.size() % 3) != 0) {
    throw std::runtime_error(
        "Authoring state triVerts length must be a multiple of 3.");
  }
  if (tri_ids_.size() != (tri_verts_.size() / 3)) {
    throw std::runtime_error(
        "Authoring state triIDs length must match the triangle count.");
  }

  if (id_to_face_name_.empty() && !face_name_to_id_.empty()) {
    for (const auto& entry : face_name_to_id_) {
      id_to_face_name_[entry.second] = entry.first;
    }
  } else if (face_name_to_id_.empty() && !id_to_face_name_.empty()) {
    for (const auto& entry : id_to_face_name_) {
      face_name_to_id_[entry.second] = entry.first;
    }
  }

  RebuildVertexKeyIndex();
}

uint32_t BrepSolidCore::GetOrCreateFaceId(const std::string& face_name) {
  const auto found = face_name_to_id_.find(face_name);
  if (found != face_name_to_id_.end()) return found->second;

  const uint32_t id = manifold::Manifold::ReserveIDs(1);
  face_name_to_id_[face_name] = id;
  id_to_face_name_[id] = face_name;
  return id;
}

uint32_t BrepSolidCore::GetPointIndex(const emscripten::val& point) {
  double x = 0;
  double y = 0;
  double z = 0;
  ReadPoint(point, x, y, z);

  const std::string key = MakeVertexKey(x, y, z);
  const auto found = vert_key_to_index_.find(key);
  if (found != vert_key_to_index_.end()) return found->second;

  const uint32_t index = static_cast<uint32_t>(vert_properties_.size() / 3);
  vert_properties_.push_back(static_cast<float>(x));
  vert_properties_.push_back(static_cast<float>(y));
  vert_properties_.push_back(static_cast<float>(z));
  vert_key_to_index_[key] = index;
  return index;
}

void BrepSolidCore::AddTriangle(const std::string& face_name,
                                const emscripten::val& v1,
                                const emscripten::val& v2,
                                const emscripten::val& v3) {
  const uint32_t id = GetOrCreateFaceId(face_name);
  tri_verts_.push_back(GetPointIndex(v1));
  tri_verts_.push_back(GetPointIndex(v2));
  tri_verts_.push_back(GetPointIndex(v3));
  tri_ids_.push_back(id);
}

void BrepSolidCore::BakeTransform(const emscripten::val& matrix_values) {
  const uint32_t length = matrix_values["length"].as<uint32_t>();
  if (length < 16) {
    throw std::runtime_error(
        "BakeTransform requires a 4x4 matrix array with 16 numeric elements.");
  }

  double e[16];
  for (uint32_t i = 0; i < 16; ++i) {
    const double value = matrix_values[i].as<double>();
    if (!std::isfinite(value)) {
      throw std::runtime_error(
          "BakeTransform matrix elements must be finite numbers.");
    }
    e[i] = value;
  }

  const uint32_t vertex_count = VertexCount();
  for (uint32_t i = 0; i < vertex_count; ++i) {
    const uint32_t base = i * num_prop_;
    const double x = vert_properties_[base + 0];
    const double y = vert_properties_[base + 1];
    const double z = vert_properties_[base + 2];
    vert_properties_[base + 0] =
        static_cast<float>(e[0] * x + e[4] * y + e[8] * z + e[12]);
    vert_properties_[base + 1] =
        static_cast<float>(e[1] * x + e[5] * y + e[9] * z + e[13]);
    vert_properties_[base + 2] =
        static_cast<float>(e[2] * x + e[6] * y + e[10] * z + e[14]);
  }

  RebuildVertexKeyIndex();
}

void BrepSolidCore::WeldVerticesByEpsilon(double eps) {
  if (!std::isfinite(eps) || eps <= 0.0) return;

  const uint32_t nv = VertexCount();
  if (nv == 0) return;

  std::unordered_map<std::string, uint32_t> cell_map;
  cell_map.reserve(nv);

  std::vector<uint32_t> rep_of(nv);
  for (uint32_t i = 0; i < nv; ++i) rep_of[i] = i;
  bool changed = false;

  const auto to_cell = [eps](double value) {
    return std::llround(value / eps);
  };

  for (uint32_t i = 0; i < nv; ++i) {
    const uint32_t base = i * num_prop_;
    const long long cx = to_cell(vert_properties_[base + 0]);
    const long long cy = to_cell(vert_properties_[base + 1]);
    const long long cz = to_cell(vert_properties_[base + 2]);

    std::ostringstream key_stream;
    key_stream << cx << ',' << cy << ',' << cz;
    const std::string key = key_stream.str();

    const auto found = cell_map.find(key);
    if (found == cell_map.end()) {
      cell_map.emplace(key, i);
      rep_of[i] = i;
    } else {
      rep_of[i] = found->second;
      changed = true;
    }
  }

  std::vector<uint32_t> new_tri_verts;
  std::vector<uint32_t> new_tri_ids;
  new_tri_verts.reserve(tri_verts_.size());
  new_tri_ids.reserve(tri_ids_.size());
  std::vector<uint8_t> used(nv, 0);

  for (uint32_t tri_idx = 0; tri_idx < tri_ids_.size(); ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    if (tri_base + 2 >= tri_verts_.size()) break;

    const uint32_t a = rep_of[tri_verts_[tri_base + 0]];
    const uint32_t b = rep_of[tri_verts_[tri_base + 1]];
    const uint32_t c = rep_of[tri_verts_[tri_base + 2]];
    if (a == b || b == c || c == a) continue;

    const uint32_t abase = a * num_prop_;
    const uint32_t bbase = b * num_prop_;
    const uint32_t cbase = c * num_prop_;

    const double ax = vert_properties_[abase + 0];
    const double ay = vert_properties_[abase + 1];
    const double az = vert_properties_[abase + 2];
    const double bx = vert_properties_[bbase + 0];
    const double by = vert_properties_[bbase + 1];
    const double bz = vert_properties_[bbase + 2];
    const double cx = vert_properties_[cbase + 0];
    const double cy = vert_properties_[cbase + 1];
    const double cz = vert_properties_[cbase + 2];

    const double ux = bx - ax;
    const double uy = by - ay;
    const double uz = bz - az;
    const double vx = cx - ax;
    const double vy = cy - ay;
    const double vz = cz - az;
    const double nx = uy * vz - uz * vy;
    const double ny = uz * vx - ux * vz;
    const double nz = ux * vy - uy * vx;
    const double area2 = nx * nx + ny * ny + nz * nz;
    if (!(area2 > 0.0)) continue;

    new_tri_verts.push_back(a);
    new_tri_verts.push_back(b);
    new_tri_verts.push_back(c);
    new_tri_ids.push_back(tri_ids_[tri_idx]);
    used[a] = 1;
    used[b] = 1;
    used[c] = 1;
  }

  if (!changed && new_tri_verts.size() == tri_verts_.size() &&
      new_tri_ids.size() == tri_ids_.size()) {
    return;
  }

  std::vector<int32_t> old_to_new(nv, -1);
  std::vector<float> new_vert_properties;
  new_vert_properties.reserve(vert_properties_.size());

  uint32_t write = 0;
  for (uint32_t i = 0; i < nv; ++i) {
    if (!used[i]) continue;
    old_to_new[i] = static_cast<int32_t>(write++);
    const uint32_t base = i * num_prop_;
    for (uint32_t prop = 0; prop < num_prop_; ++prop) {
      new_vert_properties.push_back(vert_properties_[base + prop]);
    }
  }

  for (uint32_t& index : new_tri_verts) {
    index = static_cast<uint32_t>(old_to_new[index]);
  }

  vert_properties_.swap(new_vert_properties);
  tri_verts_.swap(new_tri_verts);
  tri_ids_.swap(new_tri_ids);
  RebuildVertexKeyIndex();
}

emscripten::val BrepSolidCore::OffsetFace(const std::string& face_name,
                                          double distance) {
  emscripten::val result = emscripten::val::object();
  result.set("faceFound", false);
  result.set("moved", false);
  result.set("invalidNormal", false);

  if (!std::isfinite(distance) || distance == 0.0) return result;

  const auto face_found = face_name_to_id_.find(face_name);
  if (face_found == face_name_to_id_.end()) return result;
  result.set("faceFound", true);

  const uint32_t face_id = face_found->second;
  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_ids_.size()),
               static_cast<uint32_t>(tri_verts_.size() / 3));
  const uint32_t nv = VertexCount();
  if (tri_count == 0 || nv == 0) return result;

  double nx = 0.0;
  double ny = 0.0;
  double nz = 0.0;
  std::vector<uint8_t> affected(nv, 0);

  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    if (tri_ids_[tri_idx] != face_id) continue;

    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = tri_verts_[tri_base + 0];
    const uint32_t i1 = tri_verts_[tri_base + 1];
    const uint32_t i2 = tri_verts_[tri_base + 2];
    if (i0 >= nv || i1 >= nv || i2 >= nv) continue;

    affected[i0] = 1;
    affected[i1] = 1;
    affected[i2] = 1;

    const uint32_t a = i0 * num_prop_;
    const uint32_t b = i1 * num_prop_;
    const uint32_t c = i2 * num_prop_;

    const double ax = vert_properties_[a + 0];
    const double ay = vert_properties_[a + 1];
    const double az = vert_properties_[a + 2];
    const double bx = vert_properties_[b + 0];
    const double by = vert_properties_[b + 1];
    const double bz = vert_properties_[b + 2];
    const double cx = vert_properties_[c + 0];
    const double cy = vert_properties_[c + 1];
    const double cz = vert_properties_[c + 2];

    const double ux = bx - ax;
    const double uy = by - ay;
    const double uz = bz - az;
    const double vx = cx - ax;
    const double vy = cy - ay;
    const double vz = cz - az;
    nx += uy * vz - uz * vy;
    ny += uz * vx - ux * vz;
    nz += ux * vy - uy * vx;
  }

  const double len = std::hypot(nx, ny, nz);
  if (!(len > 0.0)) {
    result.set("invalidNormal", true);
    return result;
  }

  const double dx = nx * (distance / len);
  const double dy = ny * (distance / len);
  const double dz = nz * (distance / len);
  uint32_t moved = 0;
  for (uint32_t i = 0; i < nv; ++i) {
    if (!affected[i]) continue;
    const uint32_t base = i * num_prop_;
    vert_properties_[base + 0] += static_cast<float>(dx);
    vert_properties_[base + 1] += static_cast<float>(dy);
    vert_properties_[base + 2] += static_cast<float>(dz);
    moved++;
  }

  if (moved == 0) return result;
  RebuildVertexKeyIndex();
  result.set("moved", true);
  return result;
}

bool BrepSolidCore::IsCoherentlyOrientedManifold() const {
  const uint32_t tri_count = static_cast<uint32_t>(tri_verts_.size() / 3);
  const uint32_t vertex_count = VertexCount();
  if (tri_count == 0 || vertex_count == 0) return false;

  struct EdgeUse {
    uint32_t a = 0;
    uint32_t b = 0;
  };

  std::unordered_map<std::string, std::vector<EdgeUse>> edge_map;
  edge_map.reserve(tri_count * 3);
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = tri_verts_[tri_base + 0];
    const uint32_t i1 = tri_verts_[tri_base + 1];
    const uint32_t i2 = tri_verts_[tri_base + 2];
    const std::array<std::array<uint32_t, 2>, 3> edges = {
        std::array<uint32_t, 2>{i0, i1},
        std::array<uint32_t, 2>{i1, i2},
        std::array<uint32_t, 2>{i2, i0},
    };
    for (const auto& edge : edges) {
      edge_map[MakeUndirectedEdgeKey(edge[0], edge[1])].push_back(
          {edge[0], edge[1]});
    }
  }

  for (const auto& entry : edge_map) {
    const auto& uses = entry.second;
    if (uses.size() != 2) return false;
    if (!(uses[0].a == uses[1].b && uses[0].b == uses[1].a)) return false;
  }
  return true;
}

bool BrepSolidCore::FixTriangleWindingsByAdjacency() {
  const uint32_t tri_count = static_cast<uint32_t>(tri_verts_.size() / 3);
  const uint32_t vertex_count = VertexCount();
  if (tri_count == 0 || vertex_count == 0) return false;
  if (IsCoherentlyOrientedManifold()) return false;

  struct EdgeUse {
    uint32_t tri = 0;
    uint32_t a = 0;
    uint32_t b = 0;
  };

  std::vector<std::array<uint32_t, 3>> tris(tri_count);
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    tris[tri_idx] = {tri_verts_[tri_base + 0], tri_verts_[tri_base + 1],
                     tri_verts_[tri_base + 2]};
  }

  std::unordered_map<std::string, std::vector<EdgeUse>> edge_map;
  edge_map.reserve(tri_count * 3);
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const auto& tri = tris[tri_idx];
    const std::array<std::array<uint32_t, 2>, 3> edges = {
        std::array<uint32_t, 2>{tri[0], tri[1]},
        std::array<uint32_t, 2>{tri[1], tri[2]},
        std::array<uint32_t, 2>{tri[2], tri[0]},
    };
    for (const auto& edge : edges) {
      edge_map[MakeUndirectedEdgeKey(edge[0], edge[1])].push_back(
          {tri_idx, edge[0], edge[1]});
    }
  }

  std::vector<uint8_t> visited(tri_count, 0);
  std::vector<uint32_t> stack;
  stack.reserve(tri_count);
  bool changed = false;

  for (uint32_t seed = 0; seed < tri_count; ++seed) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    stack.push_back(seed);

    while (!stack.empty()) {
      const uint32_t tri_idx = stack.back();
      stack.pop_back();
      auto& tri = tris[tri_idx];
      const std::array<std::array<uint32_t, 2>, 3> edges = {
          std::array<uint32_t, 2>{tri[0], tri[1]},
          std::array<uint32_t, 2>{tri[1], tri[2]},
          std::array<uint32_t, 2>{tri[2], tri[0]},
      };
      for (const auto& edge : edges) {
        const auto found =
            edge_map.find(MakeUndirectedEdgeKey(edge[0], edge[1]));
        if (found == edge_map.end()) continue;
        const auto& adjacent = found->second;
        if (adjacent.size() < 2) continue;

        for (const auto& use : adjacent) {
          if (use.tri == tri_idx || visited[use.tri]) continue;
          auto& neighbor = tris[use.tri];
          if (use.a == edge[0] && use.b == edge[1]) {
            std::swap(neighbor[1], neighbor[2]);
            changed = true;
          }
          visited[use.tri] = 1;
          stack.push_back(use.tri);
        }
      }
    }
  }

  if (!changed) return false;

  tri_verts_.clear();
  tri_verts_.reserve(tri_count * 3);
  for (const auto& tri : tris) {
    tri_verts_.push_back(tri[0]);
    tri_verts_.push_back(tri[1]);
    tri_verts_.push_back(tri[2]);
  }
  return true;
}

void BrepSolidCore::InvertNormals() {
  for (uint32_t tri_base = 0; tri_base + 2 < tri_verts_.size(); tri_base += 3) {
    std::swap(tri_verts_[tri_base + 1], tri_verts_[tri_base + 2]);
  }
}

emscripten::val BrepSolidCore::PrepareManifoldMesh() {
  FixTriangleWindingsByAdjacency();

  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_ids_.size()),
               static_cast<uint32_t>(tri_verts_.size() / 3));
  double signed_volume = 0.0;
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = tri_verts_[tri_base + 0];
    const uint32_t i1 = tri_verts_[tri_base + 1];
    const uint32_t i2 = tri_verts_[tri_base + 2];
    if (i0 >= VertexCount() || i1 >= VertexCount() || i2 >= VertexCount()) continue;

    const uint32_t a = i0 * num_prop_;
    const uint32_t b = i1 * num_prop_;
    const uint32_t c = i2 * num_prop_;
    const double x0 = vert_properties_[a + 0];
    const double y0 = vert_properties_[a + 1];
    const double z0 = vert_properties_[a + 2];
    const double x1 = vert_properties_[b + 0];
    const double y1 = vert_properties_[b + 1];
    const double z1 = vert_properties_[b + 2];
    const double x2 = vert_properties_[c + 0];
    const double y2 = vert_properties_[c + 1];
    const double z2 = vert_properties_[c + 2];
    signed_volume += x0 * (y1 * z2 - z1 * y2) -
                     y0 * (x1 * z2 - z1 * x2) +
                     z0 * (x1 * y2 - y1 * x2);
  }
  if (signed_volume < 0.0) InvertNormals();

  manifold::MeshGL mesh;
  mesh.numProp = num_prop_;
  mesh.vertProperties = vert_properties_;
  mesh.triVerts = tri_verts_;
  mesh.faceID = tri_ids_;
  mesh.Merge();

  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", mesh.numProp);
  snapshot.set("vertProperties", ToJsArray(mesh.vertProperties));
  snapshot.set("triVerts", ToJsArray(mesh.triVerts));
  snapshot.set("faceID", ToJsArray(mesh.faceID));
  snapshot.set("mergeFromVert", ToJsArray(mesh.mergeFromVert));
  snapshot.set("mergeToVert", ToJsArray(mesh.mergeToVert));
  snapshot.set("triangleCount", static_cast<uint32_t>(mesh.NumTri()));
  snapshot.set("vertexCount", static_cast<uint32_t>(mesh.NumVert()));
  return snapshot;
}

emscripten::val BrepSolidCore::PushFace(const std::string& face_name,
                                        double distance) {
  emscripten::val result = emscripten::val::object();
  result.set("faceFound", false);
  result.set("moved", false);
  result.set("invalidNormal", false);

  if (!std::isfinite(distance) || distance == 0.0) return result;

  const auto face_found = face_name_to_id_.find(face_name);
  if (face_found == face_name_to_id_.end()) return result;
  result.set("faceFound", true);

  const uint32_t face_id = face_found->second;
  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_ids_.size()),
               static_cast<uint32_t>(tri_verts_.size() / 3));
  const uint32_t nv = VertexCount();
  if (tri_count == 0 || nv == 0) return result;

  double nx = 0.0;
  double ny = 0.0;
  double nz = 0.0;
  double area_sum = 0.0;
  std::vector<uint8_t> affected(nv, 0);
  std::vector<std::array<double, 3>> vertex_normals(nv, {0.0, 0.0, 0.0});

  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    if (tri_ids_[tri_idx] != face_id) continue;

    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = tri_verts_[tri_base + 0];
    const uint32_t i1 = tri_verts_[tri_base + 1];
    const uint32_t i2 = tri_verts_[tri_base + 2];
    if (i0 >= nv || i1 >= nv || i2 >= nv) continue;

    affected[i0] = 1;
    affected[i1] = 1;
    affected[i2] = 1;

    const uint32_t a = i0 * num_prop_;
    const uint32_t b = i1 * num_prop_;
    const uint32_t c = i2 * num_prop_;

    const double ax = vert_properties_[a + 0];
    const double ay = vert_properties_[a + 1];
    const double az = vert_properties_[a + 2];
    const double bx = vert_properties_[b + 0];
    const double by = vert_properties_[b + 1];
    const double bz = vert_properties_[b + 2];
    const double cx = vert_properties_[c + 0];
    const double cy = vert_properties_[c + 1];
    const double cz = vert_properties_[c + 2];

    const double ux = bx - ax;
    const double uy = by - ay;
    const double uz = bz - az;
    const double vx = cx - ax;
    const double vy = cy - ay;
    const double vz = cz - az;
    const double tx = uy * vz - uz * vy;
    const double ty = uz * vx - ux * vz;
    const double tz = ux * vy - uy * vx;
    const double t_len = std::hypot(tx, ty, tz);
    if (!(t_len > 0.0)) continue;

    area_sum += t_len;
    nx += tx;
    ny += ty;
    nz += tz;
    vertex_normals[i0][0] += tx;
    vertex_normals[i0][1] += ty;
    vertex_normals[i0][2] += tz;
    vertex_normals[i1][0] += tx;
    vertex_normals[i1][1] += ty;
    vertex_normals[i1][2] += tz;
    vertex_normals[i2][0] += tx;
    vertex_normals[i2][1] += ty;
    vertex_normals[i2][2] += tz;
  }

  uint32_t affected_count = 0;
  for (uint8_t value : affected) affected_count += value ? 1u : 0u;
  if (affected_count == 0) return result;

  const double len = std::hypot(nx, ny, nz);
  const double planar_ratio = area_sum > 0.0 ? (len / area_sum) : 0.0;
  if (len > 0.0 && planar_ratio > 0.98) {
    const double dx = nx * (distance / len);
    const double dy = ny * (distance / len);
    const double dz = nz * (distance / len);
    for (uint32_t i = 0; i < nv; ++i) {
      if (!affected[i]) continue;
      const uint32_t base = i * num_prop_;
      vert_properties_[base + 0] += static_cast<float>(dx);
      vert_properties_[base + 1] += static_cast<float>(dy);
      vert_properties_[base + 2] += static_cast<float>(dz);
    }
    RebuildVertexKeyIndex();
    result.set("moved", true);
    return result;
  }

  uint32_t moved = 0;
  for (uint32_t i = 0; i < nv; ++i) {
    if (!affected[i]) continue;
    const double vx = vertex_normals[i][0];
    const double vy = vertex_normals[i][1];
    const double vz = vertex_normals[i][2];
    const double vlen = std::hypot(vx, vy, vz);
    if (!(vlen > 0.0)) continue;
    const double scale = distance / vlen;
    const uint32_t base = i * num_prop_;
    vert_properties_[base + 0] += static_cast<float>(vx * scale);
    vert_properties_[base + 1] += static_cast<float>(vy * scale);
    vert_properties_[base + 2] += static_cast<float>(vz * scale);
    moved++;
  }

  if (moved == 0) {
    result.set("invalidNormal", true);
    return result;
  }

  RebuildVertexKeyIndex();
  result.set("moved", true);
  return result;
}

void BrepSolidCore::SetFaceMetadataJson(const std::string& face_name,
                                        const std::string& metadata_json) {
  face_metadata_json_[face_name] = metadata_json;
}

std::string BrepSolidCore::GetFaceMetadataJson(
    const std::string& face_name) const {
  const auto found = face_metadata_json_.find(face_name);
  if (found == face_metadata_json_.end()) return std::string();
  return found->second;
}

void BrepSolidCore::SetEdgeMetadataJson(const std::string& edge_name,
                                        const std::string& metadata_json) {
  edge_metadata_json_[edge_name] = metadata_json;
}

std::string BrepSolidCore::GetEdgeMetadataJson(
    const std::string& edge_name) const {
  const auto found = edge_metadata_json_.find(edge_name);
  if (found == edge_metadata_json_.end()) return std::string();
  return found->second;
}

emscripten::val BrepSolidCore::GetFaceNames() const {
  std::vector<std::string> names;
  names.reserve(face_name_to_id_.size());
  for (const auto& entry : face_name_to_id_) {
    names.push_back(entry.first);
  }
  return ToStringArray(names);
}

emscripten::val BrepSolidCore::GetAuthoringState() const {
  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", num_prop_);
  snapshot.set("vertProperties", ToJsArray(vert_properties_));
  snapshot.set("triVerts", ToJsArray(tri_verts_));
  snapshot.set("triIDs", ToJsArray(tri_ids_));
  snapshot.set("faceNameToID", ToFaceNameEntries(face_name_to_id_));
  snapshot.set("idToFaceName", ToFaceIdEntries(id_to_face_name_));
  snapshot.set("faceMetadataJson", ToStringMapEntries(face_metadata_json_));
  snapshot.set("edgeMetadataJson", ToStringMapEntries(edge_metadata_json_));
  snapshot.set("vertexCount", VertexCount());
  snapshot.set("triangleCount", TriangleCount());
  return snapshot;
}

uint32_t BrepSolidCore::VertexCount() const {
  return static_cast<uint32_t>(vert_properties_.size() / num_prop_);
}

uint32_t BrepSolidCore::TriangleCount() const {
  return static_cast<uint32_t>(tri_ids_.size());
}

std::string BrepSolidCore::MakeVertexKey(double x, double y, double z) {
  std::ostringstream stream;
  stream.precision(std::numeric_limits<double>::max_digits10);
  stream << x << ',' << y << ',' << z;
  return stream.str();
}

std::string BrepSolidCore::MakeUndirectedEdgeKey(uint32_t a, uint32_t b) {
  const uint32_t lo = std::min(a, b);
  const uint32_t hi = std::max(a, b);
  std::ostringstream stream;
  stream << lo << ',' << hi;
  return stream.str();
}

emscripten::val BrepSolidCore::ToJsArray(const std::vector<float>& values) {
  emscripten::val out = emscripten::val::array();
  for (std::size_t i = 0; i < values.size(); ++i) {
    out.set(static_cast<uint32_t>(i), values[i]);
  }
  return out;
}

emscripten::val BrepSolidCore::ToJsArray(const std::vector<uint32_t>& values) {
  emscripten::val out = emscripten::val::array();
  for (std::size_t i = 0; i < values.size(); ++i) {
    out.set(static_cast<uint32_t>(i), values[i]);
  }
  return out;
}

emscripten::val BrepSolidCore::ToStringArray(
    const std::vector<std::string>& values) {
  emscripten::val out = emscripten::val::array();
  for (std::size_t i = 0; i < values.size(); ++i) {
    out.set(static_cast<uint32_t>(i), values[i]);
  }
  return out;
}

emscripten::val BrepSolidCore::ToStringMapEntries(
    const std::unordered_map<std::string, std::string>& values) {
  emscripten::val out = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    out.set(index++, pair);
  }
  return out;
}

emscripten::val BrepSolidCore::ToFaceNameEntries(
    const std::unordered_map<std::string, uint32_t>& values) {
  emscripten::val out = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    out.set(index++, pair);
  }
  return out;
}

emscripten::val BrepSolidCore::ToFaceIdEntries(
    const std::unordered_map<uint32_t, std::string>& values) {
  emscripten::val out = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    out.set(index++, pair);
  }
  return out;
}

std::vector<float> BrepSolidCore::ReadFloatArray(const emscripten::val& values,
                                                 const char* label) {
  if (values.isUndefined() || values.isNull()) return {};
  const uint32_t length = values["length"].as<uint32_t>();
  std::vector<float> out;
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const double value = values[i].as<double>();
    if (!std::isfinite(value)) {
      throw std::runtime_error(std::string(label) +
                               " contains a non-finite numeric value.");
    }
    out.push_back(static_cast<float>(value));
  }
  return out;
}

std::vector<uint32_t> BrepSolidCore::ReadUint32Array(
    const emscripten::val& values, const char* label) {
  if (values.isUndefined() || values.isNull()) return {};
  const uint32_t length = values["length"].as<uint32_t>();
  std::vector<uint32_t> out;
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const double value = values[i].as<double>();
    if (!std::isfinite(value) || value < 0.0) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid unsigned integer value.");
    }
    out.push_back(static_cast<uint32_t>(value));
  }
  return out;
}

std::unordered_map<std::string, uint32_t> BrepSolidCore::ReadStringUint32Map(
    const emscripten::val& values, const char* label) {
  std::unordered_map<std::string, uint32_t> out;
  if (values.isUndefined() || values.isNull()) return out;

  const uint32_t length = values["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = values[i];
    const uint32_t pair_length = pair["length"].as<uint32_t>();
    if (pair_length < 2) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid entry.");
    }
    const std::string key = pair[0].as<std::string>();
    const double value = pair[1].as<double>();
    if (!std::isfinite(value) || value < 0.0) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid unsigned integer value.");
    }
    out[key] = static_cast<uint32_t>(value);
  }
  return out;
}

std::unordered_map<uint32_t, std::string> BrepSolidCore::ReadUint32StringMap(
    const emscripten::val& values, const char* label) {
  std::unordered_map<uint32_t, std::string> out;
  if (values.isUndefined() || values.isNull()) return out;

  const uint32_t length = values["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = values[i];
    const uint32_t pair_length = pair["length"].as<uint32_t>();
    if (pair_length < 2) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid entry.");
    }
    const double key = pair[0].as<double>();
    if (!std::isfinite(key) || key < 0.0) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid unsigned integer key.");
    }
    out[static_cast<uint32_t>(key)] = pair[1].as<std::string>();
  }
  return out;
}

std::unordered_map<std::string, std::string> BrepSolidCore::ReadStringMap(
    const emscripten::val& values, const char* label) {
  std::unordered_map<std::string, std::string> out;
  if (values.isUndefined() || values.isNull()) return out;

  const uint32_t length = values["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = values[i];
    const uint32_t pair_length = pair["length"].as<uint32_t>();
    if (pair_length < 2) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid entry.");
    }
    out[pair[0].as<std::string>()] = pair[1].as<std::string>();
  }
  return out;
}

void BrepSolidCore::ReadPoint(const emscripten::val& point, double& x,
                              double& y, double& z) {
  x = ReadNumericProperty(point, "x", 0);
  y = ReadNumericProperty(point, "y", 1);
  z = ReadNumericProperty(point, "z", 2);

  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) {
    throw std::runtime_error("Point coordinates must be finite.");
  }
}

void BrepSolidCore::RebuildVertexKeyIndex() {
  vert_key_to_index_.clear();
  const uint32_t vertex_count = VertexCount();
  for (uint32_t i = 0; i < vertex_count; ++i) {
    const uint32_t base = i * num_prop_;
    const double x = vert_properties_[base + 0];
    const double y = vert_properties_[base + 1];
    const double z = vert_properties_[base + 2];
    vert_key_to_index_[MakeVertexKey(x, y, z)] = i;
  }
}

}  // namespace manifoldplus
