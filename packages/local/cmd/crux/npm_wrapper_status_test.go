package main

import (
	"encoding/json"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestNPMWrapperChildExitStatusPolicy(t *testing.T) {
	module, err := filepath.Abs(filepath.Join("..", "..", "npm", "local", "bin", "child-exit-status.cjs"))
	if err != nil {
		t.Fatalf("resolve child exit status module: %v", err)
	}
	script := `
const childExitStatus = require(process.argv[1])
const cases = [
  { status: 0, signal: null },
  { status: 7, signal: null },
  { status: null, signal: 'SIGINT' },
  { status: null, signal: 'SIGTERM' },
  { status: null, signal: 'SIGKILL' },
]
process.stdout.write(JSON.stringify(cases.map(childExitStatus)))
`
	output, err := exec.Command("node", "-e", script, module).Output()
	if err != nil {
		t.Fatalf("evaluate child exit status policy: %v", err)
	}
	var got []int
	if err := json.Unmarshal(output, &got); err != nil {
		t.Fatalf("decode child exit statuses: %v", err)
	}
	want := []int{0, 7, 130, 143, 1}
	if len(got) != len(want) {
		t.Fatalf("child exit statuses = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("child exit statuses = %v, want %v", got, want)
		}
	}
}
