package localserver

import (
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/server/resources"
)

func registerResourceRoutes(mux *http.ServeMux, inspection *resourceinspection.Service) {
	resources.RegisterRoutes(mux, inspection)
}
