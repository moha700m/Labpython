#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <string>

static int g_clicks = 0;
static HWND g_label = nullptr;
constexpr int ID_BUTTON = 1001;

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_CREATE:
            CreateWindowW(L"BUTTON", L"Click me", WS_TABSTOP | WS_VISIBLE | WS_CHILD | BS_DEFPUSHBUTTON,
                          40, 40, 160, 40, hwnd, reinterpret_cast<HMENU>(ID_BUTTON), nullptr, nullptr);
            g_label = CreateWindowW(L"STATIC", L"Clicks: 0", WS_VISIBLE | WS_CHILD, 40, 100, 300, 30, hwnd, nullptr, nullptr, nullptr);
            return 0;
        case WM_COMMAND:
            if (LOWORD(wParam) == ID_BUTTON) {
                ++g_clicks;
                std::wstring text = L"Clicks: " + std::to_wstring(g_clicks);
                SetWindowTextW(g_label, text.c_str());
            }
            return 0;
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int nCmdShow) {
    WNDCLASSW wc{};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"MuhammadStudioWindow";
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"Muhammad C++ Studio - Win32", WS_OVERLAPPEDWINDOW,
                                CW_USEDEFAULT, CW_USEDEFAULT, 420, 240, nullptr, nullptr, hInstance, nullptr);
    if (!hwnd) return 1;
    ShowWindow(hwnd, nCmdShow);

    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
