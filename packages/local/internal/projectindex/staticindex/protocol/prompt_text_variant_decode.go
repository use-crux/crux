package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

func decodeClosedPromptTextVariant(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("trailing JSON data")
		}
		return err
	}
	return nil
}

func promptTextVariantKind(data []byte) (string, error) {
	var header struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		return "", err
	}
	if header.Kind == "" {
		return "", fmt.Errorf("missing PromptText variant kind")
	}
	return header.Kind, nil
}

func requiredPromptTextField[T any](value *T, name string) (T, error) {
	if value == nil {
		var zero T
		return zero, fmt.Errorf("missing required PromptText field %q", name)
	}
	return *value, nil
}

func decodeRequiredNullable[T any](raw json.RawMessage, name string) (*T, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("missing required PromptText field %q", name)
	}
	var value *T
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return value, nil
}
