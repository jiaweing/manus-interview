#include "../win32_platform.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
const std::string fixture = "Jia Wei Ng \xe2\x80\x94 Manus 42";
std::vector<std::pair<DWORD, bool>> observed;
HHOOK hook = nullptr;
void check(bool ok, const char* why) { if (!ok) throw std::runtime_error(why); }
void pump() {
  MSG message{};
  while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
    TranslateMessage(&message); DispatchMessageW(&message);
  }
}
void delay(unsigned ms) {
  const auto until = GetTickCount64() + ms;
  while (GetTickCount64() < until) { pump(); Sleep(10); }
}
LRESULT CALLBACK keyboard(int code, WPARAM event, LPARAM data) {
  if (code == HC_ACTION) {
    const auto* key = reinterpret_cast<const KBDLLHOOKSTRUCT*>(data);
    if ((key->flags & LLKHF_INJECTED) && key->dwExtraInfo == caret::input_tag) {
      const bool down = event == WM_KEYDOWN || event == WM_SYSKEYDOWN;
      observed.emplace_back(key->vkCode, down);
      // Numeric event metadata only. Never record real user keystrokes/text.
      std::cout << "EVENT injected vk=" << key->vkCode << " down=" << down << '\n';
    }
  }
  return CallNextHookEx(hook, code, event, data);
}
void counts(const char* name, unsigned expected, std::optional<unsigned> calls) {
  delay(200);
  unsigned pastes = 0, enters = 0;
  bool ctrl = false;
  for (const auto& [key, down] : observed) {
    check(key == VK_CONTROL || key == VK_LCONTROL || key == VK_RCONTROL || key == 'V',
          "Unexpected injected key");
    if (key == VK_CONTROL || key == VK_LCONTROL || key == VK_RCONTROL) ctrl = down;
    if (key == 'V' && down && ctrl) ++pastes;
    if (key == VK_RETURN && down) ++enters;
  }
  check(pastes == expected && enters == 0, "Input-event count mismatch");
  if (expected == 1) {
    check(observed.size() == 4 && observed[0].second && observed[1] == std::pair<DWORD, bool>{'V', true} &&
          observed[2] == std::pair<DWORD, bool>{'V', false} && !observed[3].second && !ctrl,
          "Not exactly Ctrl-down V-down V-up Ctrl-up");
  } else check(observed.empty(), "Rejected attempt emitted keys");
  std::cout << "PASS " << name << ": Ctrl+V=" << pastes << " Enter=" << enters
            << " foreground-setting=0 input-requests=";
  if (calls) std::cout << *calls;
  else std::cout << "not-instrumented";
  std::cout << " (foreground-setting APIs absent; source audit required)\n";
}
void arm(const char* instruction) {
  std::cout << '\n' << instruction << "\nPress Enter here to arm; then use mouse/keyboard to focus the target within 5 seconds.\n" << std::flush;
  std::string line;
  std::getline(std::cin, line);
  delay(5000);
  observed.clear();
}
bool notepad(const caret::Target& target) {
  const auto hwnd = reinterpret_cast<HWND>(static_cast<std::uintptr_t>(std::stoull(target.foreground, nullptr, 16)));
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return false;
  wchar_t path[32768]{};
  DWORD size = 32768;
  const bool ok = QueryFullProcessImageNameW(process, 0, path, &size) != FALSE;
  CloseHandle(process);
  std::wstring value(path);
  std::transform(value.begin(), value.end(), value.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
  return ok && value.ends_with(L"\\notepad.exe");
}
struct ObservedPlatform : caret::Win32Platform {
  ObservedPlatform() : caret::Win32Platform(false) {}
  unsigned inputs = 0;
  bool fail_input = false;
  bool saw_held = false;
  caret::Modifiers modifiers() override {
    const auto state = caret::Win32Platform::modifiers();
    saw_held = saw_held || state.held();
    return state;
  }
  unsigned send_input(std::span<const caret::KeyEvent> events) override {
    ++inputs;
    check(!caret::Win32Platform::modifiers().held(), "Input requested while activation keys held");
    if (fail_input) return 0;  // Explicit fault injection; NOT an observed OS failure.
    return caret::Win32Platform::send_input(events);
  }
};
std::string insert_request(const caret::Target& target, const std::string& id, const std::string& session) {
  return "{\"requestId\":" + caret::quote_json(id) + ",\"op\":\"insert\",\"expectedTarget\":{\"foreground\":" +
    caret::quote_json(target.foreground) + ",\"focus\":" + caret::quote_json(target.focus) +
    "},\"sessionId\":" + caret::quote_json(session) + ",\"text\":" + caret::quote_json(fixture) + "}";
}
caret::Target capture(ObservedPlatform& platform) {
  const auto target = platform.snapshot();
  check(target.has_value(), "No editable focused target");
  std::cout << "Captured handles foreground=" << target->foreground << " focus=" << target->focus << '\n';
  return *target;
}
void cancel_real_helper(const caret::Target& target) {
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE input_read = nullptr, input_write = nullptr, output_read = nullptr, output_write = nullptr;
  check(CreatePipe(&input_read, &input_write, &attributes, 0) != FALSE, "Input pipe creation");
  check(CreatePipe(&output_read, &output_write, &attributes, 0) != FALSE, "Output pipe creation");
  SetHandleInformation(input_write, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(output_read, HANDLE_FLAG_INHERIT, 0);
  wchar_t module[32768]{};
  check(GetModuleFileNameW(nullptr, module, 32768) != 0, "Harness path");
  std::wstring path(module);
  path = path.substr(0, path.find_last_of(L"\\/") + 1) + L"caret-helper.exe";
  std::wstring command = L"\"" + path + L"\"";
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = input_read;
  startup.hStdOutput = output_write;
  startup.hStdError = output_write;
  PROCESS_INFORMATION process{};
  check(CreateProcessW(path.c_str(), command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                       nullptr, nullptr, &startup, &process) != FALSE, "Real helper startup");
  CloseHandle(input_read); CloseHandle(output_write);
  const auto request = insert_request(target, "cancel", "cancel") + "\n";
  DWORD written = 0;
  const auto clipboard_sequence = GetClipboardSequenceNumber();
  check(WriteFile(input_write, request.data(), static_cast<DWORD>(request.size()), &written, nullptr) &&
        written == request.size(), "Real helper pipe request");
  // Observe only the sequence number, never clipboard contents or a snapshot.
  // Require the real helper to reach its clipboard-write phase while keys remain
  // held; do not pass this as merely cancellation before insertion started.
  const auto deadline = GetTickCount64() + 1000;
  while (GetClipboardSequenceNumber() == clipboard_sequence && GetTickCount64() < deadline) delay(10);
  check(GetClipboardSequenceNumber() != clipboard_sequence, "Helper never reached clipboard write before cancellation");
  delay(500);
  check((GetAsyncKeyState(VK_CONTROL) & 0x8000) || (GetAsyncKeyState(VK_MENU) & 0x8000) ||
        (GetAsyncKeyState(VK_SPACE) & 0x8000), "Cancellation keys released before channel closure");
  CloseHandle(input_write);  // Exactly the main-client cancellation transport.
  delay(1000);
  if (WaitForSingleObject(process.hProcess, 0) != WAIT_OBJECT_0) {
    TerminateProcess(process.hProcess, 1);
    throw std::runtime_error("Cancelled helper did not exit");
  }
  DWORD status = 1;
  GetExitCodeProcess(process.hProcess, &status);
  char bytes[1024]{};
  DWORD read = 0;
  const bool received = ReadFile(output_read, bytes, sizeof(bytes), &read, nullptr) != FALSE;
  CloseHandle(output_read); CloseHandle(process.hThread); CloseHandle(process.hProcess);
  check(status == 0 && received && std::string(bytes, read).find("unsupported") != std::string::npos,
        "Real helper cancellation outcome");
}
void run() {
  hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard, GetModuleHandleW(nullptr), 0);
  check(hook != nullptr, "Native input hook unavailable");
  // Two conventional native fields for focused-control-switch verification.
  const HWND fields = CreateWindowExW(0, L"STATIC", L"Caret verification: two fields", WS_OVERLAPPEDWINDOW,
                                     CW_USEDEFAULT, CW_USEDEFAULT, 500, 220, nullptr, nullptr, nullptr, nullptr);
  check(fields != nullptr, "Control fixture window");
  CreateWindowExW(0, L"EDIT", L"Field A", WS_CHILD | WS_VISIBLE | WS_TABSTOP, 20, 30, 400, 40, fields, nullptr, nullptr, nullptr);
  CreateWindowExW(0, L"EDIT", L"Field B", WS_CHILD | WS_VISIBLE | WS_TABSTOP, 20, 100, 400, 40, fields, nullptr, nullptr, nullptr);
  ShowWindow(fields, SW_SHOWNOACTIVATE);  // Operator focuses it; harness never does.
  {
    arm("Unicode: prepare a BLANK non-elevated Notepad document; focus its input.");
    ObservedPlatform platform;
    const auto target = capture(platform);
    check(notepad(target), "Unicode target must be Notepad");
    caret::Protocol protocol(platform);
    check(protocol.dispatch(insert_request(target, "unicode", "unicode")).find("paste_requested") != std::string::npos,
          "Unicode paste not requested");
    counts("Unicode insertion", 1, platform.inputs);
    const auto count = platform.inputs;
    observed.clear();
    check(protocol.dispatch(insert_request(target, "duplicate", "unicode")).find("duplicate_session") != std::string::npos,
          "Duplicate accepted");
    check(platform.inputs == count, "Duplicate input request");
    counts("duplicate ID (delta)", 0, 0);
    std::cout << "Save the resulting Notepad screenshot NOW. Return to this terminal and type YES only if the entire document is exactly Jia Wei Ng — Manus 42:\n";
    std::string confirmed;
    std::getline(std::cin, confirmed);
    check(confirmed == "YES", "Exact Notepad text not confirmed by operator");
    std::cout << "PASS resulting Notepad Unicode text (operator-confirmed; screenshot required)\n";
  }
  {
    arm("Modifier release: focus Notepad and HOLD Ctrl+Alt+Space at the 5-second mark. Release 1 second AFTER capture appears (wait bound is 2 seconds).");
    ObservedPlatform platform;
    const auto target = capture(platform);
    check(platform.modifiers().held(), "Shortcut must initially be held");
    check(platform.insert(target, "release", fixture) == caret::Outcome::paste_requested, "Release paste failed");
    check(platform.saw_held, "Modifier wait not exercised");
    counts("modifier-release ordering", 1, platform.inputs);
  }
  for (const bool control : {false, true}) {
    arm(control ? "Control change: focus Field A in the two-field window." : "Foreground change: focus Notepad.");
    ObservedPlatform platform;
    const auto target = capture(platform);
    std::cout << "Snapshot captured. Within 3 seconds " << (control ? "click Field B in the SAME window." : "switch to another application's editable field.") << '\n' << std::flush;
    delay(3000);
    const auto changed = capture(platform);
    check(control ? changed.foreground == target.foreground && changed.focus != target.focus :
                    changed.foreground != target.foreground, "Required target change not performed");
    check(platform.insert(target, "change", fixture) == caret::Outcome::target_changed, "Stale target accepted");
    counts(control ? "focused-control change" : "foreground change", 0, platform.inputs);
  }
  {
    arm("Post-release recheck: focus Field A, HOLD Ctrl+Alt+Space at capture, then click Field B and RELEASE within 2 seconds.");
    ObservedPlatform platform;
    const auto target = capture(platform);
    check(platform.modifiers().held(), "Shortcut must initially be held");
    check(platform.insert(target, "post-release", fixture) == caret::Outcome::target_changed, "Post-release stale target accepted");
    check(platform.saw_held, "Post-release wait not exercised");
    counts("control change while waiting", 0, platform.inputs);
  }
  {
    arm("Cancellation: focus Notepad and HOLD Ctrl+Alt+Space through capture and for 2 seconds after. Main's helper input channel closes after 500 ms.");
    ObservedPlatform platform;
    const auto target = capture(platform);
    check(platform.modifiers().held(), "Cancellation requires held shortcut");
    cancel_real_helper(target);
    counts("cancellation while waiting (real helper input-channel closure)", 0, std::nullopt);
  }
  {
    arm("Elevation: manually launch Notepad as Administrator and focus its editable document. Do NOT elevate this harness.");
    ObservedPlatform platform;
    const auto target = capture(platform);
    check(notepad(target), "Elevated fixture must be Notepad");
    // Distinguish actual elevated token from inaccessible/query-failure rejection.
    DWORD pid = 0;
    GetWindowThreadProcessId(GetForegroundWindow(), &pid);
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    check(process != nullptr, "Cannot verify elevated target process");
    HANDLE token = nullptr;
    check(OpenProcessToken(process, TOKEN_QUERY, &token) != FALSE, "Cannot verify elevated target token");
    TOKEN_ELEVATION elevation{};
    DWORD size = 0;
    check(GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size) && elevation.TokenIsElevated,
          "Target is not verifiably elevated");
    CloseHandle(token); CloseHandle(process);
    check(platform.insert(target, "elevated", fixture) == caret::Outcome::unsupported, "Elevated target accepted");
    counts("unsupported elevated target", 0, platform.inputs);
  }
  {
    arm("Failed input: focus NON-elevated Notepad. The SendInput failure return is fault-injected in the native adapter (not an observed OS failure).");
    ObservedPlatform platform;
    platform.fail_input = true;
    const auto target = capture(platform);
    caret::Protocol protocol(platform);
    check(protocol.dispatch(insert_request(target, "fail", "fail")).find("unsupported") != std::string::npos, "Failed input outcome");
    check(protocol.dispatch(insert_request(target, "retry", "fail")).find("duplicate_session") != std::string::npos, "Failed input ID reused");
    check(platform.inputs == 1, "Failed input retried");
    counts("failed input, no retry (fault-injected)", 0, platform.inputs);
  }
  DestroyWindow(fields);
  UnhookWindowsHookEx(hook);
  hook = nullptr;
  std::cout << "PASS native paste-target harness; retain this event log and Notepad screenshot. No clipboard preservation was tested.\n";
}
}  // namespace
int main() {
  try { run(); return 0; }
  catch (const std::exception& error) {
    if (hook) UnhookWindowsHookEx(hook);
    std::cerr << "FAIL native paste-target: " << error.what() << '\n';
    return 1;
  }
}
