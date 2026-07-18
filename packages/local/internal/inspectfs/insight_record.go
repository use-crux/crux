package inspectfs

type InsightStatus struct {
	Tag                 string  `json:"_tag"`
	InsightID           string  `json:"insightId"`
	Status              string  `json:"status"`
	Note                *string `json:"note,omitempty"`
	UpdatedAt           string  `json:"updatedAt"`
	ResolvedAt          string  `json:"resolvedAt,omitempty"`
	ResolvedOccurrences int     `json:"resolvedOccurrences,omitempty"`
}

type InsightSilencePattern struct {
	Title    string `json:"title"`
	TargetID string `json:"targetId,omitempty"`
}

type InsightSilence struct {
	Tag       string                `json:"_tag"`
	ID        string                `json:"id"`
	Pattern   InsightSilencePattern `json:"pattern"`
	Note      *string               `json:"note,omitempty"`
	CreatedAt string                `json:"createdAt"`
	DeletedAt string                `json:"deletedAt,omitempty"`
}
