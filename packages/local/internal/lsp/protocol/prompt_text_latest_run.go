package protocol

// PromptTextOpenLatestRunLinkParams uses the exact current-document stamp and
// UTF-16 position contract shared by PromptText owner-link requests.
type PromptTextOpenLatestRunLinkParams = PromptTextPreviewExactLinkParams

type PromptTextOpenLatestRunLinkKind string

const (
	PromptTextOpenLatestRunLinkReady       PromptTextOpenLatestRunLinkKind = "ready"
	PromptTextOpenLatestRunLinkUnavailable PromptTextOpenLatestRunLinkKind = "unavailable"
)

type PromptTextOpenLatestRunLinkReadyResult struct {
	Kind PromptTextOpenLatestRunLinkKind `json:"kind"`
	URL  string                          `json:"url"`
}

type PromptTextOpenLatestRunLinkUnavailableResult struct {
	Kind    PromptTextOpenLatestRunLinkKind `json:"kind"`
	Reason  string                          `json:"reason"`
	Message string                          `json:"message"`
}
