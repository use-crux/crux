// Package promptpreview owns the browser-safe exact Prompt preview facade.
package promptpreview

import (
	"encoding/json"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

const (
	RequestHeader      = "X-Crux-Devtools-Request"
	RequestHeaderValue = "prompt-preview-v1"

	maxDiscoveryChoices     = 32
	maxDiscoveryBytes       = 2_097_152
	maxBrowserBodyBytes     = 300 * 1024
	maxBrowserResponseBytes = 2_101_248
)

// Owner is the current canonical Project Index identity exposed to Devtools.
type Owner struct {
	DefinitionID string `json:"definitionId"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Description  string `json:"description,omitempty"`
}

// RuntimeChoice is the safe projection of one matching live advertisement.
type RuntimeChoice struct {
	PeerID            string       `json:"peerId"`
	RuntimeName       string       `json:"runtimeName"`
	Environment       string       `json:"environment"`
	CatalogueRevision uint64       `json:"catalogueRevision"`
	Target            ChoiceTarget `json:"target"`
}

type ChoiceTarget struct {
	Name        string                  `json:"name"`
	Description string                  `json:"description,omitempty"`
	Input       preview.InputDescriptor `json:"input"`
}

// Discovery is the closed ready/unavailable browser response.
type Discovery struct {
	Status             string          `json:"status"`
	ProjectionRevision uint64          `json:"projectionRevision"`
	Owner              *Owner          `json:"owner,omitempty"`
	Choices            []RuntimeChoice `json:"choices,omitempty"`
	Reason             string          `json:"reason,omitempty"`
	Message            string          `json:"message,omitempty"`
}

var unavailableMessages = map[string]string{
	"owner-not-found":           "This Prompt is no longer present in the current Project Index.",
	"owner-not-prompt":          "Exact preview is available only for canonical Prompt definitions.",
	"no-peer":                   "No live runtime peer is available.",
	"capability-unavailable":    "No live runtime peer supports exact prompt preview.",
	"target-unavailable":        "No live runtime peer advertises this Prompt.",
	"projection-limit-exceeded": "Exact-preview runtime discovery exceeded its safe display limit.",
}

type BrowserPeer struct {
	PeerID      string `json:"peerId"`
	RuntimeName string `json:"runtimeName"`
	Environment string `json:"environment"`
}

// BrowserResponse is the closed facade result. Bridge envelopes and private
// runtime details are deliberately absent.
type BrowserResponse struct {
	Status            string                    `json:"status"`
	Peer              *BrowserPeer              `json:"peer,omitempty"`
	CatalogueRevision uint64                    `json:"catalogueRevision,omitempty"`
	Preview           json.RawMessage           `json:"preview,omitempty"`
	Contributions     json.RawMessage           `json:"contributions,omitempty"`
	Issues            []preview.ValidationIssue `json:"issues,omitempty"`
	OmittedIssueCount int                       `json:"omittedIssueCount,omitempty"`
	Code              string                    `json:"code,omitempty"`
	Message           string                    `json:"message,omitempty"`
	Choices           []preview.PeerChoice      `json:"choices,omitempty"`
}

func (response BrowserResponse) MarshalJSON() ([]byte, error) {
	switch response.Status {
	case "ready":
		return json.Marshal(struct {
			Status            string          `json:"status"`
			Peer              *BrowserPeer    `json:"peer"`
			CatalogueRevision uint64          `json:"catalogueRevision"`
			Preview           json.RawMessage `json:"preview"`
			Contributions     json.RawMessage `json:"contributions"`
		}{
			Status: response.Status, Peer: response.Peer,
			CatalogueRevision: response.CatalogueRevision,
			Preview:           response.Preview,
			Contributions:     response.Contributions,
		})
	case "validation-error":
		issues := response.Issues
		if issues == nil {
			issues = []preview.ValidationIssue{}
		}
		return json.Marshal(struct {
			Status            string                    `json:"status"`
			CatalogueRevision uint64                    `json:"catalogueRevision"`
			Issues            []preview.ValidationIssue `json:"issues"`
			OmittedIssueCount int                       `json:"omittedIssueCount"`
		}{
			Status: response.Status, CatalogueRevision: response.CatalogueRevision,
			Issues: issues, OmittedIssueCount: response.OmittedIssueCount,
		})
	case "error":
		if response.Code == "ambiguous_peer" && len(response.Choices) > 0 {
			return json.Marshal(struct {
				Status  string               `json:"status"`
				Code    string               `json:"code"`
				Message string               `json:"message"`
				Choices []preview.PeerChoice `json:"choices"`
			}{
				Status: response.Status, Code: response.Code,
				Message: response.Message, Choices: response.Choices,
			})
		}
		return json.Marshal(struct {
			Status  string `json:"status"`
			Code    string `json:"code"`
			Message string `json:"message"`
		}{Status: response.Status, Code: response.Code, Message: response.Message})
	default:
		return nil, errors.New("invalid prompt-preview browser response")
	}
}

var facadeMessages = map[string]string{
	"input_limit_exceeded":    "Exact-preview input exceeded its safe limit.",
	"response_limit_exceeded": "Exact-preview response exceeded its safe limit.",
	"internal_error":          "Exact preview is temporarily unavailable.",
}
