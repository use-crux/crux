//go:build linux

package anydocsupervisor

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

const (
	payloadSchemaVersion = 1
	payloadNodeCeiling   = 1_000_000
	payloadDepthCeiling  = 128
)

type wirePayload struct {
	SchemaVersion int             `json:"schemaVersion"`
	Document      json.RawMessage `json:"document"`
	Assets        []wireAsset     `json:"assets"`
	Diagnostics   []string        `json:"diagnostics"`
	Native        json.RawMessage `json:"native"`
	Core          json.RawMessage `json:"core"`
}

type wireDocument struct {
	Blocks json.RawMessage     `json:"blocks"`
	Notes  json.RawMessage     `json:"notes"`
	Assets []wireAssetMetadata `json:"assets"`
}

type wireAssetMetadata struct {
	ID         int64  `json:"id"`
	MediaType  string `json:"mediaType"`
	OriginPart string `json:"originPart"`
}

type wireAsset struct {
	wireAssetMetadata
	Data []byte `json:"data"`
}

func recomputePayloadAccounting(request Request, payload []byte) (ResultAccounting, error) {
	var wire wirePayload
	if err := decodeStrict(payload, &wire); err != nil || wire.SchemaVersion != payloadSchemaVersion || len(wire.Document) == 0 || wire.Assets == nil || wire.Diagnostics == nil || len(wire.Native) == 0 || len(wire.Core) == 0 {
		return ResultAccounting{}, errors.New("invalid wire payload")
	}

	var document wireDocument
	if err := decodeStrict(wire.Document, &document); err != nil || !jsonArray(document.Blocks) || !jsonArray(document.Notes) || document.Assets == nil || len(document.Assets) != len(wire.Assets) {
		return ResultAccounting{}, errors.New("invalid wire document")
	}
	if err := validateBoundedJSON(wire.Document); err != nil || validateOptionalProjection(wire.Native) != nil || validateOptionalProjection(wire.Core) != nil {
		return ResultAccounting{}, errors.New("unbounded wire payload")
	}

	assetBytes := int64(0)
	for index, asset := range wire.Assets {
		if asset.wireAssetMetadata != document.Assets[index] || asset.ID < 0 || asset.MediaType == "" || asset.OriginPart == "" {
			return ResultAccounting{}, errors.New("asset metadata mismatch")
		}
		assetBytes += int64(len(asset.Data))
		if assetBytes > request.Limits.AssetBytes {
			return ResultAccounting{}, errors.New("asset limit")
		}
	}

	diagnosticBytes := int64(0)
	for _, diagnostic := range wire.Diagnostics {
		diagnosticBytes += int64(len([]byte(diagnostic)))
		if diagnosticBytes > request.Limits.DiagnosticBytes {
			return ResultAccounting{}, errors.New("diagnostic limit")
		}
	}

	nativeBytes := projectionBytes(wire.Native)
	coreBytes := projectionBytes(wire.Core)
	accounting := ResultAccounting{
		SourceBytes:     request.SourceBytes,
		RawBytes:        int64(len(wire.Document)),
		NativeBytes:     nativeBytes,
		CoreBytes:       coreBytes,
		AssetCount:      int64(len(wire.Assets)),
		AssetBytes:      assetBytes,
		DiagnosticCount: int64(len(wire.Diagnostics)),
		DiagnosticBytes: diagnosticBytes,
	}
	accounting.ExpandedBytes = accounting.SourceBytes + accounting.RawBytes + accounting.NativeBytes + accounting.CoreBytes + accounting.AssetBytes + accounting.DiagnosticBytes
	if accounting.ExpandedBytes > request.Limits.ExpandedBytes || accounting.AssetCount > request.Limits.AssetCount {
		return ResultAccounting{}, errors.New("expanded limit")
	}
	return accounting, nil
}

func decodeStrict(payload []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}

func jsonArray(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) >= 2 && trimmed[0] == '[' && trimmed[len(trimmed)-1] == ']'
}

func validateOptionalProjection(raw json.RawMessage) error {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil
	}
	return validateBoundedJSON(raw)
}

func projectionBytes(raw json.RawMessage) int64 {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return 0
	}
	return int64(len(raw))
}

func validateBoundedJSON(raw json.RawMessage) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	type entry struct {
		value any
		depth int
	}
	stack := []entry{{value: value, depth: 1}}
	nodes := 0
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		nodes++
		if nodes > payloadNodeCeiling || current.depth > payloadDepthCeiling {
			return errors.New("structural limit")
		}
		switch typed := current.value.(type) {
		case []any:
			for _, child := range typed {
				stack = append(stack, entry{value: child, depth: current.depth + 1})
			}
		case map[string]any:
			for _, child := range typed {
				stack = append(stack, entry{value: child, depth: current.depth + 1})
			}
		}
	}
	return nil
}
