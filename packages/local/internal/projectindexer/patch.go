package projectindexer

import (
	"github.com/use-crux/crux/packages/local/internal/projectindexer/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticpatch"
)

func staticPatchOptions(root string) staticpatch.Options {
	return staticpatch.Options{
		Root:             root,
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: indexwire.MaxFactsPerBatch("indexProjectAst"),
		Producer:         workerProducer,
	}
}
