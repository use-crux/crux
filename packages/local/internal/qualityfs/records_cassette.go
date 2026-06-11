package qualityfs

type Cassette struct {
	Path                 string                      `json:"path"`
	Mode                 string                      `json:"mode,omitempty"`
	Status               string                      `json:"status"`
	Coverage             float64                     `json:"coverage"`
	EntryCount           int                         `json:"entryCount"`
	MissingCount         int                         `json:"missingCount"`
	MismatchCount        int                         `json:"mismatchCount"`
	ProviderCallsAvoided int                         `json:"providerCallsAvoided"`
	Boundaries           map[string]CassetteBoundary `json:"boundaries,omitempty"`
	Matchers             []string                    `json:"matchers,omitempty"`
	Entries              []CassetteEntry             `json:"entries,omitempty"`
	RecordedAt           string                      `json:"recordedAt,omitempty"`
	HitRate              float64                     `json:"hitRate"`
}

type CassetteBoundary struct {
	Count      int `json:"count"`
	Missing    int `json:"missing,omitempty"`
	Mismatched int `json:"mismatched,omitempty"`
}

type CassetteEntry struct {
	ID                string `json:"id,omitempty"`
	CaseID            string `json:"caseId,omitempty"`
	Kind              string `json:"kind,omitempty"`
	TargetID          string `json:"targetId,omitempty"`
	Provider          string `json:"provider,omitempty"`
	Model             string `json:"model,omitempty"`
	Status            string `json:"status"`
	Reason            string `json:"reason,omitempty"`
	RecordedAt        string `json:"recordedAt,omitempty"`
	HitCount          int    `json:"hitCount,omitempty"`
	SignatureExpected string `json:"signatureExpected,omitempty"`
	SignatureCurrent  string `json:"signatureCurrent,omitempty"`
	DriftReason       string `json:"driftReason,omitempty"`
}

type CassetteIssue struct {
	Tag        string `json:"_tag"`
	Path       string `json:"path"`
	EntryID    string `json:"entryId,omitempty"`
	CaseID     string `json:"caseId,omitempty"`
	Kind       string `json:"kind,omitempty"`
	TargetID   string `json:"targetId,omitempty"`
	Provider   string `json:"provider,omitempty"`
	Model      string `json:"model,omitempty"`
	Status     string `json:"status"`
	Reason     string `json:"reason,omitempty"`
	RecordedAt string `json:"recordedAt"`
}
