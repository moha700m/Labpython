cmake_minimum_required(VERSION 3.16)
project(cmake_app LANGUAGES CXX)

set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(greeter STATIC src/greeter.cpp)
target_include_directories(greeter PUBLIC include)

add_executable(cmake_app src/main.cpp)
target_link_libraries(cmake_app PRIVATE greeter)
