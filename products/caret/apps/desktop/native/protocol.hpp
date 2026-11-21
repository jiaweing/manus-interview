#pragma once

#include <cstddef>
#include <istream>
#include <optional>
#include <string>
#include <unordered_set>

namespace caret {
inline constexpr std::size_t max_line_bytes = 65536;
inline constexpr std::size_t max_text_bytes = 32768;
inline constexpr std::size_t max_ids = 4096;

struct Target {
  std::string foreground;
  std::string focus;
  bool operator==(const Target&) const = default;
};

enum class Outcome { target_changed, clipboard_busy, clipboard_restore_failed, unsupported, paste_requested };

// Only this adapter can touch the desktop. The protocol must validate/dedupe first.
class Platform {
 public:
  virtual ~Platform() = default;
  virtual std::optional<Target> snapshot() = 0;
  virtual Outcome insert(const Target& expected, const std::string& session_id,
                         const std::string& text) = 0;
};

enum class LineStatus { complete, too_long, truncated, end };
LineStatus read_line(std::istream& input, std::string& line);
std::string quote_json(const std::string& value);
bool valid_handle(const std::string& value);

class Protocol {
 public:
  explicit Protocol(Platform& platform) : platform_(platform) {}
  std::string dispatch(const std::string& line);
  static std::string invalid_request();

 private:
  Platform& platform_;
  // Never evict: recycling an ID during this process's lifetime is unsafe.
  std::unordered_set<std::string> request_ids_;
  std::unordered_set<std::string> session_ids_;
};
}  // namespace caret
