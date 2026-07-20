package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

// sessionCookieName holds the per-session bearer token once exchanged.
const sessionCookieName = "crux_session"

// generateSessionToken returns a 256-bit random token used to gate the server
// when it is exposed beyond the loopback interface (tunnel or CRUX_HOST). It is
// never shown to the local user: it is embedded in the auto-opened URL and
// exchanged for an HttpOnly cookie on first load.
func generateSessionToken(logger *slog.Logger) string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand should never fail; if it does, fail closed with an empty
		// token so the caller can decide not to expose the server.
		logger.Error("failed to generate session token", "error", err)
		return ""
	}
	return hex.EncodeToString(buf)
}

// requireSessionAuth gates non-loopback exposure of the dev server with a
// session token. A separate ingest token may authenticate only canonical
// observability ingest and durable feedback submission.
// The token-to-cookie exchange happens transparently: any
// browser request carrying a valid `?t=` token is issued an HttpOnly session
// cookie and redirected to a clean URL, after which every REST and WebSocket
// call rides the cookie automatically (browsers send cookies on same-host WS
// handshakes). Protected API requests may also carry `?t=` directly, which lets
// serverless runtimes post observability records through a tokenized tunnel URL.
//
// Only the data/action surfaces (`/api/`, `/ws/`) are protected. The static UI
// shell loads without a cookie so it can bootstrap, but it cannot read any data
// or trigger any action without a valid session.
func requireSessionAuth(token string, ingestToken string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isIngestWriteRequest(r) && hasValidIngestBearer(r, ingestToken) {
			next.ServeHTTP(w, r)
			return
		}

		if token == "" {
			// Fail closed: a server that wanted auth but has no token must not
			// serve protected surfaces.
			if isProtectedPath(r.URL.Path) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		// Token-to-cookie exchange. Accepts the token from the query string
		// (used by the auto-opened/invite URL) and converts it into a durable
		// HttpOnly cookie, then strips the token from the URL.
		if provided := r.URL.Query().Get("t"); provided != "" {
			if tokenMatches(token, provided) {
				if isProtectedPath(r.URL.Path) {
					next.ServeHTTP(w, r)
					return
				}
				http.SetCookie(w, &http.Cookie{
					Name:     sessionCookieName,
					Value:    token,
					Path:     "/",
					HttpOnly: true,
					Secure:   requestIsTLS(r),
					SameSite: http.SameSiteStrictMode,
				})
				http.Redirect(w, r, strippedTokenURL(r.URL), http.StatusSeeOther)
				return
			}
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		if isProtectedPath(r.URL.Path) && !hasValidSession(r, token) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func isIngestWriteRequest(r *http.Request) bool {
	return r.Method == http.MethodPost &&
		(r.URL.Path == "/api/observability/records" || r.URL.Path == "/api/feedback")
}

func isProtectedPath(path string) bool {
	return strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/ws/")
}

func hasValidIngestBearer(r *http.Request, token string) bool {
	if token == "" {
		return false
	}
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	return tokenMatches(token, strings.TrimSpace(strings.TrimPrefix(header, prefix)))
}

func hasValidSession(r *http.Request, token string) bool {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return false
	}
	return tokenMatches(token, cookie.Value)
}

func tokenMatches(want, got string) bool {
	return subtle.ConstantTimeCompare([]byte(want), []byte(got)) == 1
}

// requestIsTLS reports whether the original client connection used HTTPS. The
// ngrok edge terminates TLS and forwards over the tunnel, so the local handler
// sees plaintext but a trustworthy X-Forwarded-Proto header.
func requestIsTLS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func strippedTokenURL(u *url.URL) string {
	clean := *u
	q := clean.Query()
	q.Del("t")
	clean.RawQuery = q.Encode()
	if clean.Path == "" {
		clean.Path = "/"
	}
	return clean.RequestURI()
}

// withSessionToken appends the session token to a base URL as a `t=` query
// parameter so the opened/shared link authenticates on first load.
func withSessionToken(base, token string) string {
	if token == "" {
		return base
	}
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
	}
	return base + sep + "t=" + token
}
