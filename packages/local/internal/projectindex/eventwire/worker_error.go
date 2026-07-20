package eventwire

import "fmt"

// WorkerEventError preserves the typed failure fields carried by the V2
// Project Index worker protocol.
type WorkerEventError struct {
	Scope       string
	Message     string
	Code        string
	Remediation string
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
