#include <emscripten/bind.h>

namespace {

double SumNumbers(double a, double b) { return a + b; }

}  // namespace

EMSCRIPTEN_BINDINGS(manifold_plus_bindings) {
  emscripten::function("sum", &SumNumbers);
}
