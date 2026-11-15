// تحويل ميلادي → هجري بالتقويم الهجري الحسابي (Tabular Islamic calendar).
// ملاحظة: تقويم أم القرى المعتمد في السعودية مبني على الحسابات الفلكية وقد يختلف يوماً واحداً.
#include <array>
#include <iostream>
#include <string>
#ifdef _WIN32
#include <windows.h>
#endif

// Julian Day Number of a Gregorian date.
long toJdn(int y, int m, int d) {
    long a = (14 - m) / 12, yy = y + 4800 - a, mm = m + 12 * a - 3;
    return d + (153 * mm + 2) / 5 + 365 * yy + yy / 4 - yy / 100 + yy / 400 - 32045;
}

struct Hijri { long year; int month; int day; };

Hijri toHijri(long jdn) {
    long l = jdn - 1948440 + 10632;
    long n = (l - 1) / 10631;
    l = l - 10631 * n + 354;
    long j = ((10985 - l) / 5316) * ((50 * l) / 17719) + (l / 5670) * ((43 * l) / 15238);
    l = l - ((30 - j) / 15) * ((17719 * j) / 50) - (j / 16) * ((15238 * j) / 43) + 29;
    int month = static_cast<int>((24 * l) / 709);
    int day = static_cast<int>(l - (709 * month) / 24);
    long year = 30 * n + j - 30;
    return {year, month, day};
}

int main() {
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
#endif
    const std::array<std::string, 12> months{"محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
                                             "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"};
    int y = 0, m = 0, d = 0;
    std::cout << "أدخل التاريخ الميلادي (سنة شهر يوم) مثال 2030 1 1: " << std::flush;
    if (!(std::cin >> y >> m >> d) || m < 1 || m > 12 || d < 1 || d > 31) {
        std::cout << "تاريخ غير صالح\n";
        return 1;
    }
    Hijri h = toHijri(toJdn(y, m, d));
    std::cout << "التاريخ الهجري: " << h.day << " " << months[h.month - 1] << " " << h.year << " هـ\n";
    return 0;
}
