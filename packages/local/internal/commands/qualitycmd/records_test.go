package qualitycmd

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

// TestQualityRunJSONFlagIsBool pins the spec 03 §2 flag contract: `--json` is a
// bool (like every other quality subcommand), and `--json-out` is the string
// path flag. The old string `--json` with NoOptDefVal="-" is gone.
func TestQualityRunJSONFlagIsBool(t *testing.T) {
	cmd := NewQualityRunCmd(&cli.Factory{})

	jsonFlag := cmd.Flags().Lookup("json")
	if jsonFlag == nil {
		t.Fatal("quality run is missing the --json flag")
	}
	if jsonFlag.Value.Type() != "bool" {
		t.Errorf("--json should be a bool, got %q", jsonFlag.Value.Type())
	}
	// A bool flag legitimately defaults NoOptDefVal to "true"; what must be gone
	// is the old string-path sentinel "-".
	if jsonFlag.NoOptDefVal == "-" {
		t.Errorf("--json still carries the legacy string-path NoOptDefVal %q", jsonFlag.NoOptDefVal)
	}

	jsonOutFlag := cmd.Flags().Lookup("json-out")
	if jsonOutFlag == nil {
		t.Fatal("quality run is missing the --json-out flag")
	}
	if jsonOutFlag.Value.Type() != "string" {
		t.Errorf("--json-out should be a string path, got %q", jsonOutFlag.Value.Type())
	}
}

func TestQualityRunRegistersAgentRerunFlags(t *testing.T) {
	cmd := NewQualityRunCmd(&cli.Factory{})
	for _, name := range []string{"failed", "sample", "seed", "max-cost", "changed-since"} {
		if cmd.Flags().Lookup(name) == nil {
			t.Fatalf("quality run is missing --%s", name)
		}
	}
}

func TestQualityRunSampleRequiresSeed(t *testing.T) {
	err := validateQualityRunOpts(&qualityRunOpts{sample: 2})
	if err == nil || !strings.Contains(err.Error(), "--sample requires --seed") {
		t.Fatalf("validateQualityRunOpts error = %v", err)
	}
}

// recordFixture writes a minimal experiment record file and returns its path.
func recordFixture(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestWriteQualityRecordsToWriterEmitsJSONArray(t *testing.T) {
	path := recordFixture(t, "exp.json", `{"experimentId":"exp_1","passed":true}`)

	var buf bytes.Buffer
	if err := writeQualityRecordsToWriter(&buf, []string{path}); err != nil {
		t.Fatalf("writeQualityRecordsToWriter: %v", err)
	}
	out := buf.String()
	if strings.Contains(out, "\x1b") {
		t.Errorf("--json output must be escape-free, got %q", out)
	}

	var records []map[string]any
	if err := json.Unmarshal([]byte(out), &records); err != nil {
		t.Fatalf("--json stdout must parse as a JSON array: %v\n%s", err, out)
	}
	if len(records) != 1 || records[0]["experimentId"] != "exp_1" {
		t.Errorf("decoded records = %+v", records)
	}
}

func TestWriteQualityRecordsToFileWritesArray(t *testing.T) {
	src := recordFixture(t, "exp.json", `{"experimentId":"exp_2","passed":false}`)
	dst := filepath.Join(t.TempDir(), "out.json")

	if err := writeQualityRecordsToFile(dst, []string{src}); err != nil {
		t.Fatalf("writeQualityRecordsToFile: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	if err := json.Unmarshal(data, &records); err != nil {
		t.Fatalf("--json-out file must parse as a JSON array: %v\n%s", err, data)
	}
	if len(records) != 1 || records[0]["experimentId"] != "exp_2" {
		t.Errorf("decoded records = %+v", records)
	}
}
