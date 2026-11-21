#include "../win32_platform.hpp"
#include <cstdlib>
#include <iostream>
#include <new>
#include <stdexcept>

// Target only the next STL allocation after a selected Win32 API seam.
void* operator new(std::size_t bytes) {
  if (win32_test::fail_next_allocation) {
    win32_test::fail_next_allocation = false;
    throw std::bad_alloc();
  }
  if (auto* memory = std::malloc(bytes ? bytes : 1)) return memory;
  throw std::bad_alloc();
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }

namespace {
unsigned cases = 0;
void check(bool condition, const char* reason) {
  if (!condition) throw std::runtime_error(reason);
}
void pass(const char* name) {
  check(win32_test::locks == 0, "GlobalLock leak");
  check(!win32_test::clipboard_open && win32_test::opens == win32_test::closes, "OpenClipboard leak");
  ++cases;
  std::cout << "PASS " << name << " (production source + Linux Win32 API shim; NOT Windows evidence)\n";
}
void run() {
  const caret::Target target{"0x1", "0x2"};
  const std::string payload(127, 'p');
  {
    win32_test::reset();
    caret::Win32Platform platform(false);
    check(platform.open_clipboard(), "open");
    win32_test::fail_read_on_open = 1;
    std::u16string text;
    bool threw = false;
    try { platform.read_plain_text(text); }
    catch (const std::bad_alloc&) { threw = true; }
    check(threw && !win32_test::fail_next_allocation, "text.assign allocation failure not injected");
    check(platform.close_clipboard(), "close");
    check(win32_test::frees == 0, "OS-owned read handle freed");
    pass("read_plain_text text.assign exception unconditionally unlocks");
  }
  {
    win32_test::reset();
    caret::Win32Platform platform(false);
    check(platform.open_clipboard(), "open");
    for (auto& unit : win32_test::sentinel) unit = u'x';
    std::u16string text;
    check(!platform.read_plain_text(text), "unterminated data accepted");
    check(platform.close_clipboard(), "close");
    check(win32_test::frees == 0, "OS-owned rejected read handle freed");
    pass("unterminated read releases lock without freeing OS memory");
  }
  {
    win32_test::reset();
    caret::Win32Platform platform(false);
    win32_test::fail_read_on_open = 1;
    bool threw = false;
    try { platform.insert(target, "initial-read-allocation", payload); }
    catch (const std::bad_alloc&) { threw = true; }
    check(threw && win32_test::clipboard == win32_test::sentinel && win32_test::opens == 1,
          "pre-mutation exception changed snapshot");
    pass("initial snapshot allocation exception releases memory and clipboard locks");
  }
  for (const bool enumeration : {false, true}) {
    win32_test::reset();
    caret::Win32Platform platform(false);
    if (enumeration) win32_test::fail_enum_on_open = 2;
    else win32_test::fail_read_on_open = 2;
    check(platform.insert(target, "restore-allocation", payload) == caret::Outcome::clipboard_restore_failed,
          "production restoration allocation escaped typed outcome");
    check(win32_test::opens == 2 && !win32_test::fail_next_allocation, "restore retried/fault not injected");
    check(win32_test::clipboard && win32_test::allocations == 1, "owned payload lost on restore allocation failure");
    pass(enumeration ? "production restoration vector allocation returns clipboard_restore_failed" :
                       "production restoration text allocation returns clipboard_restore_failed and unlocks");
    // Windows owns this successful write. The shim OS frees it, not the adapter.
    check(platform.open_clipboard() && platform.empty_clipboard() && platform.close_clipboard(), "OS release");
    check(win32_test::allocations == 0, "OS-owned allocation leaked in shim");
  }
  {
    win32_test::reset();
    caret::Win32Platform platform(false);
    win32_test::throw_set_data = true;
    check(platform.insert(target, "owned-write-exception", payload) == caret::Outcome::unsupported,
          "production owned write exception outcome");
    check(win32_test::opens == 2 && win32_test::allocations == 1 && win32_test::frees == 1,
          "owned write exception failed cleanup or restoration retried");
    check(win32_test::clipboard &&
          std::u16string(static_cast<const char16_t*>(win32_test::clipboard)) ==
            std::u16string(win32_test::sentinel), "production owned write exception lost sentinel");
    pass("production owned write exception frees failed payload and restores sentinel");
    check(platform.open_clipboard() && platform.empty_clipboard() && platform.close_clipboard(), "OS release");
    check(win32_test::allocations == 0, "restored OS-owned allocation leaked in shim");
  }
  for (unsigned failure = 0; failure < 4; ++failure) {
    win32_test::reset();
    caret::Win32Platform platform(false);
    const std::u16string text(127, u'w');
    check(platform.open_clipboard() && platform.empty_clipboard(), "open/empty");
    win32_test::fail_global_alloc = failure == 0;
    win32_test::fail_global_lock = failure == 1;
    win32_test::fail_set_data = failure == 2;
    win32_test::throw_set_data = failure == 3;
    bool threw = false, written = false;
    try { written = platform.write_unicode(text); }
    catch (const std::bad_alloc&) { threw = true; }
    check(!written && threw == (failure == 3), "write fault not injected");
    check(win32_test::allocations == 0 && win32_test::frees == (failure == 0 ? 0u : 1u),
          "failed write did not free exactly once");
    check(platform.close_clipboard(), "close");
    pass(failure == 0 ? "GlobalAlloc failure acquires no memory" :
         failure == 1 ? "GlobalLock failure frees owned write allocation" :
         failure == 2 ? "SetClipboardData failure unlocks and frees owned allocation" :
                        "synthetic SetClipboardData exception unlocks and frees owned allocation");
  }
  {
    win32_test::reset();
    caret::Win32Platform platform(false);
    const std::u16string text(127, u'w');
    check(platform.open_clipboard() && platform.empty_clipboard(), "open/empty");
    check(platform.write_unicode(text), "successful write");
    check(win32_test::allocations == 1 && win32_test::frees == 0, "transferred allocation freed by adapter");
    check(platform.close_clipboard(), "close");
    pass("successful SetClipboardData transfers memory without freeing it");
    check(platform.open_clipboard() && platform.empty_clipboard() && platform.close_clipboard(), "OS release");
    check(win32_test::allocations == 0 && win32_test::frees == 1, "OS-owned allocation release");
  }
  win32_test::reset();
  std::cout << "PASS Win32 resource suite: " << cases << " cases (Linux API shim only)\n";
}
}  // namespace
int main() {
  try { run(); return 0; }
  catch (const std::exception& error) {
    std::cerr << "FAIL Win32 resource fixture: " << error.what() << '\n';
    win32_test::reset();
    return 1;
  }
}
