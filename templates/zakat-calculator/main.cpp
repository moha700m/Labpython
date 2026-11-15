// حاسبة زكاة المال — 2.5٪ من المال الذي بلغ النصاب وحال عليه الحول.
// النصاب = قيمة 85 جراماً من الذهب تقريباً؛ أدخله حسب سعر الذهب في يومك.
#include <iomanip>
#include <iostream>
#ifdef _WIN32
#include <windows.h>
#endif

int main() {
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
#endif
    double savings = 0, nisab = 0;
    std::cout << "كم مدخراتك التي حال عليها الحول (ريال)؟ " << std::flush;
    std::cin >> savings;
    std::cout << "كم قيمة النصاب اليوم (ريال)؟ " << std::flush;
    std::cin >> nisab;
    std::cout << std::fixed << std::setprecision(2);
    if (savings < nisab) {
        std::cout << "مالك لم يبلغ النصاب، فلا زكاة عليه.\n";
    } else {
        std::cout << "الزكاة الواجبة: " << savings * 0.025 << " ريال\n";
    }
    std::cout << "تقبّل الله منك 🤍\n";
    return 0;
}
