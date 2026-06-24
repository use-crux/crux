package projectindexer

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticplan"
)

type projectStaticSyntaxPlanResult = staticplan.InspectResult

func (w *Worker) inspectProjectStaticSyntaxPlan(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (projectStaticSyntaxPlanResult, error) {
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return projectStaticSyntaxPlanResult{}, fmt.Errorf("resolve project root for native static plan: %w", err)
	}
	key := projectStaticSyntaxPlanKey{root: absoluteRoot, configPath: configPath, projectName: projectName}
	return w.sharedProjectStaticSyntaxPlan(ctx, key, func(ctx context.Context) (projectStaticSyntaxPlanResult, error) {
		return staticplan.Inspect(ctx, staticplan.ArtifactReaderFunc(w.streamArtifact), absoluteRoot, configPath, projectName)
	})
}
