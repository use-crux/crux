package workers

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/session"
)

func staticPatchOptions(root string) session.PatchOptions {
	return session.PatchOptions{
		Root:             root,
		MaxBytes:         workerMaxResponseStreamBytes,
		MaxFactsPerBatch: 100,
		Producer:         workerProducer,
	}
}
