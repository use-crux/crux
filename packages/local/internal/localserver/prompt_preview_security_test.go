package localserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptPreviewRoutesOwnPreflightAndPrivacyAfterGlobalMiddleware(t *testing.T) {
	index := store.NewStore()
	service := devtools.NewService(
		index,
		inspect.NewService(index, inspect.Dir(t.TempDir())),
	)
	defer service.Shutdown()
	handler := New(Options{
		Devtools: service,
		OriginAllowed: func(*http.Request) bool {
			return true
		},
	})

	for _, path := range []string{
		"/api/devtools/prompt-preview",
		"/api/devtools/prompt-preview/prompt%3Awriter",
	} {
		request := httptest.NewRequest(http.MethodOptions, "http://local.test"+path, nil)
		request.Header.Set("Origin", "http://foreign.test")
		request.Header.Set("Access-Control-Request-Method", http.MethodPost)
		request.Header.Set(
			"Access-Control-Request-Headers",
			"X-Crux-Devtools-Request",
		)
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s preflight = %d, want 405", path, recorder.Code)
		}
		if recorder.Header().Get("Cache-Control") != "no-store" ||
			recorder.Header().Get("Referrer-Policy") != "no-referrer" ||
			recorder.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s preflight headers = %#v", path, recorder.Header())
		}
	}
}
