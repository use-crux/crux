package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

func TestRequireSessionAuth_protectsApiAndWs(t *testing.T) {
	const token = "test-token"
	srv := httptest.NewServer(requireSessionAuth(token, okHandler()))
	defer srv.Close()

	// Static shell loads without a session.
	if code := getStatus(t, srv.Client(), srv.URL+"/", nil); code != http.StatusOK {
		t.Errorf("GET / status = %d, want 200", code)
	}

	// Protected surfaces require a session.
	for _, path := range []string{"/api/stats", "/ws/ui"} {
		if code := getStatus(t, srv.Client(), srv.URL+path, nil); code != http.StatusUnauthorized {
			t.Errorf("GET %s without session = %d, want 401", path, code)
		}
	}
}

func TestRequireSessionAuth_tokenExchangeSetsCookie(t *testing.T) {
	const token = "test-token"
	srv := httptest.NewServer(requireSessionAuth(token, okHandler()))
	defer srv.Close()

	// Don't auto-follow redirects so we can inspect the exchange response.
	client := srv.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	resp, err := client.Get(srv.URL + "/?t=" + token)
	if err != nil {
		t.Fatalf("exchange GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("exchange status = %d, want 303", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); loc != "/" {
		t.Errorf("redirect Location = %q, want /", loc)
	}
	var session *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookieName {
			session = c
		}
	}
	if session == nil {
		t.Fatal("expected session cookie to be set")
	}
	if !session.HttpOnly || session.SameSite != http.SameSiteStrictMode {
		t.Errorf("cookie hardening = HttpOnly:%v SameSite:%v, want HttpOnly + Strict", session.HttpOnly, session.SameSite)
	}

	// The issued cookie authenticates a protected request.
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/stats", nil)
	req.AddCookie(session)
	if code := getStatusReq(t, srv.Client(), req); code != http.StatusOK {
		t.Errorf("GET /api/stats with cookie = %d, want 200", code)
	}
}

func TestRequireSessionAuth_rejectsBadToken(t *testing.T) {
	const token = "test-token"
	srv := httptest.NewServer(requireSessionAuth(token, okHandler()))
	defer srv.Close()

	if code := getStatus(t, srv.Client(), srv.URL+"/?t=wrong", nil); code != http.StatusUnauthorized {
		t.Errorf("exchange with bad token = %d, want 401", code)
	}

	bad := &http.Cookie{Name: sessionCookieName, Value: "wrong"}
	if code := getStatus(t, srv.Client(), srv.URL+"/api/stats", bad); code != http.StatusUnauthorized {
		t.Errorf("GET /api/stats with bad cookie = %d, want 401", code)
	}
}

func TestWithSessionToken(t *testing.T) {
	if got := withSessionToken("http://x/", ""); got != "http://x/" {
		t.Errorf("empty token should not modify URL, got %q", got)
	}
	if got := withSessionToken("https://h.ngrok.app", "abc"); got != "https://h.ngrok.app?t=abc" {
		t.Errorf("token append = %q", got)
	}
	if got := withSessionToken("http://x/?a=1", "abc"); got != "http://x/?a=1&t=abc" {
		t.Errorf("token append with existing query = %q", got)
	}
}

func getStatus(t *testing.T, c *http.Client, url string, cookie *http.Cookie) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	return getStatusReq(t, c, req)
}

func getStatusReq(t *testing.T, c *http.Client, req *http.Request) int {
	t.Helper()
	resp, err := c.Do(req)
	if err != nil {
		t.Fatalf("request %s: %v", req.URL, err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}
