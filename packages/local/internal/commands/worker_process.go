package commands

import (
	"io"
	"log/slog"

	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

// commandWorkerProcess owns the diagnostic boundaries for workers started by
// one-shot commands. Keeping this value scoped prevents concurrent commands
// from replacing the process-wide slog default.
type commandWorkerProcess struct {
	logger *slog.Logger
	stderr io.Writer
}

func newCommandWorkerProcess(streams *output.IO) commandWorkerProcess {
	return newWorkerProcess(streams.Err, startupDebugEnabled(false))
}

func newWorkerProcess(stderr io.Writer, debug bool) commandWorkerProcess {
	loggerOutput := io.Discard
	level := slog.LevelInfo
	if debug {
		loggerOutput = stderr
		level = slog.LevelDebug
	}
	return commandWorkerProcess{
		logger: slog.New(slog.NewTextHandler(loggerOutput, &slog.HandlerOptions{Level: level})),
		stderr: stderr,
	}
}

// newDevServerProcess keeps long-running server warnings and lifecycle logs on
// the command's diagnostic stream. TUI quieting remains an instance-level
// [server.DevServerOptions] concern rather than silently discarding plain-mode
// diagnostics at the command boundary.
func newDevServerProcess(stderr io.Writer, debug bool) commandWorkerProcess {
	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}
	return commandWorkerProcess{
		logger: slog.New(slog.NewTextHandler(stderr, &slog.HandlerOptions{Level: level})),
		stderr: stderr,
	}
}

func (p commandWorkerProcess) options() []workerproc.Option {
	return []workerproc.Option{
		workerproc.WithLogger(p.logger),
		workerproc.WithStderr(p.stderr),
	}
}
