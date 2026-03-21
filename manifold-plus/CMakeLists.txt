cmake_minimum_required(VERSION 3.18)
project(manifoldplus LANGUAGES CXX)

set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(MANIFOLD_TEST OFF CACHE BOOL "" FORCE)
set(MANIFOLD_PYBIND OFF CACHE BOOL "" FORCE)
set(MANIFOLD_CBIND OFF CACHE BOOL "" FORCE)
set(MANIFOLD_JSBIND OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

set(MANIFOLD_SOURCE_DIR ${CMAKE_CURRENT_LIST_DIR}/../vendor/manifold3d)
set(MANIFOLD_WASM_BINDINGS_DIR ${MANIFOLD_SOURCE_DIR}/bindings/wasm)

add_subdirectory(${MANIFOLD_SOURCE_DIR} ${CMAKE_BINARY_DIR}/vendor/manifold3d EXCLUDE_FROM_ALL)

add_executable(
  manifoldplusjs
  ${MANIFOLD_WASM_BINDINGS_DIR}/bindings.cpp
  ${CMAKE_CURRENT_LIST_DIR}/bindings.cpp
)

set_source_files_properties(
  ${MANIFOLD_WASM_BINDINGS_DIR}/bindings.cpp
  PROPERTIES OBJECT_DEPENDS ${MANIFOLD_WASM_BINDINGS_DIR}/bindings.js
)

target_link_libraries(
  manifoldplusjs
  PRIVATE manifold $<$<BOOL:${MANIFOLD_PAR}>:TBB::tbb>
)
target_compile_options(manifoldplusjs PRIVATE ${MANIFOLD_FLAGS})
target_link_options(
  manifoldplusjs
  PUBLIC
    --pre-js
    ${MANIFOLD_WASM_BINDINGS_DIR}/bindings.js
    --bind
    -sALLOW_TABLE_GROWTH=1
    -sEXPORTED_RUNTIME_METHODS=addFunction,removeFunction
    -sMODULARIZE=1
    -sEXPORT_ES6=1
)

set_target_properties(manifoldplusjs PROPERTIES OUTPUT_NAME "manifold")
