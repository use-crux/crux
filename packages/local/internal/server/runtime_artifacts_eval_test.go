package server

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type evalCapacityProjectIndexer struct {
	fakeProjectIndexer
	isolation bool
	held      bool
}

func (i *evalCapacityProjectIndexer) AcquireEvalDiscoveryCapacity(context.Context) (func(), error) {
	return func() {}, nil
}

func (i *evalCapacityProjectIndexer) AcquireContendedCompilerCapacity(context.Context) (func(), error) {
	i.held = true
	return func() { i.held = false }, nil
}

func (i *evalCapacityProjectIndexer) EvalDiscoveryIsolationRequired() bool {
	return i.isolation
}

func (i *evalCapacityProjectIndexer) PrepareEvalDiscoveryIsolation(projectindex.ProjectSemanticIndexRequest) {
}

func TestRuntimeArtifactsShareLargeProjectEvalDiscoveryCapacity(t *testing.T) {
	for _, test := range []struct {
		name      string
		isolation bool
	}{
		{name: "large project", isolation: true},
		{name: "small project", isolation: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			indexer := &evalCapacityProjectIndexer{isolation: test.isolation}
			service := devtools.NewService(store.NewStore(), inspect.NewService(store.NewStore(), inspect.Dir(t.TempDir()))).
				WithProjectIndexer(indexer)
			defer service.Shutdown()
			generate := discoveryIsolatedRuntimeArtifactGenerator(
				func(context.Context, string, []store.ProjectDefinition) error {
					if indexer.held != test.isolation {
						t.Fatalf("capacity held = %v, want %v", indexer.held, test.isolation)
					}
					return nil
				},
				service,
			)
			if err := generate(t.Context(), t.TempDir(), nil); err != nil {
				t.Fatal(err)
			}
			if indexer.held {
				t.Fatal("runtime artifact capacity was not released")
			}
		})
	}
}
