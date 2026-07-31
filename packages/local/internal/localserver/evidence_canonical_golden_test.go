package localserver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func assertCanonicalEvidenceGolden(
	t *testing.T,
	actual observability.EvidenceInspectResult,
) {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve canonical evidence fixture path")
	}
	fixturePath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"../../../devtools/ui/src/features/run-detail/evidence/fixtures/",
		"canonical-restart-read-model.json",
	))
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := decodeCanonicalEvidenceGolden(raw)
	if err != nil {
		t.Fatal(err)
	}
	actualJSON, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	expectedJSON, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actualJSON, expectedJSON) {
		t.Fatalf("canonical restart fixture drift\nactual=%s\nexpected=%s",
			actualJSON, expectedJSON)
	}
}

func decodeCanonicalEvidenceGolden(
	raw []byte,
) (observability.EvidenceInspectResult, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var expected observability.EvidenceInspectResult
	if err := decoder.Decode(&expected); err != nil {
		return expected, fmt.Errorf("decode canonical evidence fixture: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return expected, fmt.Errorf("decode canonical evidence fixture: trailing data")
	}
	return expected, nil
}

func TestCanonicalEvidenceGoldenRejectsUnknownFields(t *testing.T) {
	if _, err := decodeCanonicalEvidenceGolden([]byte(
		`{"subject":{"kind":"execution","id":"run_1"},"roles":{},` +
			`"futureField":true}`,
	)); err == nil {
		t.Fatal("unknown fixture field was accepted")
	}
}
