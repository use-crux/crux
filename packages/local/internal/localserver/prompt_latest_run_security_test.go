package localserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/devtools/promptlatest"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptLatestRunRouteIsMountedOutsideGlobalCORS(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	index := store.NewStore()
	index.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{{
			ID: "prompt:greeting", Kind: "prompt", Name: "Greeting",
		}},
	})
	devtoolsService := devtools.NewService(
		index,
		inspect.NewService(index, inspect.Dir(t.TempDir())),
	)
	t.Cleanup(devtoolsService.Shutdown)
	observabilityService, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := observabilityService.Close(); err != nil {
			t.Fatal(err)
		}
	})
	handler := New(Options{
		Devtools:      devtoolsService,
		Observability: observabilityService,
		OriginAllowed: func(*http.Request) bool { return true },
	})
	request := httptest.NewRequest(
		http.MethodGet,
		"http://127.0.0.1:7821/api/devtools/prompt-latest-run/prompt%3Agreeting",
		nil,
	)
	request.Header.Set(promptlatest.RequestHeader, promptlatest.RequestHeaderValue)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK ||
		!strings.Contains(response.Body.String(), `"status":"empty"`) {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "" ||
		response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("headers = %#v", response.Header())
	}
}
