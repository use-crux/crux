package localserver

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/review"
)

const maxReviewActionBytes = 128 * 1024

type reviewActionRequest struct {
	Type               string          `json:"type"`
	EvalID             string          `json:"evalId,omitempty"`
	CaseID             string          `json:"caseId,omitempty"`
	Input              json.RawMessage `json:"input,omitempty"`
	Call               json.RawMessage `json:"call,omitempty"`
	Name               string          `json:"name,omitempty"`
	Tags               []string        `json:"tags,omitempty"`
	CorrectionProposal json.RawMessage `json:"correctionProposal,omitempty"`
	SaveCorrection     bool            `json:"saveCorrection,omitempty"`
}

func registerReviewRoutes(mux *http.ServeMux, service *review.Service, writer review.RepositoryWriter) {
	mux.HandleFunc("POST /api/reviews/{reviewId}/actions", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "Review service unavailable", http.StatusServiceUnavailable)
			return
		}
		input, ok := decodeReviewAction(w, r)
		if !ok {
			return
		}
		reviewID := r.PathValue("reviewId")
		if input.Type == "add-to-eval" {
			projection, _, err := service.Review(r.Context(), reviewID)
			if err != nil {
				writeReviewError(w, err)
				return
			}
			if projection.Status != "open" &&
				(projection.Status != "added-to-eval" ||
					projection.TargetEvalID != input.EvalID ||
					projection.TargetCaseID != input.CaseID) {
				http.Error(w, "Review is already finalized and cannot be reopened in V1", http.StatusConflict)
				return
			}
			if writer == nil {
				http.Error(w, "Add-to-eval repository writer unavailable", http.StatusServiceUnavailable)
				return
			}
			result, err := writer.AddReviewCase(r.Context(), review.AddCaseRequest{
				EvalID: input.EvalID, ID: input.CaseID, Input: input.Input, Call: input.Call,
				Name: input.Name, Tags: input.Tags, ReviewID: reviewID, RunID: projection.RunID,
				CorrectionProposal: input.CorrectionProposal, SaveCorrection: input.SaveCorrection,
				RepositoryWritable: true,
			})
			if err != nil {
				slog.Warn("Add-to-eval failed", "error", err)
				http.Error(w, "Add-to-eval failed", http.StatusBadRequest)
				return
			}
			if result.Status == "added" || result.Status == "linked" {
				_, err = service.ApplyAction(r.Context(), review.Action{
					ReviewID: reviewID, Type: "added-to-eval",
					TargetEvalID: input.EvalID, TargetCaseID: result.CaseID,
				})
				if err != nil {
					writeReviewError(w, err)
					return
				}
			}
			writeJSON(w, result)
			return
		}
		projection, err := service.ApplyAction(r.Context(), review.Action{ReviewID: reviewID, Type: input.Type})
		if err != nil {
			writeReviewError(w, err)
			return
		}
		writeJSON(w, projection)
	})
}

func decodeReviewAction(w http.ResponseWriter, r *http.Request) (reviewActionRequest, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxReviewActionBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input reviewActionRequest
	if err := decoder.Decode(&input); err != nil {
		http.Error(w, "invalid Review action", http.StatusBadRequest)
		return input, false
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		http.Error(w, "invalid Review action", http.StatusBadRequest)
		return input, false
	}
	return input, true
}

func writeReviewError(w http.ResponseWriter, err error) {
	var validation *review.ValidationError
	switch {
	case errors.Is(err, review.ErrNotFound):
		http.Error(w, "Review not found", http.StatusNotFound)
	case errors.As(err, &validation):
		http.Error(w, validation.Error(), http.StatusConflict)
	default:
		http.Error(w, "Review action failed", http.StatusInternalServerError)
	}
}
