#include "recording_platform.hpp"
#include <iostream>
#include <iomanip>

namespace {
using namespace caret_test;
using caret::Outcome;
unsigned cases = 0;
void pass(const char* name, const Fake& fake) {
  check(!fake.locked, "clipboard lock leaked");
  std::cout << "PASS " << name << ": opens=" << fake.opens << " inputs=" << fake.inputs
            << " restore-waits=" << std::count_if(fake.timers.begin(), fake.timers.end(),
              [](const auto& timer) { return timer.second == 700; })
            << " payload-hash=" << std::hex << caret::clipboard_payload_hash(fake.clipboard)
            << std::dec << " (synthetic recording fixture; NOT Windows evidence)\n";
  ++cases;
}
void restored(const Fake& fake, unsigned inputs = 1) {
  check(fake.clipboard == sentinel, "sentinel not restored");
  check(fake.inputs == inputs && fake.opens == 2, "paste/open count");
  check(fake.timers.back().second == 700, "restore timer must be exactly 700 ms");
  check(fake.invocations.at("sequence") == 2, "ownership sequence not compared");
}
void run() {
  {
    Fake f;
    check(f.insert(target, "plain", fixture) == Outcome::paste_requested, "plain outcome");
    restored(f);
    check(f.timers == std::vector<std::pair<std::uint64_t, unsigned>>{{0, 700}}, "700 ms schedule");
    check(f.input_clipboard == caret::utf16(fixture), "owned Unicode missing at input");
    pass("plain-text restore / exactly 700 ms timer", f);
  }
  {
    Fake f; f.formats.clear(); f.data.clear(); f.clipboard.clear();
    check(f.insert(target, "empty", fixture) == Outcome::paste_requested, "empty outcome");
    check(f.formats.empty() && f.data.empty() && f.clipboard.empty(), "empty not restored");
    check(f.writes == 1 && f.empties == 2 && f.opens == 2, "empty restore operations");
    pass("empty restore", f);
  }
  for (const auto& formats : std::vector<std::vector<std::uint32_t>>{
      {1}, {7}, {13}, {1, 7, 13, 16}, {1, 16}, {7, 16}}) {
    Fake f; f.formats = formats;
    check(f.insert(target, "derived", fixture) == Outcome::paste_requested, "system text formats rejected");
    restored(f); pass("plain-text/system-derived format set", f);
  }
  for (const std::string stage : {"clipboard", "wait", "snapshot"}) {
    Fake f; f.held_polls = stage == "wait" ? 2 : 0;
    f.on_call = [stage](Fake& f, const std::string& call) {
      if ((stage == "clipboard" && call == "close" && f.closes == 1) ||
          (stage == "wait" && call == "wait") ||
          (stage == "snapshot" && call == "snapshot" && f.snapshots == 1)) f.stop = true;
    };
    check(f.insert(target, "cancel", fixture) == Outcome::unsupported, "cancel outcome");
    restored(f, 0); pass(("post-mutation cancel at " + stage).c_str(), f);
  }
  for (const bool control : {false, true}) {
    Fake f;
    f.targets = {target, control ? caret::Target{target.foreground, "0x9999"} :
                                 caret::Target{"0x9999", target.focus}};
    check(f.insert(target, "late", fixture) == Outcome::target_changed, "late change outcome");
    restored(f, 0); pass(control ? "late control-change restore" : "late foreground-change restore", f);
  }
  for (unsigned count = 0; count < 4; ++count) {
    Fake f; f.accepted = count;
    check(f.insert(target, "input", fixture) == Outcome::unsupported, "input failure outcome");
    restored(f); check(f.invocations.at("open") == 2, "input retried");
    pass("failed/short input restore (zero input retries)", f);
  }
  {
    Fake f; f.held_polls = 1000;
    check(f.insert(target, "timeout", fixture) == Outcome::unsupported, "modifier timeout outcome");
    restored(f, 0); check(f.clock == 2700, "modifier wait plus restore timing");
    pass("modifier timeout restore", f);
  }
  {
    Fake f;
    f.on_call = [](Fake&, const std::string& call) { if (call == "input") throw std::runtime_error("synthetic input failure"); };
    check(f.insert(target, "exception", fixture) == Outcome::unsupported, "input exception outcome");
    restored(f, 0); pass("input exception restore", f);
  }
  for (const bool same_payload : {false, true}) {
    Fake f;
    f.on_call = [same_payload](Fake& f, const std::string& call) {
      if (call == "wait") f.copy(same_payload ? caret::utf16(fixture) : u"Synthetic newer copy");
    };
    check(f.insert(target, "newer", fixture) == Outcome::paste_requested, "newer sequence outcome");
    check(f.clipboard == (same_payload ? caret::utf16(fixture) : u"Synthetic newer copy"), "newer copy overwritten");
    check(f.empties == 1 && f.writes == 1 && f.opens == 2, "sequence mismatch mutated clipboard");
    pass(same_payload ? "newer sequence with identical payload preserved" : "newer sequence preserved", f);
  }
  {
    Fake f;
    f.on_call = [](Fake& f, const std::string& call) { if (call == "wait") f.copy(u"Synthetic payload mismatch", false); };
    check(f.insert(target, "mismatch", fixture) == Outcome::paste_requested, "payload mismatch outcome");
    check(f.clipboard == u"Synthetic payload mismatch" && f.writes == 1 && f.empties == 1, "payload mismatch overwritten");
    pass("owned payload mismatch with unchanged sequence preserved", f);
  }
  {
    Fake f;
    f.on_call = [](Fake& f, const std::string& call) {
      if (call == "wait") { f.formats.push_back(0xc010); f.data[0xc010] = "Synthetic new rich format"; }
    };
    check(f.insert(target, "formats-changed", fixture) == Outcome::paste_requested, "changed formats outcome");
    check(f.formats.size() == 2 && f.empties == 1 && f.writes == 1, "new format overwritten");
    pass("unchanged sequence with new unsupported format preserved", f);
  }
  {
    Fake f; f.copy(u"");
    check(f.insert(target, "empty-text", fixture) == Outcome::paste_requested, "empty text outcome");
    check(f.clipboard.empty() && f.formats == std::vector<std::uint32_t>{13} && f.writes == 2, "empty text confused with empty clipboard");
    pass("empty Unicode text restored as text, not empty clipboard", f);
  }
  for (const auto& [name, format] : std::vector<std::pair<const char*, std::uint32_t>>{
      {"HTML", 0xc001}, {"RTF", 0xc002}, {"bitmap", 2}, {"DIB image", 8},
      {"private format", 0x200}, {"registered format", 0xc003}, {"unknown standard format", 3}}) {
    Fake f;
    f.formats.push_back(format); f.data[format] = "Synthetic rejected binary fixture";
    const auto before = f.native_snapshot();
    check(f.insert(target, "reject", fixture) == Outcome::unsupported, "rich/private format accepted");
    check(before == f.native_snapshot(), "rejected format IDs/data changed");
    check(f.inputs == 0 && f.writes == 0 && f.empties == 0 && f.opens == 1 && f.timers.empty(), "rejection mutated/retried");
    // Full byte equality above is stronger than this report's deterministic hash.
    for (const auto& [id, data] : before.second) {
      std::uint64_t hash = 14695981039346656037ull;
      for (const unsigned char byte : data) hash = (hash ^ byte) * 1099511628211ull;
      std::cout << "SNAPSHOT rejected format=" << id << " before/after-hash=" << std::hex << hash << std::dec << '\n';
    }
    pass(name, f);
  }
  {
    Fake f; f.busy = true; const auto before = f.native_snapshot();
    check(f.insert(target, "busy", fixture) == Outcome::clipboard_busy, "initial busy outcome");
    check(f.opens == 1 && f.inputs == 0 && f.empties == 0 && f.writes == 0 && before == f.native_snapshot(), "busy mutated/retried");
    pass("initial busy: paste count 0, zero retries", f);
  }
  {
    Fake f; f.fail_at["open"] = 2;
    check(f.insert(target, "restore-busy", fixture) == Outcome::clipboard_restore_failed, "restore busy not reported");
    check(f.opens == 2 && f.writes == 1 && f.empties == 1 && f.clipboard == caret::utf16(fixture), "restore busy retried/overwritten");
    pass("restore busy: single attempt, failure outcome, zero retries", f);
  }
  for (const std::string operation : {"formats", "read", "empty"}) {
    Fake f; f.fail_at[operation] = 1; const auto before = f.native_snapshot();
    check(f.insert(target, "failure", fixture) == Outcome::unsupported, "initial operation failure outcome");
    check(before == f.native_snapshot() && f.inputs == 0 && f.timers.empty(), "initial failure mutation");
    pass(("initial " + operation + " failure").c_str(), f);
  }
  {
    Fake f; f.fail_at["clipboard"] = 1;
    check(f.insert(target, "write", fixture) == Outcome::unsupported, "owned write failure outcome");
    restored(f, 0); check(f.writes == 2, "failed owned write not restored from empty");
    pass("failed owned write restores snapshot from owned-empty", f);
  }
  for (const std::string operation : {"formats", "read", "empty", "clipboard", "sequence", "close"}) {
    Fake f; f.fail_at[operation] = 2;
    check(f.insert(target, "restore-fail", fixture) == Outcome::clipboard_restore_failed, "restore failure not reported");
    check(f.opens == 2 && f.invocations.at(operation) == 2, "restore operation retried");
    pass(("restore " + operation + " failure / zero retries").c_str(), f);
  }
  for (const std::string operation : {"sequence", "close"}) {
    Fake f; f.fail_at[operation] = 1;
    check(f.insert(target, "record-fail", fixture) == Outcome::clipboard_restore_failed, "ownership recording failure not reported");
    check(f.inputs == 0 && f.timers.size() == 1 && f.timers[0].second == 700, "recording failure bypasses cleanup");
    pass(("ownership " + operation + " failure").c_str(), f);
  }
  check(caret::clipboard_payload_hash(u"") == 14695981039346656037ull, "hash empty reference");
  check(caret::clipboard_payload_hash(u"ab") != caret::clipboard_payload_hash(u"ba"), "hash ordering");
  check(caret::clipboard_payload_hash(u"a") != caret::clipboard_payload_hash(std::u16string_view(u"a\0b", 3)), "hash length/NUL comparison");
  std::cout << "PASS hash comparison uses all UTF-16 bytes plus exact equality\n"; ++cases;
  std::cout << "PASS clipboard policy suite: " << cases << " cases (fake platform only)\n";
}
}  // namespace
int main() {
  try { run(); return 0; }
  catch (const std::exception& error) { std::cerr << "FAIL clipboard policy fixture: " << error.what() << '\n'; return 1; }
}
