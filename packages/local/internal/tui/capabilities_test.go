package tui

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

type datasetSuiteCapableClient struct {
	screens.DataClient
}

func (datasetSuiteCapableClient) SupportsDatasetSuites() bool { return true }

func TestWorkbenchDerivesUnsupportedDatasetsFromProductionClient(t *testing.T) {
	var client screens.DataClient = (*devtools.DirectClient)(nil)
	w := newTestWorkbench(client, nil, "")

	if w.Capabilities().DatasetSuites {
		t.Fatal("production DirectClient unexpectedly advertises dataset suites")
	}
	if _, exposed := w.screens["datasets"]; exposed {
		t.Fatal("workbench exposed Datasets without a production dataset-suite capability")
	}
}

func TestWorkbenchDiscoversInjectedDatasetSuiteCapability(t *testing.T) {
	client := datasetSuiteCapableClient{DataClient: (*devtools.DirectClient)(nil)}
	w := newTestWorkbench(client, nil, "")

	if !w.Capabilities().DatasetSuites {
		t.Fatal("workbench did not discover the injected dataset-suite capability")
	}
	if _, exposed := w.screens["datasets"]; exposed {
		t.Fatal("capability discovery exposed a Datasets route without an implemented screen")
	}
}

func TestWorkbenchNavigationOmitsUnregisteredScreens(t *testing.T) {
	w := newTestWorkbench((*devtools.DirectClient)(nil), nil, "")
	delete(w.screens, "index")

	for _, item := range w.navWithCounts() {
		if item.ID == "index" {
			t.Fatal("navigation exposed an unregistered Index screen")
		}
	}
	for _, action := range w.workspaceActions() {
		if action.ID == "workspace.nav.index" {
			t.Fatal("workspace actions exposed an unregistered Index screen")
		}
	}
}
