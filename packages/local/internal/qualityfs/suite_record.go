package qualityfs

type Suite struct {
	Tag              string      `json:"_tag"`
	SuiteID          string      `json:"suiteId"`
	ID               string      `json:"id,omitempty"`
	Name             string      `json:"name,omitempty"`
	Version          string      `json:"version,omitempty"`
	Source           string      `json:"source,omitempty"`
	Path             string      `json:"path,omitempty"`
	CaseCount        int         `json:"caseCount"`
	Tags             []string    `json:"tags,omitempty"`
	Scorers          []string    `json:"scorers,omitempty"`
	LastExperimentID string      `json:"lastExperimentId,omitempty"`
	LastRunAt        string      `json:"lastRunAt,omitempty"`
	LastPassRate     *float64    `json:"lastPassRate,omitempty"`
	State            string      `json:"state"`
	Cases            []SuiteCase `json:"cases"`
}

type SuiteCase struct {
	CaseID              string           `json:"caseId"`
	ID                  string           `json:"id,omitempty"`
	Name                string           `json:"name,omitempty"`
	Input               any              `json:"input,omitempty"`
	Expected            any              `json:"expected,omitempty"`
	Tags                []string         `json:"tags,omitempty"`
	Metadata            map[string]any   `json:"metadata,omitempty"`
	Origin              any              `json:"origin,omitempty"`
	LastRunStatus       string           `json:"lastRunStatus,omitempty"`
	LastRunExperimentID string           `json:"lastRunExperimentId,omitempty"`
	LastRunAt           string           `json:"lastRunAt,omitempty"`
	Assertions          []SuiteAssertion `json:"assertions,omitempty"`
	FeedbackRating      string           `json:"feedbackRating,omitempty"`
}

type SuiteAssertion struct {
	Op       string `json:"op"`
	Arg      string `json:"arg"`
	LastPass *bool  `json:"lastPass,omitempty"`
}
