package tui

import "github.com/use-crux/crux/packages/local/internal/tui/screens"

// Capabilities describes optional production behavior available to the TUI.
// A false field means the corresponding screen or action must not be exposed.
type Capabilities struct {
	// DatasetSuites reports whether the injected data client exposes its
	// optional suite service. Navigation additionally requires a mounted
	// screen, which is intentionally deferred to the Datasets tranche.
	DatasetSuites bool
}

// datasetSuiteCapability is the narrow optional contract implemented by a
// production client once its dataset-suite service is available.
type datasetSuiteCapability interface {
	SupportsDatasetSuites() bool
}

func discoverCapabilities(client screens.DataClient) Capabilities {
	provider, ok := client.(datasetSuiteCapability)
	return Capabilities{DatasetSuites: ok && provider.SupportsDatasetSuites()}
}

// Capabilities reports the optional production behavior discovered for this
// Workbench's injected client and local services.
func (w *Workbench) Capabilities() Capabilities {
	return w.capabilities
}
