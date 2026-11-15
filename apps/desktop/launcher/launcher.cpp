// Muhammad C++ Studio — Windows launcher.
//
// Starts the bundled studio server (runtime\node.exe app\server.mjs) without a console window,
// waits until it answers on http://127.0.0.1:47321, opens the browser and shows a small control
// window. Closing the window stops the server and every process it started (Job Object).
// If the studio is already running, it just opens the browser.
//
// Build: g++ -std=c++20 -O2 -municode -mwindows -static launcher.cpp launcher.res.o -o MuhammadCppStudio.exe -lws2_32
#ifndef UNICODE
#define UNICODE
#endif
#include <winsock2.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <string>

namespace {
constexpr int kPort = 47321;
constexpr UINT_PTR kTimer = 1;
constexpr int ID_OPEN = 101, ID_STOP = 102, ID_LOG = 103;

HWND g_status = nullptr;
HANDLE g_job = nullptr;
HANDLE g_server = nullptr;
bool g_opened = false;
int g_ticks = 0;
std::wstring g_dir, g_log;
HFONT g_font = nullptr, g_title = nullptr;

std::wstring url() { return L"http://127.0.0.1:" + std::to_wstring(kPort) + L"/run/"; }

// True when our server answers /api/health on the loopback port.
bool healthy() {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return false;
    DWORD timeout = 800;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout), sizeof timeout);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(kPort);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    bool ok = false;
    if (connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof addr) == 0) {
        const char req[] = "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n";
        send(s, req, sizeof req - 1, 0);
        std::string resp;
        char buf[1024];
        int n;
        while ((n = recv(s, buf, sizeof buf, 0)) > 0) resp.append(buf, n);
        ok = resp.find("muhammad-cpp-studio") != std::string::npos;
    }
    closesocket(s);
    return ok;
}

void openBrowser() { ShellExecuteW(nullptr, L"open", url().c_str(), nullptr, nullptr, SW_SHOWNORMAL); }

void setStatus(const std::wstring& text) { SetWindowTextW(g_status, text.c_str()); }

bool startServer() {
    wchar_t local[MAX_PATH];
    SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, local);
    std::wstring dataDir = std::wstring(local) + L"\\MuhammadCppStudio";
    CreateDirectoryW(dataDir.c_str(), nullptr);
    g_log = dataDir + L"\\server.log";

    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE log = CreateFileW(g_log.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);

    SetEnvironmentVariableW(L"MCS_HOME", g_dir.c_str());
    SetEnvironmentVariableW(L"MCS_PORT", std::to_wstring(kPort).c_str());
    SetEnvironmentVariableW(L"MCS_DATA_DIR", dataDir.c_str());

    std::wstring cmd = L"\"" + g_dir + L"\\runtime\\node.exe\" --disable-warning=ExperimentalWarning \"" + g_dir + L"\\app\\server.mjs\"";
    STARTUPINFOW si{};
    si.cb = sizeof si;
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = log;
    si.hStdError = log;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, g_dir.c_str(), &si, &pi);
    if (log != INVALID_HANDLE_VALUE) CloseHandle(log);
    if (!ok) return false;

    // Everything the server starts (compilers, user programs) belongs to this job and dies with it.
    g_job = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(g_job, JobObjectExtendedLimitInformation, &info, sizeof info);
    AssignProcessToJobObject(g_job, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    g_server = pi.hProcess;
    return true;
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_CREATE: {
            g_title = CreateFontW(26, 0, 0, 0, FW_BOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
            g_font = CreateFontW(18, 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
            HWND title = CreateWindowW(L"STATIC", L"Muhammad C++ Studio", WS_VISIBLE | WS_CHILD, 24, 18, 400, 34, hwnd, nullptr, nullptr, nullptr);
            g_status = CreateWindowW(L"STATIC", L"جاري تشغيل الاستديو…", WS_VISIBLE | WS_CHILD, 24, 60, 400, 48, hwnd, nullptr, nullptr, nullptr);
            HWND open = CreateWindowW(L"BUTTON", L"افتح الاستديو", WS_VISIBLE | WS_CHILD | BS_DEFPUSHBUTTON, 24, 118, 190, 42, hwnd, reinterpret_cast<HMENU>(ID_OPEN), nullptr, nullptr);
            HWND stop = CreateWindowW(L"BUTTON", L"إيقاف وإغلاق", WS_VISIBLE | WS_CHILD, 226, 118, 190, 42, hwnd, reinterpret_cast<HMENU>(ID_STOP), nullptr, nullptr);
            HWND log = CreateWindowW(L"BUTTON", L"السجل", WS_VISIBLE | WS_CHILD, 24, 170, 100, 30, hwnd, reinterpret_cast<HMENU>(ID_LOG), nullptr, nullptr);
            SendMessageW(title, WM_SETFONT, reinterpret_cast<WPARAM>(g_title), TRUE);
            for (HWND h : {g_status, open, stop, log}) SendMessageW(h, WM_SETFONT, reinterpret_cast<WPARAM>(g_font), TRUE);
            SetTimer(hwnd, kTimer, 500, nullptr);
            return 0;
        }
        case WM_TIMER: {
            if (healthy()) {
                setStatus(L"✅ الاستديو شغّال — " + url());
                if (!g_opened) {
                    g_opened = true;
                    openBrowser();
                }
                return 0;
            }
            DWORD code = 0;
            if (g_server && GetExitCodeProcess(g_server, &code) && code != STILL_ACTIVE) {
                KillTimer(hwnd, kTimer);
                setStatus(L"✖ توقف الخادم بشكل غير متوقع — افتح «السجل»");
            } else if (++g_ticks > 240) {
                setStatus(L"⏳ يأخذ وقتاً أطول من المعتاد… افتح «السجل»");
            }
            return 0;
        }
        case WM_COMMAND:
            if (LOWORD(wParam) == ID_OPEN) openBrowser();
            if (LOWORD(wParam) == ID_STOP) DestroyWindow(hwnd);
            if (LOWORD(wParam) == ID_LOG && !g_log.empty()) ShellExecuteW(nullptr, L"open", L"notepad.exe", g_log.c_str(), nullptr, SW_SHOWNORMAL);
            return 0;
        case WM_DESTROY:
            KillTimer(hwnd, kTimer);
            if (g_job) CloseHandle(g_job);  // kills the server and everything it started
            DeleteObject(g_font);
            DeleteObject(g_title);
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}
}  // namespace

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, PWSTR, int nCmdShow) {
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    // Already running (e.g. started twice)? Just open the browser.
    if (healthy()) {
        openBrowser();
        return 0;
    }

    wchar_t exe[MAX_PATH];
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    g_dir = exe;
    g_dir = g_dir.substr(0, g_dir.find_last_of(L"\\/"));

    if (!startServer()) {
        MessageBoxW(nullptr, L"تعذّر تشغيل الاستديو. أعد تثبيت البرنامج.", L"Muhammad C++ Studio", MB_ICONERROR);
        return 1;
    }

    WNDCLASSW wc{};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"MuhammadCppStudioLauncher";
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hIcon = LoadIconW(hInstance, L"APPICON");
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowExW(WS_EX_LAYOUTRTL, wc.lpszClassName, L"Muhammad C++ Studio", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
                                CW_USEDEFAULT, CW_USEDEFAULT, 460, 260, nullptr, nullptr, hInstance, nullptr);
    ShowWindow(hwnd, nCmdShow);

    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    WSACleanup();
    return 0;
}
