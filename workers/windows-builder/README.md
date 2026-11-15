# Windows Build Worker (MSVC) — not implemented

Windows EXEs are already produced for real by the **Linux build worker** using the MinGW-w64 cross
compiler (`build:mingw-gcc`, verified PE32+ output in CI). This directory is reserved for an
optional MSVC worker, which needs real Windows infrastructure that this repository does not have.

What exists already:

* The build planner supports `compiler: "msvc"` (`cl.exe /std:c++20 /EHsc …`, `NMake` for CMake)
  and the diagnostics parser understands MSVC's `file(line,col): error Cxxxx:` format.
* The UI lists MSVC but marks it unavailable until a worker advertises `build:msvc`.

What a Windows build worker needs:

1. Windows Server VM with Visual Studio Build Tools (C++ workload) and CMake.
2. Node.js 22 + this repository; a runner that reuses `@mcs/worker-runtime`'s API client and job
   loop with an isolation adapter for Windows (one disposable VM or Windows Sandbox per job — the
   Linux bubblewrap sandbox does not apply).
3. Run inside a "Developer Command Prompt" environment (`vcvars64.bat`) so `cl.exe` is on PATH.
4. Advertise `build:msvc` and upload artifacts exactly like the Linux worker.
