package service

import "context"

type projectIndexPipeline struct {
	service *Service
}

func (s *Service) pipeline() projectIndexPipeline {
	return projectIndexPipeline{service: s}
}

func projectReindexContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, DefaultProjectIndexReindexTimeout)
}
