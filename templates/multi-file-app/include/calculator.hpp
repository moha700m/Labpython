#pragma once
#include <optional>

namespace calc {
double add(double a, double b);
double subtract(double a, double b);
double multiply(double a, double b);
std::optional<double> divide(double a, double b);
}  // namespace calc
