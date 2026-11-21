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
bool Win32Platform::open_clipboard() {
  return clipboard_owner_ && OpenClipboard(clipboard_owner_);
}
bool Win32Platform::clipboard_formats(std::vector<std::uint32_t>& formats) {
  formats.clear();
  UINT format = 0;
  for (;;) {
    SetLastError(ERROR_SUCCESS);
    format = EnumClipboardFormats(format);
    if (!format) return GetLastError() == ERROR_SUCCESS;
    formats.push_back(format);
  }
}
bool Win32Platform::read_plain_text(std::u16string& text) {
  // Windows synthesizes Unicode from CF_TEXT/CF_OEMTEXT using CF_LOCALE.
  // The shared policy has already rejected every non-text format.
  static_assert(sizeof(wchar_t) == sizeof(char16_t));
  const HANDLE memory = GetClipboardData(CF_UNICODETEXT);
  if (!memory) return false;
  const auto units = GlobalSize(memory) / sizeof(char16_t);
  const auto* data = static_cast<const char16_t*>(GlobalLock(memory));
  if (!data) return false;
  std::size_t length = 0;
  while (length < units && data[length] != 0) ++length;
  const bool terminated = length < units;
  if (terminated) text.assign(data, length);
  GlobalUnlock(memory);
  return terminated;
}
bool Win32Platform::empty_clipboard() { return EmptyClipboard() != FALSE; }
std::optional<std::uint32_t> Win32Platform::clipboard_sequence() {
  const auto sequence = GetClipboardSequenceNumber();
  return sequence ? std::optional<std::uint32_t>(sequence) : std::nullopt;
}
bool Win32Platform::close_clipboard() { return CloseClipboard() != FALSE; }
bool Win32Platform::write_unicode(const std::u16string& text) {
  static_assert(sizeof(wchar_t) == sizeof(char16_t));
  const auto bytes = (text.size() + 1) * sizeof(char16_t);
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (!memory) return false;
  void* destination = GlobalLock(memory);
  if (!destination) { GlobalFree(memory); return false; }
  std::memcpy(destination, text.c_str(), bytes);
  GlobalUnlock(memory);
  const bool written = SetClipboardData(CF_UNICODETEXT, memory) != nullptr;
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
