package qualityfs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPutWritesGoldenSuiteBytes(t *testing.T) {
	fs := Open(t.TempDir())

	if _, err := Put(fs, Suite{
		SuiteID: "suite-1",
		Name:    "Main",
		Cases: []SuiteCase{
			{
				CaseID: "case-1",
				Name:   "Case One",
				Input:  map[string]any{"prompt": "hello"},
			},
		},
	}); err != nil {
		t.Fatalf("put suite: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(fs.Dir(), "suites", "suite-1.json"))
	if err != nil {
		t.Fatalf("read suite: %v", err)
	}
	const want = `{
  "_tag": "QualitySuite",
  "suiteId": "suite-1",
  "name": "Main",
  "source": "json",
  "caseCount": 1,
  "state": "pinned",
  "cases": [
    {
      "caseId": "case-1",
      "name": "Case One",
      "input": {
        "prompt": "hello"
      }
    }
  ]
}
`
	if string(content) != want {
		t.Fatalf("suite bytes:\n%s\nwant:\n%s", content, want)
	}
}
