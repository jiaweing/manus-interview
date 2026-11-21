#include "paste.hpp"
#include <stdexcept>

namespace caret {
std::u16string utf16(std::string_view text) {
  std::u16string out;
  for (std::size_t i = 0; i < text.size();) {
    const auto first = static_cast<unsigned char>(text[i++]);
    unsigned cp = first;
    unsigned count = 0;
    unsigned minimum = 0;
    if (first >= 0xc2 && first <= 0xdf) { cp &= 31; count = 1; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { cp &= 15; count = 2; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { cp &= 7; count = 3; minimum = 0x10000; }
    else if (first >= 0x80) throw std::invalid_argument("Invalid Unicode");
    for (unsigned n = 0; n < count; ++n) {
      if (i == text.size()) throw std::invalid_argument("Invalid Unicode");
      const auto next = static_cast<unsigned char>(text[i++]);
      if ((next & 0xc0) != 0x80) throw std::invalid_argument("Invalid Unicode");
      cp = (cp << 6) | (next & 63);
    }
    if (cp < minimum || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp == 0)
      throw std::invalid_argument("Invalid Unicode");
    if (cp <= 0xffff) out += static_cast<char16_t>(cp);
    else {
      cp -= 0x10000;
      out += static_cast<char16_t>(0xd800 + (cp >> 10));
      out += static_cast<char16_t>(0xdc00 + (cp & 1023));
    }
  }
  return out;
}

bool plain_text_formats(std::span<const std::uint32_t> formats) {
  for (const auto format : formats)
    if (format != text_format && format != oem_text_format &&
        format != unicode_text_format && format != locale_format) return false;
  return true;
}
std::uint64_t clipboard_payload_hash(std::u16string_view text) {
  std::uint64_t hash = 14695981039346656037ull;
  for (const auto unit : text) {
    hash = (hash ^ (unit & 255)) * 1099511628211ull;
    hash = (hash ^ (unit >> 8)) * 1099511628211ull;
  }
  return hash;
}
namespace {
struct ClipboardLock {
  PastePlatform& platform;
  bool active;
  explicit ClipboardLock(PastePlatform& p) : platform(p), active(p.open_clipboard()) {}
  bool close() noexcept {
    if (!active) return true;
    active = false;  // A failed close is reported, never retried.
    try { return platform.close_clipboard(); }
    catch (...) { return false; }
  }
  ~ClipboardLock() { close(); }
};
Outcome restore(PastePlatform& platform, const std::optional<std::u16string>& original,
                const std::optional<std::u16string>& owned,
                std::optional<std::uint32_t> sequence, Outcome outcome) {
  // One scheduled wait, exactly 700 ms, including cancellation and failed input.
  // The wait is not shortened by cancellation. No clipboard open retry loop.
  try { platform.wait_ms(clipboard_restore_ms); }
  catch (...) {
    // A broken timer is a failure, but must not bypass ownership-checked cleanup.
    outcome = Outcome::clipboard_restore_failed;
  }
  try {
    if (!sequence) return Outcome::clipboard_restore_failed;
    ClipboardLock lock(platform);
    if (!lock.active) return Outcome::clipboard_restore_failed;
    const auto current_sequence = platform.clipboard_sequence();
    if (!current_sequence) return Outcome::clipboard_restore_failed;
    if (*current_sequence != *sequence)
      return lock.close() ? outcome : Outcome::clipboard_restore_failed;
    std::vector<std::uint32_t> formats;
    if (!platform.clipboard_formats(formats)) return Outcome::clipboard_restore_failed;
    bool same = false;
    if (!owned) same = formats.empty();
    else if (!formats.empty() && plain_text_formats(formats)) {
      std::u16string current;
      if (!platform.read_plain_text(current)) return Outcome::clipboard_restore_failed;
      same = clipboard_payload_hash(current) == clipboard_payload_hash(*owned) && current == *owned;
    }
    if (!same) return lock.close() ? outcome : Outcome::clipboard_restore_failed;
    if (!platform.empty_clipboard() || (original && !platform.write_unicode(*original)))
      return Outcome::clipboard_restore_failed;
    return lock.close() ? outcome : Outcome::clipboard_restore_failed;
  } catch (...) {
    // Enumeration and text reads allocate in production. Keep their failures
    // typed as restoration failures, with the clipboard lock released by RAII.
    return Outcome::clipboard_restore_failed;
  }
}
}  // namespace

Outcome PastePlatform::insert(const Target& expected, const std::string&,
                              const std::string& text) {
  const auto unicode = utf16(text);  // Conversion before any side effect.
  if (unicode.empty() || cancelled()) return Outcome::unsupported;
  if (!supported_target(expected)) return Outcome::unsupported;
  if (snapshot() != std::optional<Target>(expected)) return Outcome::target_changed;
  if (cancelled()) return Outcome::unsupported;
  ClipboardLock lock(*this);
  if (!lock.active) return Outcome::clipboard_busy;
  std::vector<std::uint32_t> formats;
  if (!clipboard_formats(formats) || !plain_text_formats(formats)) return Outcome::unsupported;
  std::optional<std::u16string> original;
  if (!formats.empty()) {
    std::u16string saved;
    if (!read_plain_text(saved)) return Outcome::unsupported;
    original = std::move(saved);
  }
  if (cancelled()) return Outcome::unsupported;
  std::optional<std::u16string> owned = unicode;  // Allocate before mutation.
  if (!empty_clipboard()) return Outcome::unsupported;
  // From here every exit passes through the same conditional restoration.
  Outcome outcome = Outcome::unsupported;
  std::optional<std::uint32_t> sequence;
  bool closed = false;
  try {
    try {
      if (!write_unicode(unicode)) owned.reset();
    } catch (...) {
      // Failed writes (including exceptions) leave the emptied clipboard
      // unchanged. Capture that owned-empty state under the original lock.
      owned.reset();
    }
    sequence = clipboard_sequence();  // Capture under lock before anyone can copy.
    closed = lock.close();
    if (owned && sequence && closed) {
      outcome = [&]() {
        const auto start = now_ms();
        for (;;) {
          if (cancelled()) return Outcome::unsupported;
          if (!modifiers().held()) break;
          if (now_ms() - start >= modifier_wait_ms) return Outcome::unsupported;
          wait_ms(modifier_poll_ms);
        }
        if (!supported_target(expected)) return Outcome::unsupported;
        // Never refocus. The final check/input boundary is an unavoidable OS race.
        if (snapshot() != std::optional<Target>(expected)) return Outcome::target_changed;
        if (cancelled()) return Outcome::unsupported;
        return send_input(paste_keys) == std::size(paste_keys) ?
          Outcome::paste_requested : Outcome::unsupported;
      }();
    }
  } catch (...) {
    // Ownership/guard/input exceptions also reach the one restore path.
    closed = lock.close();
  }
  const auto result = restore(*this, original, owned, sequence, outcome);
  return closed ? result : Outcome::clipboard_restore_failed;
}
}  // namespace caret
