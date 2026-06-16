package domain

import "fmt"

// ExitError signals that the CLI should terminate with a specific exit code.
// Commands return this instead of calling os.Exit directly, allowing main to
// handle cleanup and defer statements before exiting. Check for it with
// errors.As in the top-level error handler.
type ExitError struct{ Code int }

// Error implements the error interface.
func (e ExitError) Error() string { return fmt.Sprintf("exit %d", e.Code) }
