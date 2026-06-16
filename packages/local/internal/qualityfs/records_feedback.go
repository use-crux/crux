package qualityfs

type Feedback struct {
	Tag          string         `json:"_tag"`
	ID           string         `json:"id"`
	QualityID    string         `json:"qualityId"`
	CreatedAt    string         `json:"createdAt"`
	Status       string         `json:"status"`
	TraceID      *string        `json:"traceId,omitempty"`
	ExperimentID *string        `json:"experimentId,omitempty"`
	CaseID       *string        `json:"caseId,omitempty"`
	Rating       *int           `json:"rating,omitempty"`
	Comment      *string        `json:"comment,omitempty"`
	Expected     map[string]any `json:"expected,omitempty"`
	Tags         []string       `json:"tags,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

type FeedbackAnnotation struct {
	Tag        string         `json:"_tag"`
	ID         string         `json:"id"`
	QualityID  string         `json:"qualityId"`
	FeedbackID string         `json:"feedbackId"`
	CreatedAt  string         `json:"createdAt"`
	Status     string         `json:"status,omitempty"`
	Note       *string        `json:"note,omitempty"`
	Expected   map[string]any `json:"expected,omitempty"`
	Tags       []string       `json:"tags,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

type MemoryProposal struct {
	Tag        string         `json:"_tag"`
	ID         string         `json:"id"`
	QualityID  string         `json:"qualityId"`
	FeedbackID string         `json:"feedbackId"`
	CreatedAt  string         `json:"createdAt"`
	Status     string         `json:"status"`
	MemoryID   *string        `json:"memoryId,omitempty"`
	MemoryKind *string        `json:"memoryKind,omitempty"`
	Proposal   map[string]any `json:"proposal"`
	Reason     *string        `json:"reason,omitempty"`
	Tags       []string       `json:"tags,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}
