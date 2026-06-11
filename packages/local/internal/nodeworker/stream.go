package nodeworker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
)

const defaultStreamMaxLineBytes = 10 * 1024 * 1024

// OneShot describes a single Node.js worker run that emits NDJSON events.
type OneShot struct {
	Script      Script
	NodeArgs    []string
	Args        []string
	Dir         string
	CommandPath string
	CommandArgs []string
}

// StreamResult captures process-level details for a one-shot worker.
type StreamResult struct {
	Stderr  string
	ExitErr error
}

// Stream spawns a worker once, delivers parseable NDJSON stdout lines to
// onEvent, waits for process exit, and returns captured stderr and exit status.
func Stream(ctx context.Context, run OneShot, onEvent func(json.RawMessage) error) (StreamResult, error) {
	var cmd *exec.Cmd
	if run.CommandPath != "" {
		args := append([]string(nil), run.CommandArgs...)
		args = append(args, run.Args...)
		cmd = exec.Command(run.CommandPath, args...)
	} else {
		nodePath, err := FindNodePath()
		if err != nil {
			return StreamResult{}, fmt.Errorf("node not found: %w", err)
		}
		scriptPath, err := ExtractEmbedded(run.Script.Name, run.Script.Content)
		if err != nil {
			return StreamResult{}, fmt.Errorf("extract %s worker: %w", run.Script.Name, err)
		}

		args := append([]string(nil), run.NodeArgs...)
		args = append(args, scriptPath)
		args = append(args, run.Args...)
		cmd = exec.Command(nodePath, args...)
	}
	if run.Dir != "" {
		cmd.Dir = run.Dir
	}
	configureProcessGroup(cmd)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return StreamResult{}, fmt.Errorf("stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return StreamResult{}, fmt.Errorf("start worker: %w", err)
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			killProcessGroup(cmd)
		case <-done:
		}
	}()
	defer close(done)

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), defaultStreamMaxLineBytes)
	for scanner.Scan() {
		raw := append([]byte(nil), scanner.Bytes()...)
		if !json.Valid(raw) {
			continue
		}
		if err := onEvent(json.RawMessage(raw)); err != nil {
			killProcessGroup(cmd)
			_ = cmd.Wait()
			return StreamResult{Stderr: stderr.String()}, err
		}
	}
	if err := scanner.Err(); err != nil {
		killProcessGroup(cmd)
		_ = cmd.Wait()
		return StreamResult{Stderr: stderr.String()}, fmt.Errorf("read worker output: %w", err)
	}
	exitErr := cmd.Wait()
	result := StreamResult{Stderr: stderr.String(), ExitErr: exitErr}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	return result, nil
}
