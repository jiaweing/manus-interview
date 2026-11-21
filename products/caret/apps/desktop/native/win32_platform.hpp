#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include "paste.hpp"
#include <atomic>

namespace caret {
inline constexpr ULONG_PTR input_tag = 0x43415237;
class Win32Platform : public PastePlatform {
 public:
  explicit Win32Platform(bool watch_stdin = true);
  ~Win32Platform() override;
  std::optional<Target> snapshot() override;
  bool cancelled() override;
  bool supported_target(const Target& expected) override;
  Modifiers modifiers() override;
  std::uint64_t now_ms() override;
  void wait_ms(unsigned duration) override;
  bool write_unicode(const std::u16string& text) override;
  unsigned send_input(std::span<const KeyEvent> events) override;
  void cancel() { cancelled_.store(true); }
 private:
  HWND clipboard_owner_ = nullptr;
  bool watch_stdin_;
  std::atomic<bool> cancelled_ = false;
};
}  // namespace caret
