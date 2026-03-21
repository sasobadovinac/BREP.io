#include <emscripten/bind.h>

#include "primitive_builder.h"
#include "tube_builder.h"

namespace {

double SumNumbers(double a, double b) { return a + b; }

}  // namespace

EMSCRIPTEN_BINDINGS(manifold_plus_bindings) {
  emscripten::function("sum", &SumNumbers);
  emscripten::function("buildPrimitiveAuthoringState",
                       &manifoldplus::BuildPrimitiveAuthoringState);
  emscripten::function("buildTubeAuthoringState",
                       &manifoldplus::BuildTubeAuthoringState);
}
