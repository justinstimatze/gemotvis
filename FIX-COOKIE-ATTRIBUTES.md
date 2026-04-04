# Fix: Missing Secure and HttpOnly on session deletion cookie

**CodeQL alerts (medium):**
- Cookie 'Secure' attribute is not set to true
- Cookie 'HttpOnly' attribute is not set to true

**File:** `internal/server/dashboard.go:252`

## Problem

The session-deletion cookie is missing `Secure`, `HttpOnly`, and `SameSite` attributes. The session-creation cookie at line 232 already sets these correctly — the deletion cookie should match.

## Fix

### `internal/server/dashboard.go` (line 252-257)

Change:
```go
http.SetCookie(w, &http.Cookie{
    Name:   sessionCookieName,
    Value:  "",
    Path:   "/",
    MaxAge: -1,
})
```

To:
```go
http.SetCookie(w, &http.Cookie{
    Name:     sessionCookieName,
    Value:    "",
    Path:     "/",
    HttpOnly: true,
    Secure:   true,
    SameSite: http.SameSiteStrictMode,
    MaxAge:   -1,
})
```
