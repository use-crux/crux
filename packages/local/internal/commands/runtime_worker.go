package commands

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

const runtimeWorkerProcessExitTimeout = 11 * time.Second

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
	cmd := exec.Command(node, script, root)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = process.stderr
	return superviseRuntimeWorkerProcess(ctx, cmd)
}

func superviseRuntimeWorkerProcess(ctx context.Context, cmd *exec.Cmd) error {
	group, err := workerproc.ConfigureProcessGroup(cmd)
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
		workerproc.SignalProcessGroup(group)
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
		workerproc.KillProcessGroup(group)
		<-done
		return fmt.Errorf("Runtime worker did not stop within %s", runtimeWorkerProcessExitTimeout)
	}
}
