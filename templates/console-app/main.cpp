#include <iostream>
#include <string>
#ifdef _WIN32
#include <windows.h>
#endif

int main() {
#ifdef _WIN32
    // Make the Windows console understand UTF-8 so Arabic text prints correctly.
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
#endif
    std::cout << "مرحباً بك في Muhammad C++ Studio!\n";
    std::cout << "What is your name? " << std::flush;
    std::string name;
    std::getline(std::cin, name);
    if (name.empty()) name = "friend";
    std::cout << "Hello, " << name << "!\n";
    return 0;
}
