// Tiny JSON emission helpers — just enough for describe()/XCAF trees, no
// dependencies. Numbers use %.10g: enough precision for geometry, no
// float-noise tails.

#pragma once

#include <cstdio>
#include <sstream>
#include <string>

inline std::string jsonNumber(double value) {
  char buffer[32];
  std::snprintf(buffer, sizeof(buffer), "%.10g", value);
  return buffer;
}

inline void jsonVec3(std::ostringstream& out, double x, double y, double z) {
  out << "[" << jsonNumber(x) << "," << jsonNumber(y) << "," << jsonNumber(z) << "]";
}

inline void jsonString(std::ostringstream& out, const std::string& value) {
  out << '"';
  for (char c : value) {
    switch (c) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char escape[8];
          std::snprintf(escape, sizeof(escape), "\\u%04x", c);
          out << escape;
        } else {
          out << c;
        }
    }
  }
  out << '"';
}

inline void jsonKey(std::ostringstream& out, const char* key) {
  jsonString(out, key);
  out << ':';
}
