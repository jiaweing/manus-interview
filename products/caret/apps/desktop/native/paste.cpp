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

Outcome PastePlatform::insert(const Target& expected, const std::string&,
                              const std::string& text) {
  const auto unicode = utf16(text);  // Conversion before any side effect.
  if (unicode.empty() || cancelled()) return Outcome::unsupported;
  if (!supported_target(expected)) return Outcome::unsupported;
  if (snapshot() != std::optional<Target>(expected)) return Outcome::target_changed;
  if (cancelled()) return Outcome::unsupported;
  if (!write_unicode(unicode)) return Outcome::clipboard_busy;
  const auto start = now_ms();
  for (;;) {
    if (cancelled()) return Outcome::unsupported;
    if (!modifiers().held()) break;
    if (now_ms() - start >= modifier_wait_ms) return Outcome::unsupported;
    wait_ms(modifier_poll_ms);
  }
  if (!supported_target(expected)) return Outcome::unsupported;
  // Never refocus. Check BOTH handles after modifier release, immediately before
  // input. Desktop changes after this check are an unavoidable OS race.
  if (snapshot() != std::optional<Target>(expected)) return Outcome::target_changed;
  if (cancelled()) return Outcome::unsupported;
  const auto sent = send_input(paste_keys);
  return sent == std::size(paste_keys) ? Outcome::paste_requested : Outcome::unsupported;
}
}  // namespace caret
