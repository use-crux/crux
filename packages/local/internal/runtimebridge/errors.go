package runtimebridge

import (
	"encoding/json"
	"errors"
	"reflect"
)

type CommandExecutionError struct {
	Code    string
	Message string
	Details json.RawMessage
	Cause   error
}

func NewCommandExecutionError(code, message string, details json.RawMessage, cause error) *CommandExecutionError {
	if code == "" {
		code = "runtime_error"
	}
	if message == "" && cause != nil {
		message = cause.Error()
	}
	if message == "" {
		message = "Runtime bridge command failed"
	}
	return &CommandExecutionError{
		Code:    code,
		Message: message,
		Details: cloneRawMessage(details),
		Cause:   cause,
	}
}

func (e *CommandExecutionError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *CommandExecutionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func CommandErrorFromError(commandID string, err error, fallbackCode string) CommandError {
	var execErr *CommandExecutionError
	code := fallbackCode
	message := "Runtime bridge command failed"
	var details json.RawMessage
	if errors.As(err, &execErr) {
		code = firstNonEmptyString(execErr.Code, code)
		message = firstNonEmptyString(execErr.Message, message)
		details = cloneRawMessage(execErr.Details)
	} else if err != nil {
		message = err.Error()
	}
	if code == "" {
		code = "runtime_error"
	}
	if len(details) == 0 {
		details = defaultCommandErrorDetails(err, code, message)
	} else {
		details = mergeCommandErrorDetails(details, code, message)
	}
	return CommandError{
		Type:      "command.error",
		CommandID: commandID,
		Error: CommandErrorBody{
			Code:    code,
			Message: message,
			Details: details,
		},
	}
}

func defaultCommandErrorDetails(err error, code, message string) json.RawMessage {
	name := "Error"
	if err != nil {
		name = errorTypeName(err)
	}
	raw, _ := json.Marshal(map[string]any{
		"thrown":    "error",
		"phase":     "runtime_bridge.command",
		"errorKind": code,
		"summary": map[string]any{
			"message":  message,
			"name":     name,
			"category": code,
		},
	})
	return raw
}

func mergeCommandErrorDetails(details json.RawMessage, code, message string) json.RawMessage {
	var obj map[string]any
	if err := json.Unmarshal(details, &obj); err != nil || obj == nil {
		raw, _ := json.Marshal(map[string]any{
			"thrown":    "error",
			"phase":     "runtime_bridge.command",
			"errorKind": code,
			"summary": map[string]any{
				"message":  message,
				"category": code,
			},
			"raw": string(details),
		})
		return raw
	}
	if _, ok := obj["phase"]; !ok {
		obj["phase"] = "runtime_bridge.command"
	}
	if _, ok := obj["errorKind"]; !ok {
		obj["errorKind"] = code
	}
	summary, _ := obj["summary"].(map[string]any)
	if summary == nil {
		summary = map[string]any{}
		obj["summary"] = summary
	}
	if _, ok := summary["message"]; !ok {
		summary["message"] = message
	}
	if _, ok := summary["category"]; !ok {
		summary["category"] = code
	}
	raw, _ := json.Marshal(obj)
	return raw
}

func errorTypeName(err error) string {
	t := reflect.TypeOf(err)
	if t == nil {
		return "Error"
	}
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Name() == "" {
		return "Error"
	}
	return t.Name()
}

func cloneRawMessage(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	out := make([]byte, len(raw))
	copy(out, raw)
	return out
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
