// REAL Windows clipboard + shared production policy. NOT RUN: needs Windows.
// Only synthetic fixtures are read/hashed. Refuse valuable clipboard contents.
#include "../win32_platform.hpp"
#include <algorithm>
#include <functional>
#include <cwctype>
#include <iostream>
#include <map>
#include <stdexcept>
#include <thread>

namespace {
const std::string payload = "Caret synthetic Unicode \xe2\x80\x94 42";
const std::u16string sentinel = u"Caret synthetic clipboard sentinel 42";
const std::u16string newer = u"Caret synthetic newer copy 99";
unsigned cases = 0;
void check(bool ok, const char* why) { if (!ok) throw std::runtime_error(why); }
void delay(unsigned ms) {
  const auto end = GetTickCount64() + ms;
  do {
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message); DispatchMessageW(&message);
    }
    Sleep(1);
  } while (GetTickCount64() < end);
}
void arm(const char* extra = "Keep Notepad focused until the case finishes.") {
  std::cout << "\nPrepare a non-sensitive, NON-elevated Notepad scratch document. " << extra
            << "\nPress Enter, then focus Notepad within 5 seconds.\n" << std::flush;
  std::string line; std::getline(std::cin, line); delay(5000);
}
void seed(const std::optional<std::u16string>& text) {
  caret::Win32Platform p(false);
  check(p.open_clipboard(), "Seed clipboard open (no retry)");
  const bool ok = p.empty_clipboard() && (!text || p.write_unicode(*text));
  const bool closed = p.close_clipboard();
  check(ok && closed, "Seed clipboard write/close");
}
std::u16string read_text() {
  caret::Win32Platform p(false); std::u16string text;
  check(p.open_clipboard(), "Observer clipboard open (no retry)");
  const bool ok = p.read_plain_text(text), closed = p.close_clipboard();
  check(ok && closed, "Observer text read/close"); return text;
}
using NativeSnapshot = std::map<UINT, std::vector<unsigned char>>;
NativeSnapshot native_snapshot() {
  caret::Win32Platform p(false);
  check(p.open_clipboard(), "Native snapshot open (no retry)");
  NativeSnapshot result;
  UINT format = 0;
  for (;;) {
    SetLastError(ERROR_SUCCESS); format = EnumClipboardFormats(format);
    if (!format) { check(GetLastError() == ERROR_SUCCESS, "Native snapshot enumeration"); break; }
    const HANDLE data = GetClipboardData(format);
    check(data != nullptr, "Native snapshot data");
    auto& bytes = result[format];
    if (format == CF_BITMAP) {
      BITMAP bitmap{};
      check(GetObjectW(data, sizeof(bitmap), &bitmap) == sizeof(bitmap), "Bitmap metadata");
      const auto size = static_cast<std::size_t>(bitmap.bmWidthBytes) * static_cast<std::size_t>(bitmap.bmHeight);
      bytes.resize(size);
      check(GetBitmapBits(static_cast<HBITMAP>(data), static_cast<LONG>(size), bytes.data()) == static_cast<LONG>(size), "Bitmap snapshot bytes");
    } else {
      const auto size = GlobalSize(data);
      const auto* source = static_cast<const unsigned char*>(GlobalLock(data));
      check(source != nullptr && size != 0, "Native snapshot global data");
      bytes.assign(source, source + size); GlobalUnlock(data);
    }
  }
  check(p.close_clipboard(), "Native snapshot close"); return result;
}
void report_snapshot(const char* phase, const NativeSnapshot& snapshot) {
  for (const auto& [id, bytes] : snapshot) {
    std::uint64_t hash = 14695981039346656037ull;
    for (auto byte : bytes) hash = (hash ^ byte) * 1099511628211ull;
    std::cout << "NATIVE-SNAPSHOT " << phase << " format=" << id << " bytes=" << bytes.size()
              << " fnv1a64=" << std::hex << hash << std::dec << '\n';
  }
}
// Another thread genuinely holds the Win32 clipboard lock. One open, no retries.
struct ClipboardBlocker {
  HANDLE ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HANDLE release = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  std::thread thread;
  bool acquired = false;
  ClipboardBlocker() {
    check(ready && release, "Blocker events");
    thread = std::thread([this] {
      acquired = OpenClipboard(nullptr) != FALSE;
      SetEvent(ready); WaitForSingleObject(release, INFINITE);
      if (acquired) CloseClipboard();
    });
    check(WaitForSingleObject(ready, 3000) == WAIT_OBJECT_0, "Blocker ready");
    if (!acquired) { stop(); throw std::runtime_error("Native blocker open failed (no retry)"); }
  }
  void stop() {
    if (thread.joinable()) { SetEvent(release); thread.join(); }
  }
  ~ClipboardBlocker() { stop(); CloseHandle(ready); CloseHandle(release); }
};
struct Probe : caret::Win32Platform {
  Probe() : caret::Win32Platform(false) {}
  unsigned opens = 0, writes = 0, empties = 0, inputs = 0, timer_count = 0;
  unsigned scheduled_ms = 0;
  std::uint64_t elapsed_ms = 0;
  std::optional<std::uint32_t> owned_sequence;
  bool cancel_after_write = false, target_change_after_write = false, fail_input = false;
  bool mask_sequence = false;
  std::function<void()> during_timer;
  bool open_clipboard() override { ++opens; return caret::Win32Platform::open_clipboard(); }
  bool empty_clipboard() override { ++empties; return caret::Win32Platform::empty_clipboard(); }
  bool write_unicode(const std::u16string& text) override { ++writes; return caret::Win32Platform::write_unicode(text); }
  std::optional<std::uint32_t> clipboard_sequence() override {
    const auto actual = caret::Win32Platform::clipboard_sequence();
    if (!owned_sequence) owned_sequence = actual;
    // Explicit sequence fault injection makes real changed bytes exercise the
    // second ownership check. NOT a naturally unchanged Windows sequence.
    return mask_sequence ? owned_sequence : actual;
  }
  bool close_clipboard() override {
    const bool ok = caret::Win32Platform::close_clipboard();
    if (opens == 1 && writes == 1) {
      if (cancel_after_write) cancel();  // Explicit production cancellation flag.
      if (target_change_after_write) {
        std::cout << "Clipboard mutated. NOW switch to another editable application within 3 seconds.\n" << std::flush;
        delay(3000);
      }
    }
    return ok;
  }
  unsigned send_input(std::span<const caret::KeyEvent> events) override {
    ++inputs;
    if (fail_input) return 0;  // Explicit fault injection, not a natural OS failure.
    return caret::Win32Platform::send_input(events);
  }
  void wait_ms(unsigned duration) override {
    if (duration != caret::clipboard_restore_ms) { caret::Win32Platform::wait_ms(duration); return; }
    ++timer_count; scheduled_ms = duration;
    if (during_timer) during_timer();
    const auto start = GetTickCount64();
    caret::Win32Platform::wait_ms(duration);
    elapsed_ms = GetTickCount64() - start;
  }
};
caret::Target capture(Probe& p) {
  const auto target = p.snapshot();
  check(target && p.supported_target(*target), "No supported non-elevated focused target");
  DWORD pid = 0;
  GetWindowThreadProcessId(GetForegroundWindow(), &pid);
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  check(process != nullptr, "Notepad process query");
  wchar_t path[32768]{}; DWORD size = 32768;
  const bool found = QueryFullProcessImageNameW(process, 0, path, &size) != FALSE;
  CloseHandle(process);
  std::wstring name(path, size);
  std::transform(name.begin(), name.end(), name.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
  check(found && name.ends_with(L"\\notepad.exe"), "Initial target must be Notepad, not the terminal");
  return *target;
}
void pass(const char* name, const Probe& p, bool mutated) {
  if (mutated) {
    check(p.timer_count == 1 && p.scheduled_ms == 700 && p.elapsed_ms >= 700, "700 ms scheduled timer/timing");
  } else check(p.timer_count == 0, "Rejected case scheduled restoration");
  std::cout << "PASS " << name << ": paste-requests=" << p.inputs << " policy-opens=" << p.opens
            << " policy-writes=" << p.writes << " scheduled-ms=" << p.scheduled_ms
            << " observed-wait-ms=" << p.elapsed_ms << '\n'; ++cases;
}
void add_format(UINT format) {
  caret::Win32Platform p(false);
  check(p.open_clipboard(), "Unsupported fixture open (no retry)");
  if (format == CF_BITMAP) {
    const DWORD pixels[4] = {0, 0x00ffffff, 0x00ffffff, 0};
    HBITMAP bitmap = CreateBitmap(2, 2, 1, 32, pixels);
    check(bitmap != nullptr, "Synthetic bitmap allocation");
    if (!SetClipboardData(format, bitmap)) { DeleteObject(bitmap); throw std::runtime_error("Bitmap seed"); }
  } else {
    constexpr char data[] = "Caret synthetic unsupported fixture";
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(data));
    check(memory != nullptr, "Synthetic unsupported allocation");
    void* destination = GlobalLock(memory); check(destination != nullptr, "Synthetic unsupported lock");
    std::copy(std::begin(data), std::end(data), static_cast<char*>(destination)); GlobalUnlock(memory);
    if (!SetClipboardData(format, memory)) { GlobalFree(memory); throw std::runtime_error("Unsupported seed"); }
  }
  check(p.close_clipboard(), "Unsupported fixture close");
}
void run() {
  std::cout << "REAL WINDOWS HARNESS: replaces clipboard with SYNTHETIC fixtures; never records user contents.\n"
            << "Empty/remove valuable clipboard data first, disable clipboard-history/cloud-sync/managers.\n"
            << "Type SYNTHETIC to authorize replacement.\n" << std::flush;
  std::string authorization; std::getline(std::cin, authorization);
  check(authorization == "SYNTHETIC", "Synthetic clipboard authorization missing");
  for (const bool empty : {false, true}) {
    arm(); seed(empty ? std::nullopt : std::optional<std::u16string>(sentinel)); Probe p; const auto target = capture(p);
    check(p.insert(target, "restore", payload) == caret::Outcome::paste_requested, "Restore outcome");
    if (empty) check(native_snapshot().empty(), "Originally empty clipboard not empty");
    else check(read_text() == sentinel, "Plain sentinel not restored");
    check(p.inputs == 1 && p.opens == 2, "Restore paste/open count");
    pass(empty ? "empty restore" : "plain-text restore", p, true);
  }
  for (unsigned scenario = 0; scenario < 3; ++scenario) {
    arm(scenario == 1 ? "After the mutation prompt switch to another application's editable field." : "Keep focus; failure/cancellation flags are explicitly fault-injected.");
    seed(sentinel); Probe p; const auto target = capture(p);
    p.cancel_after_write = scenario == 0; p.target_change_after_write = scenario == 1; p.fail_input = scenario == 2;
    const auto outcome = p.insert(target, "exit", payload);
    check(outcome == (scenario == 1 ? caret::Outcome::target_changed : caret::Outcome::unsupported), "Post-mutation exit outcome");
    check(read_text() == sentinel && p.opens == 2 && p.inputs == (scenario == 2 ? 1u : 0u), "Post-mutation exit restore/count");
    pass(scenario == 0 ? "post-mutation cancel restore (flag-injected)" : scenario == 1 ? "post-mutation target-change restore (real operator change)" : "post-mutation input-failure restore (return-injected)", p, true);
  }
  for (unsigned scenario = 0; scenario < 3; ++scenario) {
    arm(); seed(sentinel); Probe p; const auto target = capture(p);
    p.mask_sequence = scenario == 2;
    p.during_timer = [scenario] { seed(scenario == 1 ? caret::utf16(payload) : newer); };
    check(p.insert(target, "newer", payload) == caret::Outcome::paste_requested, "Newer outcome");
    check(read_text() == (scenario == 1 ? caret::utf16(payload) : newer), "Newer copy overwritten");
    check(p.empties == 1 && p.writes == 1 && p.opens == 2, "Newer clip mutated by restoration");
    pass(scenario == 2 ? "payload mismatch (sequence explicitly masked)" : scenario == 1 ? "newer sequence with same payload" : "newer sequence", p, true);
  }
  const UINT html = RegisterClipboardFormatW(L"HTML Format"), rtf = RegisterClipboardFormatW(L"Rich Text Format");
  check(html && rtf, "Registered fixture formats");
  for (const auto& [name, format] : std::vector<std::pair<const char*, UINT>>{{"HTML", html}, {"RTF", rtf}, {"bitmap", CF_BITMAP}, {"private format", CF_PRIVATEFIRST}}) {
    arm(); seed(sentinel); add_format(format);
    const auto before = native_snapshot(); report_snapshot("before", before);
    Probe p; const auto target = capture(p);
    check(p.insert(target, "reject", payload) == caret::Outcome::unsupported, "Unsupported format accepted");
    const auto after = native_snapshot(); report_snapshot("after", after);
    check(before == after && p.writes == 0 && p.empties == 0 && p.inputs == 0 && p.opens == 1, "Rejected native snapshot changed");
    pass(name, p, false);
  }
  {
    arm(); seed(sentinel); const auto before = native_snapshot(); Probe p; const auto target = capture(p);
    { ClipboardBlocker blocker;
      check(p.insert(target, "busy", payload) == caret::Outcome::clipboard_busy, "Initial native busy outcome"); }
    check(before == native_snapshot() && p.inputs == 0 && p.opens == 1, "Initial busy mutated/retried");
    pass("initial busy (real Win32 lock), paste count 0", p, false);
  }
  {
    arm(); seed(sentinel); Probe p; const auto target = capture(p);
    std::optional<ClipboardBlocker> blocker;
    p.during_timer = [&] { blocker.emplace(); };
    check(p.insert(target, "restore-busy", payload) == caret::Outcome::clipboard_restore_failed, "Restore native busy not reported");
    blocker.reset();
    check(read_text() == caret::utf16(payload) && p.opens == 2 && p.writes == 1 && p.empties == 1, "Restore busy retried/mutated");
    pass("restore busy (real Win32 lock), zero retries", p, true);
  }
  seed(std::nullopt);
  std::cout << "PASS Windows clipboard policy: " << cases << " cases. Save this native hash/timing report with source commit and Windows/Bun/compiler versions.\n";
}
}  // namespace
int main() {
  try { run(); return 0; }
  catch (const std::exception& error) { std::cerr << "FAIL Windows clipboard policy: " << error.what() << '\n'; return 1; }
}
