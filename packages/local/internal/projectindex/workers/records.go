package workers

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

// IndexProjectAstFromSyntaxRecordsPatch projects Static Index syntax records
// through the explicit TypeScript projection path.
func (w *Bundle) IndexProjectAstFromSyntaxRecordsPatch(ctx context.Context, root, configPath, projectName string, records []json.RawMessage, syntaxFrontend ...*projectindex.SyntaxFrontend) (projectindex.IndexPatch, error) {
	var identity *projectindex.SyntaxFrontend
	if len(syntaxFrontend) > 0 {
		identity = syntaxFrontend[0]
	}
	return w.indexProjectAstFromSyntaxRecordsPatch(ctx, root, configPath, projectName, records, identity, nil)
}

func (w *Bundle) indexProjectAstFromSyntaxRecordsPatch(ctx context.Context, root, configPath, projectName string, records []json.RawMessage, identity *projectindex.SyntaxFrontend, staticCacheHits []projectindex.StaticCacheHit) (projectindex.IndexPatch, error) {
	req := requestwire.Request{
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		ResolutionMode:  "source-only",
		SyntaxRecords:   records,
		SyntaxFrontend:  identity,
		StaticCacheHits: staticCacheHits,
	}
	patches, err := w.streamPatches(ctx, req, projectindex.IndexPatchBudget{})
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, fmt.Errorf("project ast syntax-record worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}
