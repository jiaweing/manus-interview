#pragma once
#include "../paste.hpp"
#include <algorithm>
#include <functional>
#include <map>
#include <stdexcept>
#include <vector>

namespace caret_test {
inline const caret::Target target{"0x1234", "0x5678"};
inline const std::string fixture = "Jia Wei Ng \xe2\x80\x94 Manus 42";
inline const std::u16string sentinel = u"Synthetic clipboard sentinel 42";
inline void check(bool ok, const char* why) { if (!ok) throw std::runtime_error(why); }
inline std::string bytes(std::u16string_view text) {
  std::string data;
  for (const auto c : text) { data += static_cast<char>(c & 255); data += static_cast<char>(c >> 8); }
  data.append(2, '\0');
  return data;
}
struct Fake final : caret::PastePlatform {
  std::vector<std::string> calls;
  std::vector<caret::KeyEvent> keys;
  std::u16string clipboard = sentinel;
  std::u16string input_clipboard;
  std::vector<std::uint32_t> formats{caret::unicode_text_format};
  std::map<std::uint32_t, std::string> data{{caret::unicode_text_format, bytes(sentinel)}};
  std::vector<std::optional<caret::Target>> targets{target, target};
  std::vector<caret::Modifiers> modifier_states;
  std::function<void(Fake&, const std::string&)> on_call;
  // method -> invocation to fail; every operation can fail independently.
  std::map<std::string, unsigned> fail_at, invocations;
  std::vector<std::pair<std::uint64_t, unsigned>> timers;
  std::size_t snapshots = 0;
  unsigned held_polls = 0, polls = 0, waits = 0, writes = 0, inputs = 0;
  unsigned accepted = 4, foreground_setting = 0, opens = 0, closes = 0, empties = 0;
  std::uint64_t clock = 0;
  std::uint32_t sequence = 100;
  bool stop = false, elevated = false, busy = false, locked = false;
  void record(const std::string& call) {
    calls.push_back(call);
    if (on_call) on_call(*this, call);
  }
  bool success(const std::string& call) {
    record(call);
    const auto count = ++invocations[call];
    return !fail_at.contains(call) || fail_at.at(call) != count;
  }
  auto native_snapshot() const { return std::pair{formats, data}; }
  void copy(std::u16string text, bool change_sequence = true) {
    clipboard = std::move(text);
    formats = {caret::unicode_text_format};
    data = {{caret::unicode_text_format, bytes(clipboard)}};
    if (change_sequence) ++sequence;
  }
  std::optional<caret::Target> snapshot() override {
    record("snapshot");
    return targets.at(std::min(snapshots++, targets.size() - 1));
  }
  bool cancelled() override { record("cancelled"); return stop; }
  bool supported_target(const caret::Target&) override { record("elevation"); return !elevated; }
  caret::Modifiers modifiers() override {
    record("modifiers");
    if (!modifier_states.empty())
      return modifier_states.at(std::min<std::size_t>(polls++, modifier_states.size() - 1));
    return {polls++ < held_polls, false, false};
  }
  std::uint64_t now_ms() override { record("clock"); return clock; }
  void wait_ms(unsigned duration) override {
    timers.emplace_back(clock, duration);
    record("wait"); ++waits; clock += duration;
  }
  bool open_clipboard() override {
    ++opens;
    if (!success("open") || busy) return false;
    check(!locked, "double open"); locked = true; return true;
  }
  bool clipboard_formats(std::vector<std::uint32_t>& out) override {
    check(locked, "enumeration without lock");
    if (!success("formats")) return false;
    out = formats; return true;
  }
  bool read_plain_text(std::u16string& out) override {
    check(locked, "read without lock");
    if (!success("read")) return false;
    out = clipboard; return true;
  }
  bool empty_clipboard() override {
    check(locked, "empty without lock"); ++empties;
    if (!success("empty")) return false;
    clipboard.clear(); formats.clear(); data.clear(); ++sequence; return true;
  }
  bool write_unicode(const std::u16string& text) override {
    check(locked, "write without lock"); ++writes;
    if (!success("clipboard")) return false;
    copy(text); return true;
  }
  std::optional<std::uint32_t> clipboard_sequence() override {
    if (!success("sequence")) return std::nullopt;
    return sequence;
  }
  bool close_clipboard() override {
    check(locked, "close without lock"); ++closes;
    locked = false; return success("close");
  }
  unsigned send_input(std::span<const caret::KeyEvent> events) override {
    record("input"); ++inputs;
    input_clipboard = clipboard;
    keys.assign(events.begin(), events.begin() + std::min<std::size_t>(accepted, events.size()));
    return accepted;
  }
};
}  // namespace caret_test
