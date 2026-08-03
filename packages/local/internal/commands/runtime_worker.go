package commands

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"time"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

const (
	runtimeWorkerProcessExitTimeout = 11 * time.Second
	runtimeWorkerForceExitTimeout   = time.Second
)

var runtimeWorkerStdinShutdownImport = "data:text/javascript," + url.PathEscape(`
const deliver = () => {
  if (process.listenerCount('SIGTERM') > 0) {
    process.emit('SIGTERM')
    return
  }
  const onListener = (event) => {
    if (event !== 'SIGTERM') return
    process.off('newListener', onListener)
    queueMicrotask(() => process.emit('SIGTERM'))
  }
  process.on('newListener', onListener)
}
process.stdin.resume()
process.stdin.unref?.()
process.stdin.once('end', deliver)
`)

func newRuntimeWorkerCmd(f *cli.Factory, opts *runtimeGenerateOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "worker",
		Short: "Run the generated Runtime program",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			root, err := resolveRuntimeGenerateRoot(opts.cwd)
			if err != nil {
				return err
			}
			return runRuntimeWorkerForCommand(cmd.Context(), root, newCommandWorkerProcess(f.Streams()))
		},
	}
}

func runRuntimeWorkerProcess(ctx context.Context, root string, process commandWorkerProcess) error {
	script, err := assets.ExtractEmbeddedRuntimeWorker()
	if err != nil {
		return err
	}
	node, err := assets.FindNode()
	if err != nil {
		return err
	}
	cmd := newRuntimeWorkerProcessCommand(node, script, root)
	cmd.Stdout = os.Stdout
	cmd.Stderr = process.stderr
	return superviseRuntimeWorkerProcess(ctx, cmd)
}

func superviseRuntimeWorkerProcess(ctx context.Context, cmd *exec.Cmd) error {
	gracefulShutdown, err := prepareRuntimeWorkerShutdown(cmd)
	if err != nil {
		return fmt.Errorf("configure Runtime worker shutdown: %w", err)
	}
	if gracefulShutdown != nil {
		defer func() { _ = gracefulShutdown() }()
	}
	return superviseRuntimeWorkerProcessWithShutdown(ctx, cmd, gracefulShutdown)
}

func superviseRuntimeWorkerProcessWithShutdown(ctx context.Context, cmd *exec.Cmd, gracefulShutdown func() error) error {
	group, err := workerproc.ConfigureProcessGroup(cmd, gracefulShutdown)
	if err != nil {
		return fmt.Errorf("configure Runtime worker process group: %w", err)
	}
	defer workerproc.CloseProcessGroup(group)
	if err := group.Start(); err != nil {
		return fmt.Errorf("start Runtime worker: %w", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		if err := workerproc.SignalProcessGroup(group); err != nil {
			return errors.Join(
				fmt.Errorf("request Runtime worker shutdown: %w", err),
				forceStopRuntimeWorkerProcess(group, done),
			)
		}
	}
	timer := time.NewTimer(runtimeWorkerProcessExitTimeout)
	defer timer.Stop()
	select {
	case err := <-done:
		if err != nil {
			return err
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil
		}
		return ctx.Err()
	case <-timer.C:
		return errors.Join(
			fmt.Errorf("Runtime worker did not stop within %s", runtimeWorkerProcessExitTimeout),
			forceStopRuntimeWorkerProcess(group, done),
		)
	}
}

func forceStopRuntimeWorkerProcess(group *workerproc.ProcessGroup, done <-chan error) error {
	workerproc.KillProcessGroup(group)
	timer := time.NewTimer(runtimeWorkerForceExitTimeout)
	defer timer.Stop()
	select {
	case <-done:
		return nil
	case <-timer.C:
		return fmt.Errorf("Runtime worker did not exit within %s after force stop", runtimeWorkerForceExitTimeout)
	}
}
