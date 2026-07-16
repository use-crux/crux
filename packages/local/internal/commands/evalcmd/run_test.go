package evalcmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConsumeStreamPreservesBindingExitCodes(t *testing.T) {
	for _, test := range []struct {
		name string
		in   string
		want int
	}{
		{name: "pass", in: `{"type":"run:done","exitCode":0}` + "\n", want: 0},
		{name: "blocking failure", in: `{"type":"run:done","exitCode":1}` + "\n", want: 1},
		{name: "discovery", in: `{"type":"collect:done","evals":[],"errors":[{"message":"duplicate Eval id"}]}` + "\n", want: 2},
		{name: "admission", in: `{"type":"error","message":"offline evidence missing"}` + "\n", want: 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			var out bytes.Buffer
			got, err := consumeStream(&out, strings.NewReader(test.in))
			if err != nil || got != test.want {
				t.Fatalf("consumeStream = (%d, %v), want (%d, nil)", got, err, test.want)
			}
		})
	}
}

func TestEvalListStreamGolden(t *testing.T) {
	input := `{"type":"collect:done","evals":[{"id":"support","sourceKey":{"relativeFile":"evals/support.eval.ts"},"cases":[{},{}]}],"errors":[]}` + "\n" +
		`{"type":"run:done","exitCode":0}` + "\n"
	var out bytes.Buffer
	exitCode, err := consumeStream(&out, strings.NewReader(input))
	if err != nil || exitCode != 0 {
		t.Fatalf("consumeStream = (%d, %v)", exitCode, err)
	}
	want, err := os.ReadFile(filepath.Join("testdata", "cli-goldens", "eval-list.golden"))
	if err != nil {
		t.Fatal(err)
	}
	if out.String() != string(want) {
		t.Fatalf("eval list golden mismatch\n--- want\n%s\n--- got\n%s", want, out.String())
	}
}

func TestRunFlagValidationHappensBeforeWorkerStart(t *testing.T) {
	if err := validateRunOptions(runOptions{watch: true, plan: true}, false); err == nil {
		t.Fatal("--watch --plan should fail")
	}
	if err := validateRunOptions(runOptions{maxCost: -1}, true); err == nil {
		t.Fatal("negative --max-cost should fail")
	}
}
