package eventwire

import "fmt"

// WorkerEventError preserves the typed failure fields carried by the V2
// Project Index worker protocol.
type WorkerEventError struct {
	Scope       string
	Message     string
	Code        string
	Remediation string
	Findings    []RuntimeArtifactFinding
}

// RuntimeArtifactFinding is one strictly decoded child of an aggregate
// Runtime artifact generation failure.
type RuntimeArtifactFinding struct {
	Code           string `json:"code"`
	Category       string `json:"category"`
	FeatureKind    string `json:"featureKind,omitempty"`
	FeatureID      string `json:"featureId,omitempty"`
	Arm            string `json:"arm,omitempty"`
	Source         string `json:"source,omitempty"`
	Summary        string `json:"summary"`
	Reason         string `json:"reason"`
	WhatStillWorks string `json:"whatStillWorks,omitempty"`
	Remediation    string `json:"remediation,omitempty"`
	Docs           string `json:"docs,omitempty"`
}

func (e *WorkerEventError) Error() string {
	if e == nil {
		return "project index worker failed"
	}
	if e.Message == "" {
		return fmt.Sprintf("project index worker %s failed", e.Scope)
	}
	return fmt.Sprintf("project index worker %s failed: %s", e.Scope, e.Message)
}
