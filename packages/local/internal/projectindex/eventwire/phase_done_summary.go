package eventwire

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// UnmarshalJSON requires factCount without making additive summary metadata
// strict. This keeps a required zero distinct from omission or explicit null.
func (s *PhaseDoneSummary) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("decode phase:done summary: %w", err)
	}
	factCount, present := fields["factCount"]
	if !present || bytes.Equal(bytes.TrimSpace(factCount), []byte("null")) {
		return fmt.Errorf("phase:done summary requires non-null factCount")
	}

	type phaseDoneSummaryAlias PhaseDoneSummary
	var decoded phaseDoneSummaryAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode phase:done summary: %w", err)
	}
	*s = PhaseDoneSummary(decoded)
	return nil
}
