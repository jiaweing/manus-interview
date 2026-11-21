#pragma once
// Linux structural test only. This is not a Windows behavior emulator.
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <new>

using BOOL = int;
using UINT = unsigned;
using DWORD = std::uint32_t;
using ULONG_PTR = std::uintptr_t;
using HWND = void*;
using HANDLE = void*;
using HGLOBAL = void*;
using WORD = unsigned short;
struct MSG {};
struct GUITHREADINFO { DWORD cbSize; HWND hwndActive; HWND hwndFocus; };
struct TOKEN_ELEVATION { DWORD TokenIsElevated; };
struct KEYBDINPUT { WORD wVk = 0; DWORD dwFlags = 0; ULONG_PTR dwExtraInfo = 0; };
struct INPUT { DWORD type = 0; KEYBDINPUT ki; };
inline constexpr BOOL FALSE = 0;
inline constexpr DWORD PM_REMOVE = 1, GA_ROOT = 2, STD_INPUT_HANDLE = 0,
  PROCESS_QUERY_LIMITED_INFORMATION = 1, TOKEN_QUERY = 1;
inline constexpr DWORD VK_CONTROL = 17, VK_MENU = 18, VK_SPACE = 32,
  ERROR_SUCCESS = 0, CF_UNICODETEXT = 13, GMEM_MOVEABLE = 2,
  INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 2;
inline constexpr int TokenElevation = 1;
#define HWND_MESSAGE reinterpret_cast<HWND>(static_cast<std::intptr_t>(-3))

namespace win32_test {
inline char16_t sentinel[128]{};
inline HANDLE clipboard = sentinel;
inline std::size_t clipboard_bytes = sizeof(sentinel), allocation_bytes = 0;
inline unsigned locks = 0, allocations = 0, frees = 0, opens = 0, closes = 0;
inline DWORD sequence = 100;
inline bool clipboard_open = false, fail_next_allocation = false;
inline bool fail_global_alloc = false, fail_global_lock = false, fail_set_data = false;
inline bool throw_set_data = false;
inline unsigned fail_read_on_open = 0, fail_enum_on_open = 0;
inline void reset() {
  if (clipboard && clipboard != sentinel) std::free(clipboard);
  for (unsigned i = 0; i < 127; ++i) sentinel[i] = u'x';
  sentinel[127] = 0;
  clipboard = sentinel; clipboard_bytes = sizeof(sentinel); allocation_bytes = 0;
  locks = allocations = frees = opens = closes = 0; sequence = 100;
  clipboard_open = fail_next_allocation = false;
  fail_global_alloc = fail_global_lock = fail_set_data = throw_set_data = false;
  fail_read_on_open = fail_enum_on_open = 0;
}
}  // namespace win32_test

inline BOOL PeekMessageW(MSG*, HWND, UINT, UINT, UINT) { return 0; }
inline BOOL TranslateMessage(const MSG*) { return 1; }
inline std::intptr_t DispatchMessageW(const MSG*) { return 0; }
inline HWND CreateWindowExW(DWORD, const wchar_t*, const wchar_t*, DWORD, int, int, int, int,
                            HWND, void*, void*, void*) { return reinterpret_cast<HWND>(1); }
inline BOOL DestroyWindow(HWND) { return 1; }
inline HWND GetForegroundWindow() { return reinterpret_cast<HWND>(1); }
inline BOOL IsWindow(HWND) { return 1; }
inline BOOL IsWindowVisible(HWND) { return 1; }
inline BOOL IsWindowEnabled(HWND) { return 1; }
inline DWORD GetWindowThreadProcessId(HWND, DWORD* pid) { if (pid) *pid = 1; return 1; }
inline BOOL GetGUIThreadInfo(DWORD, GUITHREADINFO* info) {
  info->hwndActive = reinterpret_cast<HWND>(1); info->hwndFocus = reinterpret_cast<HWND>(2); return 1;
}
inline HWND GetAncestor(HWND, UINT) { return reinterpret_cast<HWND>(1); }
inline HANDLE GetStdHandle(DWORD) { return reinterpret_cast<HANDLE>(1); }
inline BOOL PeekNamedPipe(HANDLE, void*, DWORD, DWORD*, DWORD*, DWORD*) { return 1; }
inline HANDLE OpenProcess(DWORD, BOOL, DWORD) { return reinterpret_cast<HANDLE>(1); }
inline BOOL OpenProcessToken(HANDLE, DWORD, HANDLE* token) { *token = reinterpret_cast<HANDLE>(1); return 1; }
inline BOOL CloseHandle(HANDLE) { return 1; }
inline BOOL GetTokenInformation(HANDLE, int, void* info, DWORD, DWORD*) {
  static_cast<TOKEN_ELEVATION*>(info)->TokenIsElevated = 0; return 1;
}
inline short GetAsyncKeyState(int) { return 0; }
inline std::uint64_t GetTickCount64() { return 0; }
inline void Sleep(DWORD) {}
inline BOOL OpenClipboard(HWND) {
  ++win32_test::opens;
  if (win32_test::clipboard_open) return 0;
  win32_test::clipboard_open = true; return 1;
}
inline BOOL CloseClipboard() {
  ++win32_test::closes; win32_test::clipboard_open = false; return 1;
}
inline void SetLastError(DWORD) {}
inline DWORD GetLastError() { return 0; }
inline UINT EnumClipboardFormats(UINT previous) {
  if (previous || !win32_test::clipboard) return 0;
  if (win32_test::fail_enum_on_open == win32_test::opens) win32_test::fail_next_allocation = true;
  return CF_UNICODETEXT;
}
inline HANDLE GetClipboardData(UINT) { return win32_test::clipboard; }
inline std::size_t GlobalSize(HANDLE) { return win32_test::clipboard_bytes; }
inline void* GlobalLock(HANDLE memory) {
  if (win32_test::fail_global_lock) return nullptr;
  ++win32_test::locks;
  if (memory == win32_test::clipboard && win32_test::fail_read_on_open == win32_test::opens)
    win32_test::fail_next_allocation = true;
  return memory;
}
inline BOOL GlobalUnlock(HANDLE) { --win32_test::locks; return 1; }
inline HGLOBAL GlobalAlloc(UINT, std::size_t bytes) {
  if (win32_test::fail_global_alloc) return nullptr;
  auto* memory = std::malloc(bytes);
  if (memory) { ++win32_test::allocations; win32_test::allocation_bytes = bytes; }
  return memory;
}
inline HGLOBAL GlobalFree(HGLOBAL memory) {
  ++win32_test::frees; --win32_test::allocations; std::free(memory); return nullptr;
}
inline BOOL EmptyClipboard() {
  if (win32_test::clipboard && win32_test::clipboard != win32_test::sentinel)
    GlobalFree(win32_test::clipboard);
  win32_test::clipboard = nullptr; win32_test::clipboard_bytes = 0; ++win32_test::sequence; return 1;
}
inline DWORD GetClipboardSequenceNumber() { return win32_test::sequence; }
inline HANDLE SetClipboardData(UINT, HANDLE memory) {
  if (win32_test::throw_set_data) {
    win32_test::throw_set_data = false;
    throw std::bad_alloc();
  }
  if (win32_test::fail_set_data) return nullptr;
  win32_test::clipboard = memory; win32_test::clipboard_bytes = win32_test::allocation_bytes;
  ++win32_test::sequence; return memory;
}
inline UINT SendInput(UINT count, INPUT*, int) { return count; }
