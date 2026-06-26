package host

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
)

type projectStaticSyntaxPlanResult = planner.InspectResult

func (w *Bundle) inspectProjectStaticSyntaxPlan(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (projectStaticSyntaxPlanResult, error) {
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return projectStaticSyntaxPlanResult{}, fmt.Errorf("resolve project root for Static Index plan: %w", err)
	}
	key := projectStaticSyntaxPlanKey{root: absoluteRoot, configPath: configPath, projectName: projectName}
	return w.sharedProjectStaticSyntaxPlan(ctx, key, func(ctx context.Context) (projectStaticSyntaxPlanResult, error) {
		return planner.Inspect(ctx, planner.ArtifactReaderFunc(w.streamArtifact), absoluteRoot, configPath, projectName)
	})
}
