#include "recording_platform.hpp"
#include <algorithm>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
using caret_test::target;
using caret_test::fixture;
using caret_test::check;
using caret_test::Fake;
unsigned cases = 0;
std::string request(const std::string& id, const std::string& session) {
  return "{\"requestId\":" + caret::quote_json(id) + ",\"op\":\"insert\","
    "\"expectedTarget\":{\"foreground\":\"0x1234\",\"focus\":\"0x5678\"},"
    "\"sessionId\":" + caret::quote_json(session) + ",\"text\":" + caret::quote_json(fixture) + "}";
}
void counts(const char* name, const Fake& fake, unsigned pastes) {
  unsigned ctrl_v = 0;
  bool ctrl = false;
  for (const auto event : fake.keys) {
    if (event.key == caret::Key::control) ctrl = event.down;
    if (event.key == caret::Key::v && event.down && ctrl) ++ctrl_v;
  }
  check(ctrl_v == pastes, "Ctrl+V count");
  check(fake.foreground_setting == 0, "foreground setting");
  // Key enum can express ONLY Ctrl and V, never Enter or an arbitrary key.
  for (const auto key : fake.keys)
    check(key.key == caret::Key::control || key.key == caret::Key::v, "non-paste key");
  std::cout << "PASS " << name << ": Ctrl+V=" << ctrl_v
            << " Enter=0 foreground-setting=0 input-requests=" << fake.inputs << " calls=";
  for (const auto& call : fake.calls) std::cout << call << ',';
  std::cout << " (fake platform; NOT Windows evidence)\n";
  ++cases;
}
void run() {
  {
    Fake fake;
    caret::Protocol protocol(fake);
    check(protocol.dispatch(request("unicode", "unicode")).find("paste_requested") != std::string::npos,
          "Unicode outcome");
    check(fake.input_clipboard == u"Jia Wei Ng — Manus 42" && fake.clipboard == caret_test::sentinel, "Unicode clipboard");
    check(fake.keys == std::vector<caret::KeyEvent>(std::begin(caret::paste_keys), std::end(caret::paste_keys)),
          "exact Ctrl+V sequence");
    check(fake.calls == std::vector<std::string>{"cancelled", "elevation", "snapshot", "cancelled",
          "open", "formats", "read", "cancelled", "empty", "clipboard", "sequence", "close",
          "clock", "cancelled", "modifiers", "elevation", "snapshot", "cancelled", "input",
          "wait", "open", "sequence", "formats", "read", "empty", "clipboard", "close"},
          "guard ordering");
    counts("Unicode insertion", fake, 1);
    const auto calls = fake.calls.size();
    check(protocol.dispatch(request("duplicate", "unicode")).find("duplicate_session") != std::string::npos,
          "duplicate ID accepted");
    check(fake.calls.size() == calls && fake.inputs == 1, "duplicate repeated input");
    std::cout << "PASS duplicate ID: delta Ctrl+V=0 Enter=0 foreground-setting=0 adapter-calls=0\n";
    ++cases;
  }
  {
    Fake fake;
    fake.modifier_states = {{true, false, false}, {false, true, false},
                            {false, false, true}, {false, false, false}};
    check(fake.insert(target, "release", fixture) == caret::Outcome::paste_requested, "release outcome");
    check(fake.waits == 4 && fake.snapshots == 2, "release not awaited/rechecked");
    counts("modifier-release ordering (Ctrl/Alt/Space OR)", fake, 1);
  }
  for (const bool control : {false, true}) {
    for (const bool after_wait : {false, true}) {
      Fake fake;
      const caret::Target changed = control ? caret::Target{target.foreground, "0x9999"} :
                                             caret::Target{"0x9999", target.focus};
      fake.targets = after_wait ? std::vector<std::optional<caret::Target>>{target, changed} :
                                  std::vector<std::optional<caret::Target>>{changed};
      fake.held_polls = after_wait ? 2 : 0;
      check(fake.insert(target, "change", fixture) == caret::Outcome::target_changed, "target change outcome");
      check(fake.writes == (after_wait ? 2u : 0u) && fake.inputs == 0, "changed target side effects");
      counts(control ? (after_wait ? "control change after wait" : "control change before clipboard") :
                       (after_wait ? "foreground change after wait" : "foreground change before clipboard"), fake, 0);
    }
  }
  {
    Fake fake;
    fake.targets = {std::nullopt};
    check(fake.insert(target, "none", fixture) == caret::Outcome::target_changed, "no target outcome");
    check(fake.writes == 0, "no target clipboard write");
    counts("no usable target", fake, 0);
  }
  for (const std::string stage : {"before", "wait", "snapshot"}) {
    Fake fake;
    fake.stop = stage == "before";
    fake.held_polls = 4;
    fake.on_call = [stage](Fake& f, const std::string& call) {
      if ((stage == "wait" && call == "wait") ||
          (stage == "snapshot" && call == "snapshot" && f.snapshots == 1)) f.stop = true;
    };
    check(fake.insert(target, "cancel", fixture) == caret::Outcome::unsupported, "cancel outcome");
    check(fake.inputs == 0, "cancel input");
    if (stage == "before") check(fake.writes == 0, "early cancel clipboard");
    counts(("cancellation " + stage).c_str(), fake, 0);
  }
  {
    Fake fake;
    fake.elevated = true;
    check(fake.insert(target, "elevated", fixture) == caret::Outcome::unsupported, "elevated outcome");
    check(fake.writes == 0 && fake.inputs == 0, "elevated side effects");
    counts("unsupported elevated/inaccessible target", fake, 0);
  }
  {
    Fake fake;
    fake.held_polls = 1000;
    check(fake.insert(target, "timeout", fixture) == caret::Outcome::unsupported, "timeout outcome");
    check(fake.clock == caret::modifier_wait_ms + caret::clipboard_restore_ms && fake.inputs == 0, "unbounded wait");
    // Keep bounded-wait trace concise without losing its call count assertion.
    check(fake.waits == 201, "poll bound");
    counts("bounded modifier timeout", fake, 0);
  }
  {
    Fake fake;
    fake.busy = true;
    check(fake.insert(target, "busy", fixture) == caret::Outcome::clipboard_busy, "busy outcome");
    check(fake.inputs == 0 && fake.writes == 0 && fake.opens == 1, "busy retried");
    counts("clipboard failure no retry", fake, 0);
  }
  for (const unsigned accepted : {0u, 1u, 2u, 3u}) {
    Fake fake;
    fake.accepted = accepted;
    caret::Protocol protocol(fake);
    check(protocol.dispatch(request("failure", "failure")).find("unsupported") != std::string::npos,
          "failed input outcome");
    const auto calls = fake.calls.size();
    check(protocol.dispatch(request("retry", "failure")).find("duplicate_session") != std::string::npos,
          "failed session reused");
    check(fake.inputs == 1 && fake.calls.size() == calls, "failed input retried");
    counts(accepted == 0 ? "failed input; duplicate cannot retry" : "partial input; duplicate cannot retry",
           fake, accepted >= 2 ? 1 : 0);
  }
  check(caret::utf16("你好 \xf0\x9f\x8e\x99") == u"你好 🎙", "surrogate conversion");
  std::cout << "PASS additional CJK and astral Unicode conversion\n";
  ++cases;
  std::cout << "PASS guarded paste suite: " << cases << " cases (fake platform only)\n";
}
}  // namespace
int main() {
  try { run(); return 0; }
  catch (const std::exception& error) { std::cerr << "FAIL paste fixture: " << error.what() << '\n'; return 1; }
}
