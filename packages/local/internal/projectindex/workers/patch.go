package workers

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/session"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

func staticPatchOptions(root string) session.PatchOptions {
	return session.PatchOptions{
		Root:             root,
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: requestwire.MaxFactsPerBatch("indexProjectAst"),
		Producer:         workerProducer,
	}
}
