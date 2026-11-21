#pragma once

#include "protocol.hpp"
#include <cstdint>
#include <span>
#include <string_view>

namespace caret {
enum class Key { control, v };
struct KeyEvent {
  Key key;
  bool down;
  bool operator==(const KeyEvent&) const = default;
};
inline constexpr KeyEvent paste_keys[] = {
  {Key::control, true}, {Key::v, true}, {Key::v, false}, {Key::control, false}
};
inline constexpr std::uint64_t modifier_wait_ms = 2000;
inline constexpr unsigned modifier_poll_ms = 10;

struct Modifiers {
  bool control = false;
  bool alt = false;
  bool space = false;
  bool held() const { return control || alt || space; }
};

// This is the ONLY insertion algorithm; Win32 and fixtures share it. Protocol
// validation and app-lifetime session reservation happen before insert is called.
class PastePlatform : public Platform {
 public:
  Outcome insert(const Target& expected, const std::string& session_id,
                 const std::string& text) final;
  virtual bool cancelled() = 0;
  // Fail closed for inaccessible processes / unknown elevation.
  virtual bool supported_target(const Target& expected) = 0;
  virtual Modifiers modifiers() = 0;
  virtual std::uint64_t now_ms() = 0;
  virtual void wait_ms(unsigned duration) = 0;
  // Issue #8 seam: replace this one-way write with snapshot/ownership/restore.
  // No clipboard reading, format rejection, save, or restoration in issue #7.
  virtual bool write_unicode(const std::u16string& text) = 0;
  // Return SendInput-equivalent count. A short/failed call is NEVER retried.
  virtual unsigned send_input(std::span<const KeyEvent> events) = 0;
};
std::u16string utf16(std::string_view text);
}  // namespace caret
