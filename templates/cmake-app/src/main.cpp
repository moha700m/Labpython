#include <iostream>
#include <vector>
#include "greeter.hpp"

int main() {
    std::vector<std::string> names{"Muhammad", "Studio", "C++"};
    for (const auto& n : names) std::cout << greet(n) << '\n';
    return 0;
}
