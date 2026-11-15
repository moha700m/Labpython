#include <iostream>
#include "calculator.hpp"

int main() {
    double a = 0, b = 0;
    char op = '+';
    std::cout << "Enter an operation (e.g. 6 * 7): " << std::flush;
    if (!(std::cin >> a >> op >> b)) {
        std::cerr << "Invalid input\n";
        return 1;
    }
    switch (op) {
        case '+': std::cout << "= " << calc::add(a, b) << '\n'; break;
        case '-': std::cout << "= " << calc::subtract(a, b) << '\n'; break;
        case '*': std::cout << "= " << calc::multiply(a, b) << '\n'; break;
        case '/':
            if (auto r = calc::divide(a, b)) std::cout << "= " << *r << '\n';
            else std::cout << "Cannot divide by zero\n";
            break;
        default: std::cout << "Unknown operation\n";
    }
    return 0;
}
