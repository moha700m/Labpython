// مسبحة إلكترونية — تطبيق Win32 رسومي
#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <string>

static int g_count = 0;
static HWND g_label = nullptr;
static HFONT g_big = nullptr;
enum { ID_TASBEEH = 1, ID_RESET = 2 };

static void refresh() {
    std::wstring text = L"Count: " + std::to_wstring(g_count) + (g_count && g_count % 33 == 0 ? L"  (33!)" : L"");
    SetWindowTextW(g_label, text.c_str());
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_CREATE: {
            g_big = CreateFontW(28, 0, 0, 0, FW_BOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
            HWND b = CreateWindowW(L"BUTTON", L"Tasbeeh +1", WS_VISIBLE | WS_CHILD | BS_DEFPUSHBUTTON, 30, 30, 220, 60, hwnd,
                                   reinterpret_cast<HMENU>(ID_TASBEEH), nullptr, nullptr);
            CreateWindowW(L"BUTTON", L"Reset", WS_VISIBLE | WS_CHILD, 270, 30, 100, 60, hwnd, reinterpret_cast<HMENU>(ID_RESET), nullptr, nullptr);
            g_label = CreateWindowW(L"STATIC", L"Count: 0", WS_VISIBLE | WS_CHILD, 30, 115, 340, 40, hwnd, nullptr, nullptr, nullptr);
            SendMessageW(b, WM_SETFONT, reinterpret_cast<WPARAM>(g_big), TRUE);
            SendMessageW(g_label, WM_SETFONT, reinterpret_cast<WPARAM>(g_big), TRUE);
            return 0;
        }
        case WM_COMMAND:
            if (LOWORD(wParam) == ID_TASBEEH) ++g_count;
            if (LOWORD(wParam) == ID_RESET) g_count = 0;
            refresh();
            return 0;
        case WM_DESTROY:
            DeleteObject(g_big);
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int nCmdShow) {
    WNDCLASSW wc{};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"Tasbeeh";
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(240, 248, 243));
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"Tasbeeh", WS_OVERLAPPEDWINDOW, 0, 0, 420, 230, nullptr, nullptr, hInstance, nullptr);
    ShowWindow(hwnd, nCmdShow);
    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
