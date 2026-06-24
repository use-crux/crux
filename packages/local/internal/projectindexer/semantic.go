package projectindexer

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/statichost"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticsource"
)

// PlanProjectSemanticRequest builds an evidence-first semantic request for the
// native static path. The service may run it before AST finalization and will
// join AST-owned source rows/sourceGraph before applying the semantic patch.
func (w *Worker) PlanProjectSemanticRequest(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (projectindex.ProjectSemanticIndexRequest, error) {
	if w == nil || w.syntaxParser == nil {
		return projectindex.ProjectSemanticIndexRequest{}, fmt.Errorf("semantic planning requires native static source planning")
	}
	planResult, err := w.inspectProjectStaticSyntaxPlan(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.ProjectSemanticIndexRequest{}, err
	}
	plan := planResult.Plan
	if !plan.NativeAstEnabled || !statichost.Schedulable(plan) {
		return projectindex.ProjectSemanticIndexRequest{}, fmt.Errorf("native static semantic planning is not schedulable")
	}
	sourceInput, err := staticsource.FromPlan(plan)
	if err != nil {
		return projectindex.ProjectSemanticIndexRequest{}, err
	}
	closure := staticsource.UniqueFiles(plan.Files)
	sourceProfile := staticsource.RequestProfile(sourceInput.SemanticSourceProfile, closure)
	return projectindex.ProjectSemanticIndexRequest{
		Root:              plan.Root,
		ConfigPath:        configPath,
		ProjectName:       projectName,
		Files:             staticsource.RootFiles(plan.PrimaryFiles, sourceProfile),
		DependencyClosure: closure,
		SourceProfile:     sourceProfile,
	}, nil
}
