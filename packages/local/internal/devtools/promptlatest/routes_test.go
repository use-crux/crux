package promptlatest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type resolverStub struct {
	result Result
	err    error
}

func (s resolverStub) Resolve(context.Context, string) (Result, error) {
	return s.result, s.err
}

func TestLatestRunRouteReturnsCanonicalFoundDestination(t *testing.T) {
	handler := NewHandler(http.NotFoundHandler(), resolverStub{result: Result{
		Status: StatusFound, DefinitionID: "prompt:greeting",
		ObservabilityRevision: 7, OperationID: "operation+latest",
	}})
	request := httptest.NewRequest(
		http.MethodGet,
		"http://127.0.0.1:7821/api/devtools/prompt-latest-run/prompt%3Agreeting",
		nil,
	)
	request.Header.Set(RequestHeader, RequestHeaderValue)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	want := `{"status":"found","definitionId":"prompt:greeting",` +
		`"observabilityRevision":7,"operationId":"operation+latest",` +
		`"path":"/runs/operation%2Blatest"}`
	if strings.TrimSpace(response.Body.String()) != want {
		t.Fatalf("body = %s, want %s", response.Body.String(), want)
	}
	if response.Header().Get("Cache-Control") != "no-store" ||
		response.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("privacy headers = %#v", response.Header())
	}
}

func TestLatestRunRouteRejectsEmptyQueryMarker(t *testing.T) {
	handler := NewHandler(http.NotFoundHandler(), resolverStub{result: Result{
		Status: StatusEmpty, DefinitionID: "prompt:greeting",
	}})
	request := httptest.NewRequest(
		http.MethodGet,
		"http://127.0.0.1:7821/api/devtools/prompt-latest-run/prompt%3Agreeting?",
		nil,
	)
	request.Header.Set(RequestHeader, RequestHeaderValue)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}
