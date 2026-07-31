package localserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

const maxEvidenceBatchRequestBytes = 64 * 1024

func registerEvidenceBatchReadRoutes(
	mux *http.ServeMux,
	service *observability.Service,
) {
	mux.HandleFunc(
		"POST /api/observability/evidence/subjects/summary",
		func(w http.ResponseWriter, r *http.Request) {
			if !evidenceBatchReadAvailable(w, r, service) {
				return
			}
			request, ok := decodeEvidenceBatchRequest[observability.EvidenceSubjectSummaryRequest](w, r)
			if !ok {
				return
			}
			result, err := service.SummarizeEvidenceSubjects(
				r.Context(),
				request,
			)
			writeEvidenceBatchResult(w, r, result, err)
		},
	)
	mux.HandleFunc(
		"POST /api/observability/evidence/navigation/resolve",
		func(w http.ResponseWriter, r *http.Request) {
			if !evidenceBatchReadAvailable(w, r, service) {
				return
			}
			request, ok := decodeEvidenceBatchRequest[observability.EvidenceNavigationRequest](w, r)
			if !ok {
				return
			}
			result, err := service.ResolveEvidenceNavigation(
				r.Context(),
				request,
			)
			writeEvidenceBatchResult(w, r, result, err)
		},
	)
}

func evidenceBatchReadAvailable(
	w http.ResponseWriter,
	r *http.Request,
	service *observability.Service,
) bool {
	if service == nil {
		http.Error(
			w,
			"observability service unavailable",
			http.StatusServiceUnavailable,
		)
		return false
	}
	if !evidenceInspectAuthorized(r) {
		writeEvidenceInspectError(
			w,
			http.StatusUnauthorized,
			"EVIDENCE_ACCESS_DENIED",
		)
		return false
	}
	return true
}

func decodeEvidenceBatchRequest[T any](
	w http.ResponseWriter,
	r *http.Request,
) (T, bool) {
	var request T
	r.Body = http.MaxBytesReader(w, r.Body, maxEvidenceBatchRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeEvidenceInspectDecodeError(w, err)
		return request, false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeEvidenceInspectError(
			w,
			http.StatusBadRequest,
			"EVIDENCE_INPUT_INVALID",
		)
		return request, false
	}
	return request, true
}

func writeEvidenceBatchResult(
	w http.ResponseWriter,
	r *http.Request,
	result any,
	err error,
) {
	if err != nil {
		status := http.StatusInternalServerError
		code := "EVIDENCE_QUERY_FAILED"
		if errors.Is(err, observability.ErrEvidenceInputInvalid) {
			status = http.StatusBadRequest
			code = "EVIDENCE_INPUT_INVALID"
		}
		writeEvidenceInspectError(w, status, code)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(result); err != nil {
		requestLogger(r).Error("JSON encode error", "error", err)
	}
}
