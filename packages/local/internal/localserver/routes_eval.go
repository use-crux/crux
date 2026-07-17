package localserver

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/evalwriter"
)

const maxEvalMutationBytes = 16 * 1024

func registerEvalRoutes(mux *http.ServeMux, writer evalwriter.BaselineWriter) {
	mux.HandleFunc("POST /api/eval/baselines", func(response http.ResponseWriter, request *http.Request) {
		if writer == nil {
			http.Error(response, "Eval Baseline writer unavailable", http.StatusServiceUnavailable)
			return
		}
		input, ok := decodeSetBaseline(response, request)
		if !ok {
			return
		}
		result, err := writer.SetBaseline(request.Context(), input)
		if err != nil {
			http.Error(response, err.Error(), http.StatusConflict)
			return
		}
		writeJSON(response, result)
	})
}

func decodeSetBaseline(response http.ResponseWriter, request *http.Request) (evalwriter.SetBaselineRequest, bool) {
	request.Body = http.MaxBytesReader(response, request.Body, maxEvalMutationBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var input evalwriter.SetBaselineRequest
	if err := decoder.Decode(&input); err != nil || input.RunID == "" {
		http.Error(response, "invalid Set Baseline request", http.StatusBadRequest)
		return input, false
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		http.Error(response, "invalid Set Baseline request", http.StatusBadRequest)
		return input, false
	}
	return input, true
}
