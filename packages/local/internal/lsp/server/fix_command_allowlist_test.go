package server

import (
	"reflect"
	"testing"
)

func TestAllowedFixCommandTable(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name    string
		command string
		want    []string
	}{
		{name: "runtime generate", command: "crux runtime generate", want: []string{"runtime", "generate"}},
		{name: "leading and repeated whitespace", command: "  crux\t runtime   generate\n", want: []string{"runtime", "generate"}},
		{name: "empty"},
		{name: "wrong executable", command: "node runtime generate"},
		{name: "unknown command", command: "crux runtime inspect"},
		{name: "extra argument", command: "crux runtime generate --force"},
		{name: "shell pipe", command: "crux runtime generate | cat"},
		{name: "shell substitution", command: "crux runtime generate $(touch nope)"},
		{name: "quoted token", command: `crux runtime "generate"`},
		{name: "glob", command: "crux runtime generat?"},
		{name: "comment", command: "crux runtime generate # later"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, ok := allowedFixCommand(test.command)
			if ok != (test.want != nil) || !reflect.DeepEqual(got, test.want) {
				t.Fatalf("allowedFixCommand(%q) = (%v, %v), want (%v, %v)", test.command, got, ok, test.want, test.want != nil)
			}
		})
	}
}

func TestRuntimeGenerateArgumentsMatchGolden(t *testing.T) {
	t.Parallel()

	got := runtimeGenerateArguments("/repo/project")
	want := []string{"runtime", "generate", "--cwd", "/repo/project", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("runtime generate argv = %v, want %v", got, want)
	}
}
