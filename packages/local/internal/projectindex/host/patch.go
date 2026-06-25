package host

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/patch"
)

func staticPatchOptions(root string) patch.Options {
	return patch.Options{
		Root:             root,
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: indexwire.MaxFactsPerBatch("indexProjectAst"),
		Producer:         workerProducer,
	}
}
