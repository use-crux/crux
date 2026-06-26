package host

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/session"
)

func staticPatchOptions(root string) session.PatchOptions {
	return session.PatchOptions{
		Root:             root,
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: indexwire.MaxFactsPerBatch("indexProjectAst"),
		Producer:         workerProducer,
	}
}
