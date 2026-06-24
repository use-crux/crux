package devtools

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
)

type ResourceInspector interface {
	List(context.Context, resourceinspection.ListRequest) (resourceinspection.ResourceResult, error)
}
