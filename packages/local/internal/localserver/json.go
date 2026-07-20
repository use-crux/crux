package localserver

import (
	"encoding/json"
	"net/http"
)

func writeJSON(w http.ResponseWriter, r *http.Request, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		requestLogger(r).Error("JSON encode error", "error", err)
	}
}
