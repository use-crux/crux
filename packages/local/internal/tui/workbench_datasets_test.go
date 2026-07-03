package tui

import "testing"

func TestWorkbenchRegistersDatasetsNav(t *testing.T) {
	w := NewWorkbench(nil, nil, "")
	if _, ok := w.screens["datasets"]; !ok {
		t.Fatalf("workbench did not register Datasets screen")
	}
	if got := navIDByKey["6"]; got != "datasets" {
		t.Fatalf("key 6 routes to %q, want datasets", got)
	}
}
