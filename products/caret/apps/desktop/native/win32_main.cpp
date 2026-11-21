#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <fcntl.h>
#include <io.h>

#include <cstdint>
#include <iostream>
#include <sstream>
#include "protocol.hpp"

namespace {
std::string handle(HWND window) {
  std::ostringstream out;
  out << "0x" << std::hex << reinterpret_cast<std::uintptr_t>(window);
  return out.str();
}
class Win32Platform final : public caret::Platform {
 public:
  std::optional<caret::Target> snapshot() override {
    const HWND foreground = GetForegroundWindow();
    if (!foreground || !IsWindow(foreground) || !IsWindowVisible(foreground) ||
        !IsWindowEnabled(foreground)) return std::nullopt;
    const DWORD thread = GetWindowThreadProcessId(foreground, nullptr);
    GUITHREADINFO info{};
    info.cbSize = sizeof(info);
    if (!thread || !GetGUIThreadInfo(thread, &info) || info.hwndActive != foreground ||
        !info.hwndFocus || !IsWindow(info.hwndFocus) || !IsWindowVisible(info.hwndFocus) ||
        !IsWindowEnabled(info.hwndFocus) || GetAncestor(info.hwndFocus, GA_ROOT) != foreground ||
        GetForegroundWindow() != foreground) return std::nullopt;
    return caret::Target{handle(foreground), handle(info.hwndFocus)};
  }
  caret::Outcome insert(const caret::Target&, const std::string&, const std::string&) override {
    // Issue #6 defines the contract only. Clipboard/paste belong to #7/#8.
    return caret::Outcome::unsupported;
  }
};
}  // namespace

int main() {
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  Win32Platform platform;
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
