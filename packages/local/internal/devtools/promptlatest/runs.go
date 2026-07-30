package promptlatest

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

type runsPort interface {
	LatestOperationForDefinition(
		context.Context,
		string,
	) (observability.LatestDefinitionOperationSnapshot, error)
}
