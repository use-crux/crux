package record

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
)

func ParseRequests(plan projectindex.ProjectStaticSyntaxPlan) []frontend.Request {
	files := Files(plan)
	requests := make([]frontend.Request, 0, len(files))
	for _, file := range files {
		requests = append(requests, frontend.Request{
			Root:                     plan.Root,
			File:                     file,
			ReadSourceFromDisk:       true,
			CallNames:                plan.CallNames,
			CallInterests:            CallInterests(plan.CallInterests),
			ConstructorNames:         plan.ConstructorNames,
			ConstructorInterests:     ConstructorInterests(plan.ConstructorInterests),
			PruneNativeFactCallNames: plan.PruneNativeFactCallNames,
		})
	}
	return requests
}

func Files(plan projectindex.ProjectStaticSyntaxPlan) []string {
	if plan.FilesToParse != nil {
		return plan.FilesToParse
	}
	return plan.Files
}

func Frontend(plan projectindex.ProjectStaticSyntaxPlan) *projectindex.SyntaxFrontend {
	if plan.SyntaxFrontend.Name == "" && plan.SyntaxFrontend.Version == "" {
		return nil
	}
	return &plan.SyntaxFrontend
}
