package eventwire

import (
	"encoding/json"
	"fmt"
)

func (c *ProjectIndexPatchStreamCollector) handleError(raw json.RawMessage) error {
	var event struct {
		Error struct {
			Message     string `json:"message"`
			Code        string `json:"code,omitempty"`
			Remediation string `json:"remediation,omitempty"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &event); err != nil {
		return fmt.Errorf("decode phase:error: %w", err)
	}
	if event.Error.Message == "" {
		return &WorkerEventError{Scope: "phase", Code: event.Error.Code, Remediation: event.Error.Remediation}
	}
	return &WorkerEventError{Scope: "phase", Message: event.Error.Message, Code: event.Error.Code, Remediation: event.Error.Remediation}
}

func (c *ProjectIndexPatchStreamCollector) openTransaction(id string) (*projectIndexPatchTransaction, error) {
	tx, ok := c.transactions[id]
	if !ok {
		return nil, fmt.Errorf("project index worker transaction %s did not start", id)
	}
	if tx.done {
		return nil, fmt.Errorf("project index worker transaction %s already completed", id)
	}
	return tx, nil
}

func (c *ProjectIndexPatchStreamCollector) validateRoot(root string) error {
	if c.options.Root == "" || c.options.AllowRoot {
		return nil
	}
	if root != c.options.Root {
		return fmt.Errorf("project index worker root = %s, want %s", root, c.options.Root)
	}
	return nil
}

func (c *ProjectIndexPatchStreamCollector) streamByteLimit() int {
	return c.options.MaxBytes
}
