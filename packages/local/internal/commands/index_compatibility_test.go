package commands

import "testing"

func TestIndexCompatibilityRoutesListAndDefinitionToCatalog(t *testing.T) {
	tests := []struct {
		argument string
		mode     string
		path     string
	}{
		{argument: "", mode: "catalog-list", path: "/api/catalog"},
		{argument: "prompt:writer", mode: "catalog-show", path: "/api/catalog/prompt:writer"},
		{argument: "prompts", mode: "legacy-category", path: "/api/index"},
		{argument: "diagnostics", mode: "legacy-category", path: "/api/index"},
	}
	for _, test := range tests {
		t.Run(test.argument, func(t *testing.T) {
			route := indexCompatibilityRoute(test.argument)
			if route.mode != test.mode || route.path != test.path {
				t.Fatalf("route = %+v, want mode %q path %q", route, test.mode, test.path)
			}
		})
	}
}
