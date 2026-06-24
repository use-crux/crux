package resources

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
)

func RegisterRoutes(mux *http.ServeMux, inspection *resourceinspection.Service) {
	mux.HandleFunc("GET /api/resources/capabilities", func(w http.ResponseWriter, r *http.Request) {
		caps, err := inspection.Capabilities(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, caps)
	})
	mux.HandleFunc("GET /api/resources/{resourceId}", func(w http.ResponseWriter, r *http.Request) {
		result, err := inspection.Get(r.Context(), resourceinspection.GetRequest{
			ResourceID: r.PathValue("resourceId"),
			Key:        r.URL.Query().Get("key"),
			PeerID:     r.URL.Query().Get("peerId"),
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, result)
	})
	mux.HandleFunc("GET /api/resources/{resourceId}/entries", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		result, err := inspection.List(r.Context(), resourceinspection.ListRequest{
			ResourceID: r.PathValue("resourceId"),
			Prefix:     r.URL.Query().Get("prefix"),
			Cursor:     r.URL.Query().Get("cursor"),
			Limit:      limit,
			PeerID:     r.URL.Query().Get("peerId"),
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, result)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
