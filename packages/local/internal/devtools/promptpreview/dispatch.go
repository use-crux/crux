package promptpreview

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

type browserRequestWire struct {
	Version           int             `json:"version"`
	DefinitionID      string          `json:"definitionId"`
	PeerID            string          `json:"peerId"`
	Environment       string          `json:"environment"`
	CatalogueRevision uint64          `json:"catalogueRevision"`
	Payload           json.RawMessage `json:"payload"`
	DeadlineMS        *int            `json:"deadlineMs,omitempty"`
}

func decodeBrowserRequest(data []byte) (browserRequestWire, error) {
	var request browserRequestWire
	if err := preview.ValidateUniqueJSONKeys(data); err != nil {
		return request, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return request, errors.New("trailing JSON")
	}
	deadline := 0
	if request.DeadlineMS != nil {
		deadline = *request.DeadlineMS
		if deadline < 1 || deadline > preview.DefaultDeadlineMS {
			return request, errors.New("invalid deadline")
		}
	}
	if request.Version != 1 ||
		!validScalarString(request.DefinitionID, 1, 512) ||
		!validScalarString(request.PeerID, 1, 128) ||
		!validEnvironment(request.Environment) ||
		request.CatalogueRevision == 0 ||
		request.CatalogueRevision > preview.MaxSafeInteger ||
		len(request.Payload) == 0 {
		return request, errors.New("invalid request")
	}
	return request, nil
}

func (s *Service) Dispatch(
	ctx context.Context,
	request browserRequestWire,
) BrowserResponse {
	deadline := 0
	if request.DeadlineMS != nil {
		deadline = *request.DeadlineMS
	}
	response, err := s.bridge.Dispatch(ctx, runtimebridge.DispatchRequest{
		PeerID: request.PeerID, Environment: request.Environment,
		Command: preview.Command, TargetID: request.DefinitionID,
		CatalogueRevision: request.CatalogueRevision,
		Payload:           request.Payload, DeadlineMS: deadline,
	})
	if err != nil {
		return browserFailure(err)
	}
	var discriminator struct {
		Status string `json:"status"`
	}
	if json.Unmarshal(response.Result, &discriminator) != nil {
		return browserError("invalid_response", nil)
	}
	switch discriminator.Status {
	case "ready":
		var result preview.ReadyResult
		if json.Unmarshal(response.Result, &result) != nil {
			return browserError("invalid_response", nil)
		}
		projectedPreview, err := json.Marshal(result.Preview)
		if err != nil {
			return browserError("internal_error", nil)
		}
		contributions, err := json.Marshal(result.Contributions)
		if err != nil {
			return browserError("internal_error", nil)
		}
		return BrowserResponse{
			Status: "ready",
			Peer: &BrowserPeer{
				PeerID: response.PeerID, RuntimeName: response.RuntimeName,
				Environment: response.PeerEnvironment,
			},
			CatalogueRevision: response.CatalogueRevision,
			Preview:           projectedPreview,
			Contributions:     contributions,
		}
	case "validation-error":
		var result preview.ValidationResult
		if json.Unmarshal(response.Result, &result) != nil {
			return browserError("invalid_response", nil)
		}
		return BrowserResponse{
			Status: "validation-error", CatalogueRevision: result.CatalogueRevision,
			Issues: result.Issues, OmittedIssueCount: result.OmittedIssueCount,
		}
	default:
		return browserError("invalid_response", nil)
	}
}

func browserFailure(err error) BrowserResponse {
	var failure *preview.Failure
	if !errors.As(err, &failure) {
		return browserError("internal_error", nil)
	}
	return browserError(failure.Code, failure.Choices)
}

func browserError(code string, choices []preview.PeerChoice) BrowserResponse {
	message := facadeMessages[code]
	if message == "" {
		message = previewFailureMessage(code)
	}
	result := BrowserResponse{Status: "error", Code: code, Message: message}
	if code == "ambiguous_peer" && len(choices) > 0 {
		result.Choices = choices
	}
	return result
}

func previewFailureMessage(code string) string {
	return preview.NewFailure(code).Message
}
