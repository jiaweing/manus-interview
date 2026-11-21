// Independent verifier, not linked with the helper/protocol implementation.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <iostream>
#include <cstdint>
#include <cwctype>
#include <string>

int main() {
  const HWND foreground = GetForegroundWindow();
  DWORD pid = 0;
  const DWORD thread = GetWindowThreadProcessId(foreground, &pid);
  GUITHREADINFO info{};
  info.cbSize = sizeof(info);
  if (!foreground || !thread || !GetGUIThreadInfo(thread, &info) || !info.hwndFocus) return 1;
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return 1;
  wchar_t path[32768];
  DWORD size = 32768;
  const BOOL found = QueryFullProcessImageNameW(process, 0, path, &size);
  CloseHandle(process);
  if (!found) return 1;
  std::wstring name(path, size);
  name = name.substr(name.find_last_of(L"\\/") + 1);
  for (auto& c : name) c = static_cast<wchar_t>(std::towlower(c));
  std::cout << "{\"foreground\":\"0x" << std::hex << reinterpret_cast<std::uintptr_t>(foreground)
            << "\",\"focus\":\"0x" << reinterpret_cast<std::uintptr_t>(info.hwndFocus)
            << "\",\"isNotepad\":" << (name == L"notepad.exe" ? "true" : "false") << "}\n";
  return 0;
}
