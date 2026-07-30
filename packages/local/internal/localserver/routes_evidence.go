package localserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

const maxEvidenceInspectRequestBytes = 16 * 1024

func registerEvidenceInspectRoute(
	mux *http.ServeMux,
	service *observability.Service,
) {
	mux.HandleFunc(
		"POST /api/observability/evidence/inspect",
		func(w http.ResponseWriter, r *http.Request) {
			if service == nil {
				http.Error(
					w,
					"observability service unavailable",
					http.StatusServiceUnavailable,
				)
				return
			}
			if !evidenceInspectAuthorized(r) {
				writeEvidenceInspectError(
					w,
					http.StatusUnauthorized,
					"EVIDENCE_ACCESS_DENIED",
				)
				return
			}
			r.Body = http.MaxBytesReader(
				w,
				r.Body,
				maxEvidenceInspectRequestBytes,
			)
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			var request observability.EvidenceInspectRequest
			if err := decoder.Decode(&request); err != nil {
				writeEvidenceInspectDecodeError(w, err)
				return
			}
			if err := decoder.Decode(&struct{}{}); err != io.EOF {
				writeEvidenceInspectError(
					w,
					http.StatusBadRequest,
					"EVIDENCE_INPUT_INVALID",
				)
				return
			}
			result, err := service.InspectEvidence(r.Context(), request)
			if err != nil {
				switch {
				case errors.Is(err, observability.ErrEvidenceNotFound):
					writeEvidenceInspectError(
						w,
						http.StatusNotFound,
						"EVIDENCE_SUBJECT_NOT_FOUND",
					)
				case errors.Is(
					err,
					observability.ErrEvidenceCursorInvalid,
				):
					writeEvidenceInspectError(
						w,
						http.StatusBadRequest,
						"EVIDENCE_CURSOR_INVALID",
					)
				case errors.Is(
					err,
					observability.ErrEvidenceInputInvalid,
				):
					writeEvidenceInspectError(
						w,
						http.StatusBadRequest,
						"EVIDENCE_INPUT_INVALID",
					)
				default:
					writeEvidenceInspectError(
						w,
						http.StatusInternalServerError,
						"EVIDENCE_QUERY_FAILED",
					)
				}
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(result); err != nil {
				requestLogger(r).Error("JSON encode error", "error", err)
			}
		},
	)
}

func evidenceInspectAuthorized(r *http.Request) bool {
	// Loopback reads use the approved same-user boundary. Non-loopback reads
	// are gated by the server's existing session-cookie middleware. A bearer
	// on this route is the ingest-only credential and must never grant reads.
	return strings.TrimSpace(r.Header.Get("Authorization")) == ""
}

func writeEvidenceInspectDecodeError(w http.ResponseWriter, err error) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeEvidenceInspectError(
			w,
			http.StatusRequestEntityTooLarge,
			"EVIDENCE_INPUT_TOO_LARGE",
		)
		return
	}
	writeEvidenceInspectError(
		w,
		http.StatusBadRequest,
		"EVIDENCE_INPUT_INVALID",
	)
}

func writeEvidenceInspectError(
	w http.ResponseWriter,
	status int,
	code string,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
}
