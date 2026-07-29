package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// PromptTextPreviewExactLinkParams requests the canonical Local owner URL for
// one exact open-buffer position.
type PromptTextPreviewExactLinkParams struct {
	URI        DocumentURI `json:"uri"`
	OpenEpoch  uint64      `json:"openEpoch"`
	Version    int64       `json:"version"`
	SourceHash string      `json:"sourceHash"`
	Position   Position    `json:"position"`
}

func (p *PromptTextPreviewExactLinkParams) UnmarshalJSON(data []byte) error {
	if err := rejectPromptTextExactDuplicateKeys(data); err != nil {
		return err
	}
	var value struct {
		URI        *DocumentURI `json:"uri"`
		OpenEpoch  *uint64      `json:"openEpoch"`
		Version    *int64       `json:"version"`
		SourceHash *string      `json:"sourceHash"`
		Position   *struct {
			Line      *uint32 `json:"line"`
			Character *uint32 `json:"character"`
		} `json:"position"`
	}
	if err := decodePromptTextPreviewClosed(data, &value); err != nil {
		return err
	}
	if value.URI == nil || value.OpenEpoch == nil || value.Version == nil ||
		value.SourceHash == nil || value.Position == nil ||
		value.Position.Line == nil || value.Position.Character == nil {
		return errors.New("incomplete PromptText exact-preview link params")
	}
	*p = PromptTextPreviewExactLinkParams{
		URI: *value.URI, OpenEpoch: *value.OpenEpoch, Version: *value.Version,
		SourceHash: *value.SourceHash,
		Position: Position{
			Line: *value.Position.Line, Character: *value.Position.Character,
		},
	}
	return nil
}

type PromptTextPreviewExactLinkKind string

const (
	PromptTextPreviewExactLinkReady       PromptTextPreviewExactLinkKind = "ready"
	PromptTextPreviewExactLinkStaticOnly  PromptTextPreviewExactLinkKind = "static-only"
	PromptTextPreviewExactLinkUnavailable PromptTextPreviewExactLinkKind = "unavailable"
)

type PromptTextPreviewExactLinkReadyResult struct {
	Kind PromptTextPreviewExactLinkKind `json:"kind"`
	URL  string                         `json:"url"`
}

type PromptTextPreviewExactLinkStaticResult struct {
	Kind    PromptTextPreviewExactLinkKind `json:"kind"`
	Reason  string                         `json:"reason"`
	Message string                         `json:"message"`
}

type PromptTextPreviewExactLinkUnavailableResult struct {
	Kind    PromptTextPreviewExactLinkKind `json:"kind"`
	Reason  string                         `json:"reason"`
	Message string                         `json:"message"`
}

func rejectPromptTextExactDuplicateKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, container := token.(json.Delim)
		if !container {
			return nil
		}
		switch delimiter {
		case '{':
			seen := map[string]struct{}{}
			for decoder.More() {
				token, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := token.(string)
				if !ok {
					return errors.New("invalid object key")
				}
				if _, duplicate := seen[key]; duplicate {
					return fmt.Errorf("duplicate object key %q", key)
				}
				seen[key] = struct{}{}
				if err := walk(); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := walk(); err != nil {
					return err
				}
			}
		}
		_, err = decoder.Token()
		return err
	}
	if err := walk(); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}
