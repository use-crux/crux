package indexhost

import (
	"github.com/use-crux/crux/packages/local/internal/indexhost/indexwire"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticcompile/patch"
)

func staticPatchOptions(root string) patch.Options {
	return patch.Options{
		Root:             root,
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: indexwire.MaxFactsPerBatch("indexProjectAst"),
		Producer:         workerProducer,
	}
}
