package store

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// UnmarshalJSON preserves the outer diagnostic's additive compatibility while
// rejecting an explicitly null PromptText evidence value.
func (d *IndexDiagnostic) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if evidence, present := fields["evidence"]; present &&
		bytes.Equal(bytes.TrimSpace(evidence), []byte("null")) {
		return fmt.Errorf("IndexDiagnostic evidence cannot be null")
	}

	type diagnosticAlias IndexDiagnostic
	var decoded diagnosticAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*d = IndexDiagnostic(decoded)
	return nil
}
