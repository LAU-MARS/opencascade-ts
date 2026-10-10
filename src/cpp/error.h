// Shared error contract for every wasm boundary crossing.
//
// C++ exceptions NEVER cross the boundary (embind in pinned Emscripten
// versions does not translate them into JS Errors). Every entry point — the
// hand-written glue and the generated raw bindings alike — runs inside
// guarded(), which catches, records the message, and returns `errorValue`.
// TypeScript checks hasError()/lastError() after each call and throws a
// proper JS Error — see OccSession#throwIfError.

#pragma once

#include <Standard_Failure.hxx>

#include <string>

namespace occ_ts {

inline std::string g_lastError;

// Run `fn`, convert any exception into g_lastError and return `errorValue`.
template <typename T, typename Fn>
inline T guarded(const char* operation, Fn fn, T errorValue) {
  g_lastError.clear();
  try {
    return fn();
  } catch (const Standard_Failure& failure) {
    const char* what = failure.GetMessageString();
    g_lastError = std::string(operation) + ": " +
                  ((what && *what) ? what : "unknown OCCT error");
  } catch (const std::exception& error) {
    g_lastError = std::string(operation) + ": " + error.what();
  } catch (...) {
    g_lastError = std::string(operation) + ": unknown error";
  }
  return errorValue;
}

inline bool hasError() { return !g_lastError.empty(); }
inline const std::string& lastError() { return g_lastError; }

} // namespace occ_ts
