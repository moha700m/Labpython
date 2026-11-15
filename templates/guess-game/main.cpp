// لعبة خمّن الرقم
#include <iostream>
#include <random>
#ifdef _WIN32
#include <windows.h>
#endif

int main() {
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
#endif
    std::mt19937 rng(std::random_device{}());
    const int secret = std::uniform_int_distribution<int>(1, 100)(rng);
    std::cout << "اخترت رقماً من 1 إلى 100… خمّن!\n";
    for (int tries = 1;; ++tries) {
        std::cout << "تخمينك: " << std::flush;
        int guess = 0;
        if (!(std::cin >> guess)) return 0;
        if (guess < secret) std::cout << "أكبر ⬆️\n";
        else if (guess > secret) std::cout << "أصغر ⬇️\n";
        else {
            std::cout << "كفو! 🎉 عرفته في " << tries << " محاولة\n";
            return 0;
        }
    }
}
