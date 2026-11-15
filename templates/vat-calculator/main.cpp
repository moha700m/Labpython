// حاسبة ضريبة القيمة المضافة (15٪)
#include <iomanip>
#include <iostream>
#ifdef _WIN32
#include <windows.h>
#endif

int main() {
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
#endif
    const double vatRate = 0.15;
    std::cout << "هلا! أدخل السعر قبل الضريبة (ريال): " << std::flush;
    double price = 0;
    if (!(std::cin >> price) || price < 0) {
        std::cout << "الرجاء إدخال رقم صحيح\n";
        return 1;
    }
    const double vat = price * vatRate;
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "الضريبة (15٪): " << vat << " ريال\n";
    std::cout << "السعر شامل الضريبة: " << price + vat << " ريال\n";
    std::cout << "ولو كان " << price << " شامل الضريبة، فالسعر قبلها: " << price / (1 + vatRate) << " ريال\n";
    return 0;
}
