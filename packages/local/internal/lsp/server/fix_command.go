package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const fixCommandTimeout = 60 * time.Second
const boundedStderrBytes = 4_096

const (
	staleFixMessage     = "finding no longer present — it may have been fixed"
	busyFixMessage      = "another Crux fix is already running"
	untrustedFixMessage = "workspace is not trusted"
)

type runFixArguments struct {
	ScopeRoot string `json:"scopeRoot"`
	FindingID string `json:"findingId"`
	FixIndex  *int   `json:"fixIndex"`
}

func (s *Server) executeCommand(ctx context.Context, raw json.RawMessage) jsonrpc.HandlerResult {
	arguments, ok := decodeRunFixArguments(raw)
	if !ok {
		return invalidExecuteCommandParams()
	}
	s.mu.Lock()
	trusted := s.trusted
	s.mu.Unlock()
	if !trusted {
		return requestFailed(untrustedFixMessage)
	}

	workspace, ok := s.currentWorkspace().(fixCommandWorkspace)
	if !ok {
		return requestFailed(staleFixMessage)
	}
	finding, ok := workspace.FindingForScope(arguments.ScopeRoot, arguments.FindingID)
	if !ok || *arguments.FixIndex >= len(finding.Fixes) {
		return requestFailed(staleFixMessage)
	}
	fix := finding.Fixes[*arguments.FixIndex]
	if _, ok := allowedFixCommand(fix.Command); !ok {
		return requestFailed(staleFixMessage)
	}
	if !s.beginFix(arguments.ScopeRoot) {
		return requestFailed(busyFixMessage)
	}
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.endFix(arguments.ScopeRoot)
		result := s.runFix(ctx, arguments.ScopeRoot)
		s.notifyFixResult(ctx, result, fix.Command)
		return jsonrpc.HandlerResult{Result: result}
	}}
}

func decodeRunFixArguments(raw json.RawMessage) (runFixArguments, bool) {
	var params struct {
		Command   string            `json:"command"`
		Arguments []json.RawMessage `json:"arguments"`
	}
	if decodeExactJSON(raw, &params) != nil || params.Command != runFixCommand || len(params.Arguments) != 1 {
		return runFixArguments{}, false
	}
	var arguments runFixArguments
	if decodeExactJSON(params.Arguments[0], &arguments) != nil ||
		!filepath.IsAbs(arguments.ScopeRoot) || arguments.FindingID == "" ||
		arguments.FixIndex == nil || *arguments.FixIndex < 0 {
		return runFixArguments{}, false
	}
	return arguments, true
}

func decodeExactJSON(raw json.RawMessage, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}

func (s *Server) beginFix(scopeRoot string) bool {
	s.fixMu.Lock()
	defer s.fixMu.Unlock()
	if _, running := s.fixRunning[scopeRoot]; running {
		return false
	}
	s.fixRunning[scopeRoot] = struct{}{}
	return true
}

func (s *Server) endFix(scopeRoot string) {
	s.fixMu.Lock()
	delete(s.fixRunning, scopeRoot)
	s.fixMu.Unlock()
}

func (s *Server) runFix(ctx context.Context, scopeRoot string) protocol.ExecuteCommandResult {
	started := time.Now()
	commandContext, cancel := context.WithTimeout(ctx, fixCommandTimeout)
	defer cancel()
	executable, executableError := s.options.FixExecutable()
	if executableError != nil {
		return failedFixResult(started, -1, executableError.Error())
	}
	command := exec.CommandContext(commandContext, executable, runtimeGenerateArguments(scopeRoot)...)
	command.Dir = scopeRoot
	stderr := &boundedStderrWriter{}
	command.Stdout = io.Discard
	command.Stderr = stderr
	err := command.Run()
	result := protocol.ExecuteCommandResult{
		OK:         err == nil,
		ExitCode:   commandExitCode(err),
		DurationMS: time.Since(started).Milliseconds(),
		StderrTail: stderr.String(),
	}
	if err != nil && result.StderrTail == "" {
		result.StderrTail = utf16Tail(err.Error(), 500)
	}
	return result
}

type boundedStderrWriter struct {
	buffer []byte
}

func (w *boundedStderrWriter) Write(value []byte) (int, error) {
	written := len(value)
	if len(value) >= boundedStderrBytes {
		w.buffer = append(w.buffer[:0], value[len(value)-boundedStderrBytes:]...)
	} else {
		overflow := len(w.buffer) + len(value) - boundedStderrBytes
		if overflow > 0 {
			copy(w.buffer, w.buffer[overflow:])
			w.buffer = w.buffer[:len(w.buffer)-overflow]
		}
		w.buffer = append(w.buffer, value...)
	}
	for len(w.buffer) > 0 && w.buffer[0]&0xc0 == 0x80 {
		w.buffer = w.buffer[1:]
	}
	return written, nil
}

func (w *boundedStderrWriter) String() string {
	valid := bytes.ToValidUTF8(w.buffer, []byte("�"))
	return utf16Tail(string(valid), 500)
}

func failedFixResult(started time.Time, exitCode int, message string) protocol.ExecuteCommandResult {
	return protocol.ExecuteCommandResult{
		OK: false, ExitCode: exitCode, DurationMS: time.Since(started).Milliseconds(), StderrTail: utf16Tail(message, 500),
	}
}

func commandExitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		return exitError.ExitCode()
	}
	return -1
}

func utf16Tail(value string, limit int) string {
	if limit <= 0 || value == "" {
		return ""
	}
	runes := []rune(value)
	remaining := limit
	start := len(runes)
	for start > 0 {
		units := utf16.RuneLen(runes[start-1])
		if units < 0 {
			units = 1
		}
		if units > remaining {
			break
		}
		remaining -= units
		start--
	}
	return string(runes[start:])
}

func (s *Server) notifyFixResult(ctx context.Context, result protocol.ExecuteCommandResult, command string) {
	messageType := protocol.MessageTypeInfo
	message := "Crux command succeeded: " + command
	if !result.OK {
		messageType = protocol.MessageTypeWarning
		message = "Crux command failed (exit " + strconv.Itoa(result.ExitCode) + "): " + firstLine(result.StderrTail)
	}
	s.Notify(ctx, protocol.MethodShowMessage, protocol.LogMessageParams{Type: messageType, Message: message})
}

func firstLine(value string) string {
	line, _, _ := strings.Cut(value, "\n")
	return strings.TrimSuffix(line, "\r")
}

func invalidExecuteCommandParams() jsonrpc.HandlerResult {
	return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
		Code: protocol.InvalidParamsCode, Message: "Invalid execute command params",
	}}
}

func requestFailed(message string) jsonrpc.HandlerResult {
	return jsonrpc.HandlerResult{Error: &protocol.ResponseError{Code: protocol.RequestFailedCode, Message: message}}
}
