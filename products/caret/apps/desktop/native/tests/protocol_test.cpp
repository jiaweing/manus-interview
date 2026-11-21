#include "../protocol.hpp"

#include <cstdint>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace {
struct FixturePlatform final : caret::Platform {
  int snapshots = 0;
  int inserts = 0;
  int clipboard_calls = 0;
  int input_calls = 0;
  bool no_target = false;
  bool throws = false;
  caret::Outcome outcome = caret::Outcome::unsupported;
  std::string received;
  std::optional<caret::Target> snapshot() override {
    ++snapshots;
    if (throws) throw std::runtime_error("fixture");
    if (no_target) return std::nullopt;
    return caret::Target{"0x1234", "0x5678"};
  }
  caret::Outcome insert(const caret::Target&, const std::string&, const std::string& text) override {
    ++inserts;
    received = text;
    if (throws) throw std::runtime_error("fixture");
    return outcome;
  }
};
void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
std::string insert(const std::string& id, const std::string& session, const std::string& text = "hi") {
  return "{\"requestId\":" + caret::quote_json(id) + ",\"op\":\"insert\","
    "\"expectedTarget\":{\"foreground\":\"0x1234\",\"focus\":\"0x5678\"},"
    "\"sessionId\":" + caret::quote_json(session) + ",\"text\":" + caret::quote_json(text) + "}";
}
void fixtures() {
  const std::string good = insert("r", "s");
  std::vector<std::string> bad = {
    "", "not json", "{", "{}", "[]", "null", "true", "1", "\"snapshot\"",
    "{\"requestId\":\"r\",\"op\":\"exec\",\"command\":\"whoami\"}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\",\"extra\":true}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\",\"op\":\"snapshot\"}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\",\"\\u006fp\":\"snapshot\"}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\"} trailing",
    "{\"requestId\":\"r\",\"op\":\"snapshot\",}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\"}{}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\",\"x\":01}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\",\"x\":1.}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\",\"x\":1e}",
    "{\"requestId\":\"r\",\"op\":\"snapshot\",\"x\":NaN}",
  };
  // Remove and mistype every field in the complete insert schema.
  const std::vector<std::pair<std::string, std::string>> fields = {
    {"requestId", "\"r\""}, {"op", "\"insert\""},
    {"expectedTarget", "{\"foreground\":\"0x1234\",\"focus\":\"0x5678\"}"},
    {"sessionId", "\"s\""}, {"text", "\"hi\""},
  };
  for (const auto& [key, value] : fields) {
    const auto token = caret::quote_json(key) + ":" + value;
    const auto pos = good.find(token);
    check(pos != std::string::npos, "fixture token missing");
    std::string missing = good;
    if (pos == 1) missing.erase(pos, token.size() + 1);
    else missing.erase(pos - 1, token.size() + 1);
    bad.push_back(missing);
    for (const auto& wrong : {"null", "true", "123", "[]", "{}"}) {
      std::string changed = good;
      changed.replace(pos + key.size() + 3, value.size(), wrong);
      bad.push_back(changed);
    }
  }
  for (const auto& handle : {"0x0", "0x01", "0X1234", "1234", "0xG", "0x12345678901234567"}) {
    auto changed = good;
    changed.replace(changed.find("0x1234"), 6, handle);
    bad.push_back(changed);
  }
  for (const auto& text : {std::string{}, std::string("a\0b", 3), std::string(32769, 'x')})
    bad.push_back(insert("r", "s", text));
  bad.push_back(insert("r", std::string(129, 's')));
  bad.push_back(insert("r", "bad session"));
  bad.push_back(insert("", "s"));
  bad.push_back(insert(std::string(129, 'r'), "s"));
  auto malformed_unicode = good;
  malformed_unicode.replace(malformed_unicode.find("hi"), 2, "\\ud800");
  bad.push_back(malformed_unicode);
  malformed_unicode = good;
  malformed_unicode.replace(malformed_unicode.find("hi"), 2, "\\udc00");
  bad.push_back(malformed_unicode);
  malformed_unicode = good;
  malformed_unicode.replace(malformed_unicode.find("hi"), 2, "\\ud800\\u0041");
  bad.push_back(malformed_unicode);
  for (const auto& bytes : {std::string("\xc0\x80", 2), std::string("\xed\xa0\x80", 3),
                            std::string("\xf4\x90\x80\x80", 4), std::string("\x80", 1)})
    bad.push_back(insert("r", "s", bytes));
  for (const auto& nested : {
      "{\"foreground\":\"0x1234\"}",
      "{\"focus\":\"0x5678\"}",
      "{\"foreground\":1,\"focus\":\"0x5678\"}",
      "{\"foreground\":\"0x1234\",\"focus\":null}",
      "{\"foreground\":\"0x1234\",\"focus\":\"0x5678\",\"extra\":1}",
      "{\"foreground\":\"0x1234\",\"focus\":\"0x5678\",\"focus\":\"0x5678\"}"}) {
    auto changed = good;
    const auto start = changed.find('{', 1);
    changed.replace(start, changed.find('}', start) - start + 1, nested);
    bad.push_back(changed);
  }
  bad.push_back(std::string(caret::max_line_bytes + 1, ' '));
  bad.push_back("{\"requestId\":\"r\",\"op\":\"snapshot\",\"x\":" + std::string(10, '[') +
                "0" + std::string(10, ']') + "}");
  std::string many_values = "0";
  for (int i = 1; i < 130; ++i) many_values += ",0";
  bad.push_back("{\"requestId\":\"r\",\"op\":\"snapshot\",\"x\":[" +
                many_values + "]}");
  for (const auto& request : bad) {
    FixturePlatform platform;
    caret::Protocol protocol(platform);
    check(protocol.dispatch(request).find("\"ok\":false") != std::string::npos, "bad request accepted");
    check(platform.snapshots == 0 && platform.inserts == 0 && platform.clipboard_calls == 0 &&
          platform.input_calls == 0, "rejected request reached native platform");
  }
  std::cout << "PASS invalid JSON/schema/operation: " << bad.size()
            << " fixtures; snapshot=0 insert=0 clipboard=0 input=0 (fake platform counters)\n";

  std::uint32_t random = 0x6ca4e7u;
  auto next = [&random]() {
    random ^= random << 13;
    random ^= random >> 17;
    random ^= random << 5;
    return random;
  };
  for (int i = 0; i < 2000; ++i) {
    auto request = good;
    const auto mutations = 1u + next() % 4u;
    for (unsigned j = 0; j < mutations; ++j)
      request[next() % request.size()] = static_cast<char>(next() & 0xffu);
    FixturePlatform mutated;
    caret::Protocol mutated_protocol(mutated);
    const auto response = mutated_protocol.dispatch(request);
    if (response.find("\"ok\":false") != std::string::npos)
      check(mutated.snapshots == 0 && mutated.inserts == 0, "mutated rejection reached platform");
  }
  std::cout << "PASS 2000 deterministic request mutations; rejected requests have zero adapter calls\n";

  FixturePlatform platform;
  caret::Protocol protocol(platform);
  check(protocol.dispatch("{\"requestId\":\"snap\",\"op\":\"snapshot\"}").find("0x5678") != std::string::npos,
        "snapshot failed");
  check(platform.snapshots == 1, "snapshot counter");
  check(protocol.dispatch("{\"requestId\":\"snap\",\"op\":\"snapshot\"}").find("duplicate_request") != std::string::npos,
        "duplicate snapshot accepted");
  check(platform.snapshots == 1, "duplicate snapshot side effect");
  std::cout << "PASS valid snapshot and duplicate request (fixture handles, NOT Windows evidence)\n";
  check(protocol.dispatch(insert("i1", "s1")).find("unsupported") != std::string::npos, "insert stub");
  check(protocol.dispatch(insert("i1", "s2")).find("duplicate_request") != std::string::npos, "duplicate request");
  check(protocol.dispatch(insert("i2", "s1")).find("duplicate_session") != std::string::npos, "duplicate session");
  check(platform.inserts == 1, "duplicate insert reached platform");
  check(platform.clipboard_calls == 0 && platform.input_calls == 0, "clipboard/input side effects");
  std::cout << "PASS duplicate session ID: rejected call delta insert=0 clipboard=0 input=0\n";
  const std::string unicode = "hello\n\"\\ \xe4\xbd\xa0\xe5\xa5\xbd \xf0\x9f\x8e\x99";
  check(protocol.dispatch(insert("unicode", "unicode", unicode)).find("unsupported") != std::string::npos,
        "unicode rejected");
  check(platform.received == unicode, "Unicode changed");
  auto escaped = insert("escaped", "escaped", "hi");
  escaped.replace(escaped.find("hi"), 2, "\\ud83c\\udf99");
  protocol.dispatch(escaped);
  check(platform.received == "\xf0\x9f\x8e\x99", "surrogate pair decoding");
  check(protocol.dispatch(insert("maxtext", "maxtext", std::string(caret::max_text_bytes, 'x')))
        .find("unsupported") != std::string::npos, "max text rejected");
  std::cout << "PASS UTF-8/escaped Unicode and text boundary\n";
  platform.no_target = true;
  check(protocol.dispatch("{\"requestId\":\"none\",\"op\":\"snapshot\"}").find("no_target") != std::string::npos,
        "missing target not rejected");
  platform.throws = true;
  check(protocol.dispatch(insert("throw", "throw")).find("internal_error") != std::string::npos, "native error");
  check(protocol.dispatch(insert("throw2", "throw")).find("duplicate_session") != std::string::npos,
        "failed insert ID not consumed");
  std::cout << "PASS no usable target and failure consumes session ID\n";
  platform.throws = false;
  for (const auto outcome : {caret::Outcome::target_changed, caret::Outcome::clipboard_busy,
                             caret::Outcome::clipboard_restore_failed,
                             caret::Outcome::unsupported, caret::Outcome::paste_requested}) {
    platform.outcome = outcome;
    const auto id = "outcome" + std::to_string(platform.inserts);
    const auto response = protocol.dispatch(insert(id, id));
    check(response.find("\"ok\":true") != std::string::npos, "outcome serialization");
    if (outcome == caret::Outcome::clipboard_restore_failed)
      check(response.find("clipboard_restore_failed") != std::string::npos, "restore failure serialization");
  }
  std::cout << "PASS five typed outcomes (fixture only; no paste implementation)\n";

  std::string line;
  std::istringstream stream(std::string(caret::max_line_bytes + 1, 'x') + "\n" +
                           "{\"requestId\":\"later\",\"op\":\"snapshot\"}\n");
  check(caret::read_line(stream, line) == caret::LineStatus::too_long && line.empty(), "line limit");
  check(caret::read_line(stream, line) == caret::LineStatus::complete && line.find("later") != std::string::npos,
        "overlong line not drained");
  check(caret::read_line(stream, line) == caret::LineStatus::end, "EOF");
  std::istringstream boundary(std::string(caret::max_line_bytes, 'x') + "\n");
  check(caret::read_line(boundary, line) == caret::LineStatus::complete && line.size() == caret::max_line_bytes,
        "line boundary");
  std::istringstream truncated("{\"requestId\":\"x\",\"op\":\"snapshot\"}");
  check(caret::read_line(truncated, line) == caret::LineStatus::truncated, "truncated request accepted");
  std::cout << "PASS bounded framing, resynchronization, and truncated EOF\n";

  FixturePlatform bounded;
  caret::Protocol bounded_protocol(bounded);
  for (std::size_t i = 0; i < caret::max_ids; ++i) {
    const auto id = "id" + std::to_string(i);
    check(bounded_protocol.dispatch(insert(id, id)).find("unsupported") != std::string::npos, "early ID cap");
  }
  check(bounded_protocol.dispatch(insert("overflow", "overflow")).find("limit_exceeded") != std::string::npos,
        "ID cap not enforced");
  check(bounded.inserts == static_cast<int>(caret::max_ids), "ID cap side effect");
  check(bounded_protocol.dispatch(insert("new", "id0")).find("duplicate_session") != std::string::npos,
        "session dedupe evicted");
  std::cout << "PASS bounded app-lifetime ID ledger, no eviction, fail closed\n";
}
}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc == 2 && std::string(argv[1]) == "--serve") {
      FixturePlatform platform;
      caret::Protocol protocol(platform);
      std::string line;
      while (true) {
        const auto status = caret::read_line(std::cin, line);
        if (status == caret::LineStatus::end) return 0;
        std::cout << (status == caret::LineStatus::complete ? protocol.dispatch(line) :
                      caret::Protocol::invalid_request()) << '\n' << std::flush;
        if (status == caret::LineStatus::truncated) return 0;
      }
    }
    fixtures();
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL protocol fixture: " << error.what() << '\n';
    return 1;
  }
}
