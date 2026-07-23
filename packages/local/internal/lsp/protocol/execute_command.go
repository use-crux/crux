package protocol

// ExecuteCommandParams identifies a command advertised by the server and its
// JSON-compatible arguments.
type ExecuteCommandParams struct {
	Command   string `json:"command"`
	Arguments []any  `json:"arguments,omitempty"`
}

// ExecuteCommandResult reports a completed fix process. A non-zero exit is a
// command result; malformed, stale, and concurrent requests are protocol errors.
type ExecuteCommandResult struct {
	OK         bool   `json:"ok"`
	ExitCode   int    `json:"exitCode"`
	DurationMS int64  `json:"durationMs"`
	StderrTail string `json:"stderrTail"`
}
