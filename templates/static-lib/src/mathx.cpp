#include "mathx.hpp"

namespace mathx {
std::uint64_t factorial(unsigned n) { return n <= 1 ? 1 : n * factorial(n - 1); }
bool is_prime(std::uint64_t n) {
    if (n < 2) return false;
    for (std::uint64_t i = 2; i * i <= n; ++i)
        if (n % i == 0) return false;
    return true;
}
}  // namespace mathx
