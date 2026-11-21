#include "protocol.hpp"

#include <algorithm>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace caret {
namespace {
struct Invalid : std::exception {};
struct Value {
  enum class Kind { string, object, other } kind = Kind::other;
  std::string string;
  std::map<std::string, Value> object;
};

// This deliberately small parser is not an evaluator. It accepts JSON grammar,
// rejects duplicate keys at every depth, and validates raw and escaped Unicode.
class Parser {
 public:
  explicit Parser(std::string_view input) : input_(input) {}
  Value parse() {
    auto value = parse_value(0);
    space();
    if (pos_ != input_.size()) throw Invalid{};
    return value;
  }

 private:
  std::string_view input_;
  std::size_t pos_ = 0;
  std::size_t nodes_ = 0;

  void space() {
    while (pos_ < input_.size() && (input_[pos_] == ' ' || input_[pos_] == '\n' ||
           input_[pos_] == '\r' || input_[pos_] == '\t')) ++pos_;
  }
  bool take(char c) {
    if (pos_ < input_.size() && input_[pos_] == c) { ++pos_; return true; }
    return false;
  }
  void need(char c) { if (!take(c)) throw Invalid{}; }
  static bool digit(char c) { return c >= '0' && c <= '9'; }
  unsigned hex4() {
    unsigned result = 0;
    for (int i = 0; i < 4; ++i) {
      if (pos_ == input_.size()) throw Invalid{};
      const char c = input_[pos_++];
      unsigned d;
      if (c >= '0' && c <= '9') d = static_cast<unsigned>(c - '0');
      else if (c >= 'a' && c <= 'f') d = static_cast<unsigned>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') d = static_cast<unsigned>(c - 'A' + 10);
      else throw Invalid{};
      result = result * 16 + d;
    }
    return result;
  }
  static void utf8(std::string& out, unsigned cp) {
    if (cp <= 0x7f) out += static_cast<char>(cp);
    else if (cp <= 0x7ff) {
      out += static_cast<char>(0xc0 | (cp >> 6));
      out += static_cast<char>(0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      out += static_cast<char>(0xe0 | (cp >> 12));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3f));
      out += static_cast<char>(0x80 | (cp & 0x3f));
    } else {
      out += static_cast<char>(0xf0 | (cp >> 18));
      out += static_cast<char>(0x80 | ((cp >> 12) & 0x3f));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3f));
      out += static_cast<char>(0x80 | (cp & 0x3f));
    }
  }
  std::string parse_string() {
    need('"');
    std::string out;
    while (pos_ < input_.size()) {
      const auto c = static_cast<unsigned char>(input_[pos_++]);
      if (c == '"') return out;
      if (c < 0x20) throw Invalid{};
      if (c == '\\') {
        if (pos_ == input_.size()) throw Invalid{};
        const char escape = input_[pos_++];
        switch (escape) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            unsigned cp = hex4();
            if (cp >= 0xd800 && cp <= 0xdbff) {
              need('\\'); need('u');
              const auto low = hex4();
              if (low < 0xdc00 || low > 0xdfff) throw Invalid{};
              cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
            } else if (cp >= 0xdc00 && cp <= 0xdfff) throw Invalid{};
            utf8(out, cp);
            break;
          }
          default: throw Invalid{};
        }
      } else if (c < 0x80) out += static_cast<char>(c);
      else {
        unsigned cp;
        unsigned remaining;
        unsigned minimum;
        if (c >= 0xc2 && c <= 0xdf) { cp = c & 0x1f; remaining = 1; minimum = 0x80; }
        else if (c >= 0xe0 && c <= 0xef) { cp = c & 0x0f; remaining = 2; minimum = 0x800; }
        else if (c >= 0xf0 && c <= 0xf4) { cp = c & 7; remaining = 3; minimum = 0x10000; }
        else throw Invalid{};
        for (unsigned i = 0; i < remaining; ++i) {
          if (pos_ == input_.size()) throw Invalid{};
          const auto next = static_cast<unsigned char>(input_[pos_++]);
          if ((next & 0xc0) != 0x80) throw Invalid{};
          cp = (cp << 6) | (next & 0x3f);
        }
        if (cp < minimum || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw Invalid{};
        utf8(out, cp);
      }
    }
    throw Invalid{};
  }
  Value parse_value(unsigned depth) {
    if (depth > 8 || ++nodes_ > 128) throw Invalid{};
    space();
    if (pos_ == input_.size()) throw Invalid{};
    Value value;
    if (input_[pos_] == '"') {
      value.kind = Value::Kind::string;
      value.string = parse_string();
    } else if (take('{')) {
      value.kind = Value::Kind::object;
      space();
      if (take('}')) return value;
      do {
        space();
        auto key = parse_string();
        space(); need(':');
        auto child = parse_value(depth + 1);
        if (!value.object.emplace(std::move(key), std::move(child)).second) throw Invalid{};
        space();
        if (take('}')) return value;
        need(',');
      } while (true);
    } else if (take('[')) {
      space();
      if (take(']')) return value;
      do {
        parse_value(depth + 1);
        space();
        if (take(']')) return value;
        need(',');
      } while (true);
    } else if (input_.substr(pos_, 4) == "null" || input_.substr(pos_, 4) == "true") pos_ += 4;
    else if (input_.substr(pos_, 5) == "false") pos_ += 5;
    else {
      take('-');
      if (!take('0')) {
        if (pos_ == input_.size() || input_[pos_] < '1' || input_[pos_] > '9') throw Invalid{};
        while (pos_ < input_.size() && digit(input_[pos_])) ++pos_;
      }
      if (take('.')) {
        if (pos_ == input_.size() || !digit(input_[pos_])) throw Invalid{};
        while (pos_ < input_.size() && digit(input_[pos_])) ++pos_;
      }
      if (take('e') || take('E')) {
        if (!take('+')) take('-');
        if (pos_ == input_.size() || !digit(input_[pos_])) throw Invalid{};
        while (pos_ < input_.size() && digit(input_[pos_])) ++pos_;
      }
    }
    return value;
  }
};

