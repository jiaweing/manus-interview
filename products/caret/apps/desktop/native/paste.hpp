#pragma once

#include "protocol.hpp"
#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

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
inline constexpr unsigned clipboard_restore_ms = 700;
// Win32 standard/system-derived text formats; all other IDs fail closed.
inline constexpr std::uint32_t text_format = 1, oem_text_format = 7,
                               unicode_text_format = 13, locale_format = 16;
bool plain_text_formats(std::span<const std::uint32_t> formats);
// Fast identity precheck, NOT a security hash. Exact UTF-16 equality is also
// required, so a collision can never authorize a restore.
std::uint64_t clipboard_payload_hash(std::u16string_view text);

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
  virtual bool supported_target(const Target& expected) = 0;
  virtual Modifiers modifiers() = 0;
  virtual std::uint64_t now_ms() = 0;
  virtual void wait_ms(unsigned duration) = 0;
  // Clipboard operations require an open lock (except sequence). Each failure
  // is injectable. No method retries. Failed empty/write must leave the current
  // contents unchanged; empty is separate so a failed write remains owned-empty.
  virtual bool open_clipboard() = 0;
  virtual bool clipboard_formats(std::vector<std::uint32_t>& formats) = 0;
  virtual bool read_plain_text(std::u16string& text) = 0;
  virtual bool empty_clipboard() = 0;
  virtual bool write_unicode(const std::u16string& text) = 0;
  virtual std::optional<std::uint32_t> clipboard_sequence() = 0;
  virtual bool close_clipboard() = 0;
  // Return SendInput-equivalent count. A short/failed call is NEVER retried.
  virtual unsigned send_input(std::span<const KeyEvent> events) = 0;
};
std::u16string utf16(std::string_view text);
}  // namespace caret
