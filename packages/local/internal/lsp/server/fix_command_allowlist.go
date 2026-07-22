package server

import (
	"slices"
	"strings"
)

// allowedRuntimeGenerateCommand is the complete P2 command allowlist. Adding
// another command is a protocol decision, not an execution-time fallback.
const allowedRuntimeGenerateCommand = "crux runtime generate"

const runFixCommand = "crux.runFix"

const forbiddenFixCommandCharacters = "|&;<>$\"'`(){}[]*?~#"

// allowedFixCommand validates command text owned by the Project Index and
// returns arguments for the current Crux executable. It never interprets shell
// quoting or returns the executable token supplied by index data.
func allowedFixCommand(command string) ([]string, bool) {
	if strings.ContainsAny(command, forbiddenFixCommandCharacters) {
		return nil, false
	}
	fields := strings.Fields(command)
	allowed := strings.Fields(allowedRuntimeGenerateCommand)
	if !slices.Equal(fields, allowed) {
		return nil, false
	}
	return append([]string(nil), fields[1:]...), true
}

func runtimeGenerateArguments(scopeRoot string) []string {
	return []string{"runtime", "generate", "--cwd", scopeRoot, "--json"}
}
