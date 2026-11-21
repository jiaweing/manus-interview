#include "win32_platform.hpp"
#include <fcntl.h>
#include <io.h>
#include <iostream>

int main() {
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  caret::Win32Platform platform;
  caret::Protocol protocol(platform);  // One instance for this process's lifetime.
  std::string line;
  while (true) {
    const auto status = caret::read_line(std::cin, line);
    if (status == caret::LineStatus::end) return std::cin.bad() ? 1 : 0;
    const auto response = status == caret::LineStatus::complete
      ? protocol.dispatch(line) : caret::Protocol::invalid_request();
    std::cout << response << '\n' << std::flush;
    if (!std::cout) return 1;
    if (status == caret::LineStatus::truncated) return 0;
  }
}
