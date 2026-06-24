package projectindexer

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

// PlanProjectSemanticRequest builds an evidence-first semantic request for the
// native static path. The service may run it before AST finalization and will
// join AST-owned source rows/sourceGraph before applying the semantic patch.
func (w *Worker) PlanProjectSemanticRequest(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (devtools.ProjectSemanticIndexRequest, error) {
	if w == nil || w.syntaxParser == nil {
		return devtools.ProjectSemanticIndexRequest{}, fmt.Errorf("semantic planning requires native static source planning")
	}
	planResult, err := w.inspectProjectStaticSyntaxPlan(ctx, root, configPath, projectName)
	if err != nil {
		return devtools.ProjectSemanticIndexRequest{}, err
	}
	plan := planResult.Plan
	if !plan.NativeAstEnabled || !projectStaticPlanNativeStaticSchedulable(plan) {
		return devtools.ProjectSemanticIndexRequest{}, fmt.Errorf("native static semantic planning is not schedulable")
	}
	sourceInput, err := projectNativeStaticSourceInputFromPlan(plan)
	if err != nil {
		return devtools.ProjectSemanticIndexRequest{}, err
	}
	closure := projectNativeStaticUniqueFiles(plan.Files)
	sourceProfile := projectNativeStaticSemanticRequestProfile(sourceInput.SemanticSourceProfile, closure)
	return devtools.ProjectSemanticIndexRequest{
		Root:              plan.Root,
		ConfigPath:        configPath,
		ProjectName:       projectName,
		Files:             projectNativeStaticSemanticRootFiles(plan.PrimaryFiles, sourceProfile),
		DependencyClosure: closure,
		SourceProfile:     sourceProfile,
	}, nil
}

func projectNativeStaticSemanticRequestProfile(
	profile *devtools.SemanticSourceProfile,
	dependencyClosure []string,
) *devtools.SemanticSourceProfile {
	if profile == nil {
		return nil
	}
	next := *profile
	next.DependencyClosure = projectNativeStaticUniqueFiles(dependencyClosure)
	profileFiles := map[string]bool{}
	for _, file := range next.Files {
		if file.File != "" {
			profileFiles[file.File] = true
		}
	}
	next.Complete = len(next.DependencyClosure) > 0
	for _, file := range next.DependencyClosure {
		if !profileFiles[file] {
			next.Complete = false
			break
		}
	}
	return &next
}

func projectNativeStaticSemanticRootFiles(
	files []string,
	profile *devtools.SemanticSourceProfile,
) []string {
	if profile == nil {
		return projectNativeStaticUniqueFiles(files)
	}
	profilesByFile := map[string]devtools.SemanticSourceProfileFile{}
	for _, file := range profile.Files {
		if file.File != "" {
			profilesByFile[file.File] = file
		}
	}
	out := []string{}
	for _, file := range projectNativeStaticUniqueFiles(files) {
		profileFile, ok := profilesByFile[file]
		if !ok || projectNativeStaticIsSemanticRootProfile(profileFile) {
			out = append(out, file)
		}
	}
	return out
}

func projectNativeStaticIsSemanticRootProfile(profile devtools.SemanticSourceProfileFile) bool {
	if profile.Hints == nil {
		return true
	}
	hints := profile.Hints
	hasCurrentShapeHints := hints.CruxCallNames != nil || hints.HasZodObject || hints.NativeDirectCruxCandidate
	if !hasCurrentShapeHints {
		return true
	}
	return len(hints.CruxCallNames) > 0
}
