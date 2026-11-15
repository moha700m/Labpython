#include "calculator.hpp"

namespace calc {
double add(double a, double b) { return a + b; }
double subtract(double a, double b) { return a - b; }
double multiply(double a, double b) { return a * b; }
std::optional<double> divide(double a, double b) {
    if (b == 0.0) return std::nullopt;
    return a / b;
}
}  // namespace calc
