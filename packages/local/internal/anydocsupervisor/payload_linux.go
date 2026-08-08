//go:build linux

package anydocsupervisor

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

type wirePayload struct {
	Kind        string          `json:"kind"`
	Native      json.RawMessage `json:"native"`
	Core        json.RawMessage `json:"core"`
	Assets      []wireAsset     `json:"assets"`
	Diagnostics []string        `json:"diagnostics"`
}

type wireNative struct {
	Kind     string          `json:"kind"`
	Source   json.RawMessage `json:"source"`
	Observed json.RawMessage `json:"observed"`
	Facts    json.RawMessage `json:"facts"`
}

type wireCore struct {
	SchemaVersion int                  `json:"schemaVersion"`
	Source        json.RawMessage      `json:"source"`
	Producer      json.RawMessage      `json:"producer"`
	Metadata      json.RawMessage      `json:"metadata"`
	Blocks        json.RawMessage      `json:"blocks"`
	Assets        []wireProjectedAsset `json:"assets"`
	Diagnostics   json.RawMessage      `json:"diagnostics"`
}

type wireProjectedAsset struct {
	ID         string          `json:"id"`
	MediaType  string          `json:"mediaType"`
	SHA256     string          `json:"sha256"`
	ByteLength int64           `json:"byteLength"`
	Coordinate json.RawMessage `json:"coordinate"`
	Producer   json.RawMessage `json:"producer"`
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
	if err := decodeStrict(payload, &wire); err != nil || wire.Kind != "anydoc-admission-v2" || len(wire.Native) == 0 || len(wire.Core) == 0 || wire.Assets == nil || wire.Diagnostics == nil {
		return ResultAccounting{}, errors.New("invalid wire payload")
	}

	var native wireNative
	var core wireCore
	if err := decodeStrict(wire.Native, &native); err != nil || native.Kind != "anydoc-native-v2" || !jsonArray(native.Facts) || len(native.Source) == 0 || len(native.Observed) == 0 {
		return ResultAccounting{}, errors.New("invalid native facts")
	}
	if err := decodeStrict(wire.Core, &core); err != nil || core.SchemaVersion != 2 || !jsonArray(core.Blocks) || !jsonArray(core.Diagnostics) || core.Assets == nil || len(core.Assets) != len(wire.Assets) {
		return ResultAccounting{}, errors.New("invalid core projection")
	}
	if err := validateBoundedJSON(wire.Native, request.Limits); err != nil {
		return ResultAccounting{}, errors.New("unbounded wire payload")
	}
	if err := validateBoundedJSON(wire.Core, request.Limits); err != nil {
		return ResultAccounting{}, errors.New("unbounded wire payload")
	}

	assetBytes := int64(0)
	for index, asset := range wire.Assets {
		projected := core.Assets[index]
		assetSHA := fmt.Sprintf("%x", sha256.Sum256(asset.Data))
		if asset.ID < 0 || asset.MediaType == "" || asset.OriginPart == "" || projected.MediaType != asset.MediaType || projected.ByteLength != int64(len(asset.Data)) || projected.SHA256 != assetSHA || projected.ID == "" {
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
		RawBytes:        int64(len(wire.Native) + len(wire.Core) + len(`{"native":,"core":}`)),
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
