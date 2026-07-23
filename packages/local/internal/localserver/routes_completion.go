package localserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
)

func registerCompletionRoutes(mux *http.ServeMux, provider indexcompletion.Provider) {
	mux.HandleFunc("POST /api/project/index/completions", func(w http.ResponseWriter, r *http.Request) {
		if provider == nil {
			http.Error(w, "project completion unavailable", http.StatusServiceUnavailable)
			return
		}
		if r.ContentLength > indexcompletion.MaxRequestBytes {
			http.Error(w, http.StatusText(http.StatusRequestEntityTooLarge), http.StatusRequestEntityTooLarge)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, indexcompletion.MaxRequestBytes)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var request indexcompletion.Request
		if err := decoder.Decode(&request); err != nil {
			writeCompletionDecodeError(w, err)
			return
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		if len(request.Text) > indexcompletion.MaxDocumentBytes {
			http.Error(w, http.StatusText(http.StatusRequestEntityTooLarge), http.StatusRequestEntityTooLarge)
			return
		}
		if request.File == "" || request.LanguageID == "" {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		result, err := provider.Complete(r.Context(), request)
		if err != nil {
			http.Error(w, "project completion unavailable", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, r, result)
	})
}

func writeCompletionDecodeError(w http.ResponseWriter, err error) {
	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		http.Error(w, http.StatusText(http.StatusRequestEntityTooLarge), http.StatusRequestEntityTooLarge)
		return
	}
	http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
}
