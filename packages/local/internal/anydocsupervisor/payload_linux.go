//go:build linux

package anydocsupervisor

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

type wirePayload struct {
	Kind        string          `json:"kind"`
	Document    json.RawMessage `json:"document"`
	Assets      []wireAsset     `json:"assets"`
	Diagnostics []string        `json:"diagnostics"`
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
	if err := decodeStrict(payload, &wire); err != nil || wire.Kind != "anydoc-raw-v1" || len(wire.Document) == 0 || wire.Assets == nil || wire.Diagnostics == nil {
		return ResultAccounting{}, errors.New("invalid wire payload")
	}

	var document wireDocument
	if err := decodeStrict(wire.Document, &document); err != nil || !jsonArray(document.Blocks) || !jsonArray(document.Notes) || document.Assets == nil || len(document.Assets) != len(wire.Assets) {
		return ResultAccounting{}, errors.New("invalid wire document")
	}
	if err := validateBoundedJSON(wire.Document, request.Limits); err != nil {
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

	accounting := ResultAccounting{
		SourceBytes:     request.SourceBytes,
		RawBytes:        int64(len(wire.Document)),
		AssetCount:      int64(len(wire.Assets)),
		AssetBytes:      assetBytes,
		DiagnosticCount: int64(len(wire.Diagnostics)),
		DiagnosticBytes: diagnosticBytes,
	}
	accounting.ExpandedBytes = accounting.SourceBytes + accounting.RawBytes + accounting.AssetBytes + accounting.DiagnosticBytes
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

func validateBoundedJSON(raw json.RawMessage, limits JobLimits) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	structuralBudget := limits.ExpandedBytes
	if limits.ResultBytes < structuralBudget {
		structuralBudget = limits.ResultBytes
	}
	nodeCeiling := structuralBudget / 2
	keyCeiling := structuralBudget / 4
	nodes, keys := int64(0), int64(0)
	var visit func(any, int) error
	visit = func(current any, depth int) error {
		nodes++
		if nodes > nodeCeiling || depth > 128 {
			return errors.New("structural limit")
		}
		switch typed := current.(type) {
		case []any:
			for _, child := range typed {
				if err := visit(child, depth+1); err != nil {
					return err
				}
			}
		case map[string]any:
			for _, child := range typed {
				keys++
				if keys > keyCeiling {
					return errors.New("structural limit")
				}
				if err := visit(child, depth+1); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return visit(value, 1)
}
