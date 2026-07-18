package localserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/review"
)

const maxFeedbackRequestBytes = 128 * 1_024

func registerFeedbackRoutes(
	mux *http.ServeMux,
	service *review.Service,
	observabilityService *observability.Service,
) {
	mux.HandleFunc("POST /api/feedback", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "feedback service unavailable", http.StatusServiceUnavailable)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxFeedbackRequestBytes)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var input review.Submission
		if err := decoder.Decode(&input); err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				http.Error(w, http.StatusText(http.StatusRequestEntityTooLarge), http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, "invalid feedback submission", http.StatusBadRequest)
			return
		}
		var trailing any
		if err := decoder.Decode(&trailing); err != io.EOF {
			http.Error(w, "invalid feedback submission", http.StatusBadRequest)
			return
		}

		runExists := false
		var runContext review.ContextSnapshot
		if observabilityService != nil {
			run, err := observabilityService.Run(r.Context(), input.RunID)
			switch {
			case err == nil:
				runExists = true
				runContext = feedbackContextSnapshot(r.Context(), observabilityService, run)
			case errors.Is(err, observability.ErrNotFound):
			default:
				slog.Warn("feedback run lookup failed", "error", err)
				http.Error(w, "feedback context lookup failed", http.StatusServiceUnavailable)
				return
			}
		}

		receipt, err := service.Submit(r.Context(), input, runExists)
		if err != nil {
			var validationError *review.ValidationError
			if errors.Is(err, privacy.ErrPolicyUnavailable) {
				http.Error(w, privacy.PolicyUnavailableMessage, http.StatusServiceUnavailable)
				return
			}
			if errors.As(err, &validationError) {
				http.Error(w, validationError.Error(), http.StatusBadRequest)
				return
			}
			slog.Warn("feedback submission failed", "error", err)
			http.Error(w, "feedback submission failed", http.StatusInternalServerError)
			return
		}
		if runExists {
			if err := service.LinkRunContext(r.Context(), runContext); err != nil {
				slog.Warn("feedback context snapshot failed", "error", err)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		if receipt.Status == "created" {
			w.WriteHeader(http.StatusCreated)
		}
		if err := json.NewEncoder(w).Encode(receipt); err != nil {
			slog.Warn("feedback receipt encode failed", "error", err)
		}
	})
}

func feedbackContextSnapshot(ctx context.Context, service *observability.Service, run observability.RunSummary) review.ContextSnapshot {
	snapshot := review.ContextSnapshot{
		RunID:         run.RunID,
		Name:          run.Name,
		RootPrimitive: run.RootPrimitive,
		Status:        run.Status,
		StartedAt:     run.StartedAt,
		EndedAt:       run.EndedAt,
		Model:         run.Model,
		Provider:      run.Provider,
		PromptID:      run.PromptID,
	}
	graph, err := service.Graph(ctx, run.RunID)
	if err != nil {
		return snapshot
	}
	for _, artifact := range graph.Artifacts {
		switch artifact.Kind {
		case "input":
			if len(snapshot.Input) == 0 {
				if input := reviewContextField(artifact.Preview, "input"); len(input) > 0 {
					snapshot.Input = input
				} else {
					snapshot.Input = artifact.Preview
				}
			}
			if len(snapshot.Call) == 0 {
				snapshot.Call = reviewContextField(artifact.Attributes, "call")
				if len(snapshot.Call) == 0 {
					snapshot.Call = reviewContextField(artifact.Preview, "call")
				}
			}
		case "output":
			snapshot.Output = artifact.Preview
		}
	}
	return snapshot
}

func reviewContextField(value json.RawMessage, name string) json.RawMessage {
	var object map[string]json.RawMessage
	if len(value) == 0 || json.Unmarshal(value, &object) != nil {
		return nil
	}
	return object[name]
}
