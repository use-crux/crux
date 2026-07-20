// Package runtimeartifact owns host-neutral Runtime artifact generation errors.
package runtimeartifact

import "fmt"

// WorkerError preserves the typed failure fields carried by a helper worker.
type WorkerError struct {
	Scope       string
	Message     string
	Code        string
	Remediation string
	Findings    []Finding
}

// Finding is one strictly decoded child of an aggregate generation failure.
type Finding struct {
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

func (e *WorkerError) Error() string {
	if e == nil {
		return "project index worker failed"
	}
	if e.Message == "" {
		return fmt.Sprintf("project index worker %s failed", e.Scope)
	}
	return fmt.Sprintf("project index worker %s failed: %s", e.Scope, e.Message)
}
