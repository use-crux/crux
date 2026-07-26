package localserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
)

func registerPromptTextRoutes(mux *http.ServeMux, analyzer indexprompttext.Analyzer) {
	mux.HandleFunc("POST /api/project/index/prompt-text", func(w http.ResponseWriter, r *http.Request) {
		if analyzer == nil {
			http.Error(w, "PromptText unavailable", http.StatusServiceUnavailable)
			return
		}
		if r.ContentLength > indexprompttext.MaxRequestBytes {
			http.Error(w, http.StatusText(http.StatusRequestEntityTooLarge), http.StatusRequestEntityTooLarge)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, indexprompttext.MaxRequestBytes)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var request indexprompttext.Request
		if err := decoder.Decode(&request); err != nil {
			writePromptTextDecodeError(w, err)
			return
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		if len(request.Text) > indexprompttext.MaxDocumentBytes {
			http.Error(w, http.StatusText(http.StatusRequestEntityTooLarge), http.StatusRequestEntityTooLarge)
			return
		}
		if request.File == "" || request.LanguageID == "" {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
		result, err := analyzer.Analyze(r.Context(), request)
		if err != nil {
			http.Error(w, "PromptText unavailable", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, r, result)
	})
}

func writePromptTextDecodeError(w http.ResponseWriter, err error) {
	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		http.Error(w, http.StatusText(http.StatusRequestEntityTooLarge), http.StatusRequestEntityTooLarge)
		return
	}
	http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
}