const std::string& field(const Value& value, const char* name) {
  if (value.kind != Value::Kind::object) throw Invalid{};
  const auto it = value.object.find(name);
  if (it == value.object.end() || it->second.kind != Value::Kind::string) throw Invalid{};
  return it->second.string;
}
bool identifier(const std::string& value) {
  return !value.empty() && value.size() <= 128 &&
    std::all_of(value.begin(), value.end(), [](unsigned char c) {
      return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_';
    });
}
std::string error(const std::string* id, const char* code) {
  return "{\"requestId\":" + (id ? quote_json(*id) : "null") +
    ",\"ok\":false,\"error\":" + quote_json(code) + "}";
}
const char* name(Outcome outcome) {
  switch (outcome) {
    case Outcome::target_changed: return "target_changed";
    case Outcome::clipboard_busy: return "clipboard_busy";
    case Outcome::unsupported: return "unsupported";
    case Outcome::paste_requested: return "paste_requested";
  }
  throw Invalid{};
}
}  // namespace

bool valid_handle(const std::string& value) {
  return value.size() >= 3 && value.size() <= 18 && value[0] == '0' && value[1] == 'x' &&
    value[2] != '0' && std::all_of(value.begin() + 2, value.end(), [](char c) {
      return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
    });
}
std::string quote_json(const std::string& value) {
  std::string out = "\"";
  constexpr char hex[] = "0123456789abcdef";
  for (unsigned char c : value) {
    if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 0x20) {
      out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15];
    } else out += static_cast<char>(c);
  }
  return out + "\"";
}
LineStatus read_line(std::istream& input, std::string& line) {
  line.clear();
  bool too_long = false;
  for (;;) {
    const int c = input.get();
    if (c == std::char_traits<char>::eof()) {
      if (too_long) return LineStatus::too_long;
      return line.empty() ? LineStatus::end : LineStatus::truncated;
    }
    if (c == '\n') return too_long ? LineStatus::too_long : LineStatus::complete;
    if (!too_long) {
      if (line.size() == max_line_bytes) { too_long = true; line.clear(); }
      else line += static_cast<char>(c);
    }
  }
}
std::string Protocol::invalid_request() { return error(nullptr, "invalid_request"); }
std::string Protocol::dispatch(const std::string& line) {
  std::string id;
  bool has_id = false;
  try {
    if (line.size() > max_line_bytes) throw Invalid{};
    const auto value = Parser(line).parse();
    id = field(value, "requestId");
    if (!identifier(id)) throw Invalid{};
    has_id = true;
    const auto& op = field(value, "op");
    std::optional<Target> expected;
    std::string session;
    std::string text;
    if (op == "snapshot") {
      if (value.object.size() != 2) throw Invalid{};
    } else if (op == "insert") {
      if (value.object.size() != 5) throw Invalid{};
      session = field(value, "sessionId");
      text = field(value, "text");
      if (!identifier(session) || text.empty() || text.size() > max_text_bytes ||
          text.find('\0') != std::string::npos) throw Invalid{};
      const auto& target = value.object.at("expectedTarget");
      if (target.kind != Value::Kind::object || target.object.size() != 2) throw Invalid{};
      expected = Target{field(target, "foreground"), field(target, "focus")};
      if (!valid_handle(expected->foreground) || !valid_handle(expected->focus)) throw Invalid{};
    } else throw Invalid{};

    if (request_ids_.contains(id)) return error(&id, "duplicate_request");
    if (expected && session_ids_.contains(session)) return error(&id, "duplicate_session");
    if (request_ids_.size() >= max_ids || (expected && session_ids_.size() >= max_ids))
      return error(&id, "limit_exceeded");
    // Consume IDs before any native call, including calls that fail or throw.
    request_ids_.insert(id);
    if (expected) session_ids_.insert(session);
    const auto prefix = "{\"requestId\":" + quote_json(id) + ",\"ok\":true,";
    if (expected) return prefix + "\"outcome\":" +
      quote_json(name(platform_.insert(*expected, session, text))) + "}";
    const auto target = platform_.snapshot();
    if (!target) return error(&id, "no_target");
    if (!valid_handle(target->foreground) || !valid_handle(target->focus))
      return error(&id, "internal_error");
    return prefix + "\"target\":{\"foreground\":" + quote_json(target->foreground) +
      ",\"focus\":" + quote_json(target->focus) + "}}";
  } catch (const Invalid&) {
    return error(has_id ? &id : nullptr, "invalid_request");
  } catch (const std::out_of_range&) {
    return error(has_id ? &id : nullptr, "invalid_request");
  } catch (...) {
    return error(has_id ? &id : nullptr, "internal_error");
  }
}
}  // namespace caret
