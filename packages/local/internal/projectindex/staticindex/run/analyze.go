package run

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend/record"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

// analyzeFiles selects the source files the compiler must analyze for this run
// (cache misses plus planned record files) and attaches their source text.
func analyzeFiles(
	plan projectindex.ProjectStaticSyntaxPlan,
	preparePlan protocol.Plan,
	sourceInput sourceprofile.Input,
) ([]protocol.AnalyzeFile, error) {
	sourceFiles := sourceprofile.FilesToAnalyze(preparePlan.CacheMisses, record.Files(plan))
	return sourceprofile.AnalyzeFilesWithSourceText(sourceFiles, sourceInput.SourceTextByFile)
}
