#include <iostream>
#include <numeric>
#include <vector>

int main() {
    std::vector<int> v(10);
    std::iota(v.begin(), v.end(), 1);
    std::cout << "Sum 1..10 = " << std::accumulate(v.begin(), v.end(), 0) << '\n';
}
