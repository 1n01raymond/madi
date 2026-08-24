cmake_minimum_required(VERSION 3.25)

project(naru_adapter_occt_spike LANGUAGES CXX)

option(NARU_OCCT_REQUIRED "Fail configuration when Open CASCADE is unavailable" ON)

find_package(OpenCASCADE QUIET)

if(NOT OpenCASCADE_FOUND)
  if(NARU_OCCT_REQUIRED)
    message(FATAL_ERROR
      "Open CASCADE was not found. Set OpenCASCADE_DIR to its CMake package "
      "directory or configure with -DNARU_OCCT_REQUIRED=OFF for a prerequisite check.")
  endif()
  message(STATUS "Open CASCADE not found; the adapter spike target is disabled.")
  return()
endif()

add_executable(naru-occt-spike src/main.cpp)
target_compile_features(naru-occt-spike PRIVATE cxx_std_20)
target_include_directories(naru-occt-spike PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_libraries(naru-occt-spike PRIVATE ${OpenCASCADE_LIBRARIES})

if(MSVC)
  target_compile_options(naru-occt-spike PRIVATE /W4 /permissive-)
else()
  target_compile_options(naru-occt-spike PRIVATE -Wall -Wextra -Wpedantic)
endif()
