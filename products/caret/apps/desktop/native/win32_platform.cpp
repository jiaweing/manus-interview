#include "win32_platform.hpp"
#include <cstring>
#include <sstream>
#include <vector>

namespace caret {
namespace {
std::string handle(HWND window) {
  std::ostringstream out;
  out << "0x" << std::hex << reinterpret_cast<std::uintptr_t>(window);
  return out.str();
}
HWND window(const std::string& value) {
  return reinterpret_cast<HWND>(static_cast<std::uintptr_t>(std::stoull(value, nullptr, 16)));
}
void pump() {
  MSG message{};
  while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
}
}  // namespace
Win32Platform::Win32Platform(bool watch_stdin) : watch_stdin_(watch_stdin) {
  // Message-only owner, never visible/active. OpenClipboard(NULL)+EmptyClipboard
  // leaves a NULL owner and cannot reliably SetClipboardData.
  clipboard_owner_ = CreateWindowExW(0, L"STATIC", L"Caret clipboard owner", 0,
                                    0, 0, 0, 0, HWND_MESSAGE, nullptr, nullptr, nullptr);
}
Win32Platform::~Win32Platform() {
  if (clipboard_owner_) DestroyWindow(clipboard_owner_);
}
std::optional<Target> Win32Platform::snapshot() {
  const HWND foreground = GetForegroundWindow();
  if (!foreground || !IsWindow(foreground) || !IsWindowVisible(foreground) ||
      !IsWindowEnabled(foreground)) return std::nullopt;
  const DWORD thread = GetWindowThreadProcessId(foreground, nullptr);
  GUITHREADINFO info{};
  info.cbSize = sizeof(info);
  if (!thread || !GetGUIThreadInfo(thread, &info) || info.hwndActive != foreground ||
      !info.hwndFocus || !IsWindow(info.hwndFocus) || !IsWindowVisible(info.hwndFocus) ||
      !IsWindowEnabled(info.hwndFocus) || GetAncestor(info.hwndFocus, GA_ROOT) != foreground ||
      GetForegroundWindow() != foreground) return std::nullopt;
  return Target{handle(foreground), handle(info.hwndFocus)};
}
bool Win32Platform::cancelled() {
  pump();
  if (cancelled_.load()) return true;
  if (!watch_stdin_) return false;
  DWORD available = 0;
  // Main closes its write end to invalidate this helper lifetime. A broken or
  // inaccessible input channel fails closed, including parent death. No extra op.
  return !PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE), nullptr, 0, nullptr, &available, nullptr);
}
bool Win32Platform::supported_target(const Target& expected) {
  DWORD pid = 0;
  if (!GetWindowThreadProcessId(window(expected.foreground), &pid) || !pid) return false;
  const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return false;
  HANDLE token = nullptr;
  const bool opened = OpenProcessToken(process, TOKEN_QUERY, &token) != FALSE;
  CloseHandle(process);
  if (!opened) return false;
  TOKEN_ELEVATION elevation{};
  DWORD size = 0;
  const bool queried = GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size) != FALSE;
  CloseHandle(token);
  return queried && elevation.TokenIsElevated == 0;
}
Modifiers Win32Platform::modifiers() {
  return {(GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0,
          (GetAsyncKeyState(VK_MENU) & 0x8000) != 0,
          (GetAsyncKeyState(VK_SPACE) & 0x8000) != 0};
}
std::uint64_t Win32Platform::now_ms() { return GetTickCount64(); }
void Win32Platform::wait_ms(unsigned duration) { Sleep(duration); }
bool Win32Platform::write_unicode(const std::u16string& text) {
  // ISSUE #8 SEAM: intentionally destructive one-way Unicode write only. The
  // next issue owns supported-format checks, snapshot and conditional restore.
  static_assert(sizeof(wchar_t) == sizeof(char16_t));
  if (!clipboard_owner_) return false;
  const auto bytes = (text.size() + 1) * sizeof(char16_t);
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (!memory) return false;
  void* destination = GlobalLock(memory);
  if (!destination) { GlobalFree(memory); return false; }
  std::memcpy(destination, text.c_str(), bytes);
  GlobalUnlock(memory);
  if (!OpenClipboard(clipboard_owner_)) { GlobalFree(memory); return false; }
  const bool written = EmptyClipboard() && SetClipboardData(CF_UNICODETEXT, memory);
  CloseClipboard();
  if (!written) GlobalFree(memory);  // Success transfers ownership to the OS.
  return written;
}
unsigned Win32Platform::send_input(std::span<const KeyEvent> events) {
  std::vector<INPUT> inputs(events.size());
  for (std::size_t i = 0; i < events.size(); ++i) {
    inputs[i].type = INPUT_KEYBOARD;
    inputs[i].ki.wVk = events[i].key == Key::control ? VK_CONTROL : 'V';
    inputs[i].ki.dwFlags = events[i].down ? 0 : KEYEVENTF_KEYUP;
    inputs[i].ki.dwExtraInfo = input_tag;
  }
  // Exactly one request. Do not retry even a short/partially delivered batch.
  return SendInput(static_cast<UINT>(inputs.size()), inputs.data(), sizeof(INPUT));
}
}  // namespace caret
