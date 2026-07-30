package commands

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestResolveCatalogDefinitionIDAcceptsCanonicalAndBareIDs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/catalog" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"definitions":[
			{"id":"prompt:demo.support","kind":"prompt"},
			{"id":"tool:searchPolicies","kind":"tool"}
		]}`))
	}))
	defer server.Close()
	client := api.New(server.URL)

	for _, test := range []struct {
		input string
		want  string
	}{
		{input: "prompt:demo.support", want: "prompt:demo.support"},
		{input: "demo.support", want: "prompt:demo.support"},
		{input: "searchPolicies", want: "tool:searchPolicies"},
	} {
		t.Run(test.input, func(t *testing.T) {
			got, err := resolveCatalogDefinitionID(context.Background(), client, test.input, "crux catalog list")
			if err != nil || got != test.want {
				t.Fatalf("resolveCatalogDefinitionID(%q) = (%q, %v), want %q", test.input, got, err, test.want)
			}
		})
	}
}

func TestResolveCatalogDefinitionIDListsAmbiguousMatchesAndAcceptedShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"definitions":[
			{"id":"tool:shared","kind":"tool"},
			{"id":"prompt:shared","kind":"prompt"}
		]}`))
	}))
	defer server.Close()
	client := api.New(server.URL)

	_, err := resolveCatalogDefinitionID(context.Background(), client, "shared", "crux catalog list")
	if err == nil || err.Error() != `definition ID "shared" is ambiguous; use one of: prompt:shared, tool:shared` {
		t.Fatalf("ambiguous error = %v", err)
	}
	_, err = resolveCatalogDefinitionID(context.Background(), client, "missing", "crux catalog list")
	if err == nil || err.Error() != "Catalog definition \"missing\" not found; expected a bare ID like my.prompt or a kind-prefixed ID like prompt:my.prompt. Run `crux catalog list` to list available definitions" {
		t.Fatalf("not-found error = %v", err)
	}
}
