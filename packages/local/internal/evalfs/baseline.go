package evalfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
)

// Baseline contains the known committed V3 identity and exact additive bytes.
type Baseline struct {
	SchemaVersion            int             `json:"schemaVersion"`
	BaselineFingerprintEpoch int             `json:"baselineFingerprintEpoch"`
	BaselineID               string          `json:"baselineId"`
	EvalID                   string          `json:"evalId"`
	RunID                    string          `json:"runId"`
	SelectedArm              string          `json:"selectedArm"`
	SnapshotFingerprint      string          `json:"snapshotFingerprint"`
	Raw                      json.RawMessage `json:"-"`
}

// ParseBaseline validates the known V3/epoch envelope and preserves all bytes.
func ParseBaseline(raw []byte) (Baseline, error) {
	var baseline Baseline
	if err := json.Unmarshal(raw, &baseline); err != nil {
		return Baseline{}, err
	}
	if baseline.SchemaVersion != 3 || baseline.BaselineFingerprintEpoch != 2 {
		return Baseline{}, fmt.Errorf("expected Eval Baseline schemaVersion 3 and fingerprint epoch 2")
	}
	if baseline.BaselineID == "" || baseline.EvalID == "" || baseline.RunID == "" ||
		baseline.SelectedArm == "" || baseline.SnapshotFingerprint == "" {
		return Baseline{}, fmt.Errorf("Eval Baseline identity fields are required")
	}
	var material map[string]any
	if err := json.Unmarshal(raw, &material); err != nil {
		return Baseline{}, err
	}
	delete(material, "snapshotFingerprint")
	var canonical bytes.Buffer
	encoder := json.NewEncoder(&canonical)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(material); err != nil {
		return Baseline{}, err
	}
	digest := sha256.Sum256(bytes.TrimSuffix(canonical.Bytes(), []byte("\n")))
	if fmt.Sprintf("%x", digest) != baseline.SnapshotFingerprint {
		return Baseline{}, fmt.Errorf("Eval Baseline snapshot fingerprint mismatch")
	}
	baseline.Raw = bytes.Clone(raw)
	return baseline, nil
}
