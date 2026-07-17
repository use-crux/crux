package review

import (
	"context"
	"encoding/json"
)

type Submission struct {
	RunID      string          `json:"runId"`
	Rating     string          `json:"rating"`
	Comment    string          `json:"comment,omitempty"`
	Correction json.RawMessage `json:"correction,omitempty"`
	DedupeKey  string          `json:"dedupeKey,omitempty"`
}

type Receipt struct {
	FeedbackID string `json:"feedbackId"`
	ReviewID   string `json:"reviewId"`
	Revision   int    `json:"revision"`
	Status     string `json:"status"`
	AcceptedAt string `json:"acceptedAt"`
}

type Projection struct {
	ReviewID      string          `json:"reviewId"`
	RunID         string          `json:"runId"`
	Status        string          `json:"status"`
	Rating        string          `json:"rating"`
	Comment       string          `json:"comment,omitempty"`
	Correction    json.RawMessage `json:"correction,omitempty"`
	Revision      int             `json:"revision"`
	ContextStatus string          `json:"contextStatus"`
	Context       json.RawMessage `json:"context,omitempty"`
	TargetEvalID  string          `json:"targetEvalId,omitempty"`
	TargetCaseID  string          `json:"targetCaseId,omitempty"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt"`
}

type Action struct {
	ReviewID     string `json:"reviewId"`
	Type         string `json:"type"`
	TargetEvalID string `json:"targetEvalId,omitempty"`
	TargetCaseID string `json:"targetCaseId,omitempty"`
}

type ActionRecord struct {
	ActionID     string `json:"actionId"`
	ReviewID     string `json:"reviewId"`
	Sequence     int    `json:"sequence"`
	Type         string `json:"type"`
	TargetEvalID string `json:"targetEvalId,omitempty"`
	TargetCaseID string `json:"targetCaseId,omitempty"`
	CreatedAt    string `json:"createdAt"`
}

type AddCaseRequest struct {
	EvalID             string          `json:"evalId"`
	ID                 string          `json:"id"`
	Input              json.RawMessage `json:"input"`
	Call               json.RawMessage `json:"call,omitempty"`
	Name               string          `json:"name,omitempty"`
	Tags               []string        `json:"tags,omitempty"`
	ReviewID           string          `json:"reviewId"`
	RunID              string          `json:"runId"`
	CorrectionProposal json.RawMessage `json:"correctionProposal,omitempty"`
	SaveCorrection     bool            `json:"saveCorrection,omitempty"`
	RepositoryWritable bool            `json:"repositoryWritable"`
}

type AddCaseResult struct {
	Status              string `json:"status"`
	CaseID              string `json:"caseId"`
	Path                string `json:"path"`
	Row                 string `json:"row"`
	UnvalidatedExpected bool   `json:"unvalidatedExpected"`
	Existing            string `json:"existing,omitempty"`
}

// RepositoryWriter validates and writes Review Cases through project-local Core.
type RepositoryWriter interface {
	AddReviewCase(context.Context, AddCaseRequest) (AddCaseResult, error)
}

type ContextSnapshot struct {
	RunID         string          `json:"runId"`
	Name          string          `json:"name,omitempty"`
	RootPrimitive string          `json:"rootPrimitive,omitempty"`
	Status        string          `json:"status,omitempty"`
	StartedAt     string          `json:"startedAt,omitempty"`
	EndedAt       string          `json:"endedAt,omitempty"`
	Model         string          `json:"model,omitempty"`
	Provider      string          `json:"provider,omitempty"`
	PromptID      string          `json:"promptId,omitempty"`
	Input         json.RawMessage `json:"input,omitempty"`
	Output        json.RawMessage `json:"output,omitempty"`
}

type SubmissionRecord struct {
	FeedbackID string          `json:"feedbackId"`
	ReviewID   string          `json:"reviewId"`
	Revision   int             `json:"revision"`
	Rating     string          `json:"rating"`
	Comment    string          `json:"comment,omitempty"`
	Correction json.RawMessage `json:"correction,omitempty"`
	AcceptedAt string          `json:"acceptedAt"`
}

type Detail struct {
	Projection  Projection         `json:"projection"`
	Submissions []SubmissionRecord `json:"submissions"`
	Actions     []ActionRecord     `json:"actions"`
}
