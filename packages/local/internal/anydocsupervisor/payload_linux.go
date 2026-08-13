//go:build linux

package anydocsupervisor

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type wirePayload struct {
	Kind        string      `json:"kind"`
	Native      wireNative  `json:"native"`
	Core        wireCore    `json:"core"`
	Assets      []wireAsset `json:"assets"`
	Diagnostics []string    `json:"diagnostics"`
}

type wireNative struct {
	Kind     string       `json:"kind"`
	Source   wireSource   `json:"source"`
	Observed wireObserved `json:"observed"`
	Facts    []wireFact   `json:"facts"`
}

type wireSource struct {
	DocumentSHA256 string `json:"documentSha256"`
	Format         Format `json:"format"`
}

type wireObserved struct {
	BlockCount int64               `json:"blockCount"`
	NoteCount  int64               `json:"noteCount"`
	Assets     []wireAssetMetadata `json:"assets"`
}

type wireFact struct {
	Kind       string          `json:"kind"`
	FactPath   string          `json:"factPath"`
	Path       *string         `json:"path,omitempty"`
	Coordinate *wireCoordinate `json:"coordinate,omitempty"`
	Producer   *wireProducer   `json:"producer,omitempty"`
	Text       *wireFactText   `json:"text,omitempty"`
	Level      *int64          `json:"level,omitempty"`
	Target     *string         `json:"target,omitempty"`
	Ordered    *bool           `json:"ordered,omitempty"`
	Depth      *int64          `json:"depth,omitempty"`
	Columns    []string        `json:"columns,omitempty"`
	Rows       [][]string      `json:"rows,omitempty"`
	Count      *int64          `json:"count,omitempty"`
	Kinds      []string        `json:"kinds,omitempty"`
}

type wireCore struct {
	SchemaVersion int64                `json:"schemaVersion"`
	Source        wireDocumentSource   `json:"source"`
	Producer      wireProducer         `json:"producer"`
	Metadata      wireMetadata         `json:"metadata"`
	Blocks        []wireBlock          `json:"blocks"`
	Assets        []wireProjectedAsset `json:"assets"`
	Diagnostics   []wireDiagnostic     `json:"diagnostics"`
}

type wireDocumentSource struct {
	DocumentSHA256 string `json:"documentSha256"`
	MediaType      string `json:"mediaType"`
	Format         Format `json:"format"`
}

type wireProducer struct {
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	Version        string `json:"version"`
	AdapterVersion string `json:"adapterVersion"`
}

type wireCoordinate struct {
	Kind           string  `json:"kind"`
	DocumentSHA256 *string `json:"documentSha256,omitempty"`
	Part           *string `json:"part,omitempty"`
	Anchor         *string `json:"anchor,omitempty"`
}

type wireMetadata struct {
	AnydocRelationships string `json:"anydocRelationships"`
}

type wireRelationships struct {
	Notes   []wireRelationshipNote   `json:"notes"`
	Inlines []wireRelationshipInline `json:"inlines"`
}

type wireRelationshipNote struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}

type wireRelationshipInline struct {
	Path   string                  `json:"path"`
	Kind   string                  `json:"kind"`
	Target *wireRelationshipTarget `json:"target,omitempty"`
	Source *wireRelationshipSource `json:"source,omitempty"`
	Anchor *string                 `json:"anchor,omitempty"`
	NoteID *string                 `json:"noteId,omitempty"`
}

type wireRelationshipTarget struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type wireRelationshipSource struct {
	Kind    string  `json:"kind"`
	AssetID *int64  `json:"assetId,omitempty"`
	URL     *string `json:"url,omitempty"`
}

type wireBlock struct {
	ID          string            `json:"id"`
	Kind        string            `json:"kind"`
	Coordinate  wireCoordinate    `json:"coordinate"`
	HeadingPath []string          `json:"headingPath"`
	Producer    wireProducer      `json:"producer"`
	Role        *string           `json:"role,omitempty"`
	Text        *string           `json:"text,omitempty"`
	Inlines     []wireInline      `json:"inlines,omitempty"`
	Level       *int64            `json:"level,omitempty"`
	Ordered     *bool             `json:"ordered,omitempty"`
	Items       []wireListItem    `json:"items,omitempty"`
	Columns     []string          `json:"columns,omitempty"`
	HeaderRows  *int64            `json:"headerRows,omitempty"`
	Rows        [][]wireTableCell `json:"rows,omitempty"`
}

type wireInline struct {
	Kind       string         `json:"kind"`
	Text       string         `json:"text"`
	Target     *string        `json:"target,omitempty"`
	Coordinate wireCoordinate `json:"coordinate"`
	Producer   wireProducer   `json:"producer"`
}

type wireListItem struct {
	ID         string         `json:"id"`
	Coordinate wireCoordinate `json:"coordinate"`
	Producer   wireProducer   `json:"producer"`
	Blocks     []wireBlock    `json:"blocks"`
}

type wireTableCell struct {
	ID             string         `json:"id"`
	Coordinate     wireCoordinate `json:"coordinate"`
	Producer       wireProducer   `json:"producer"`
	Row            int64          `json:"row"`
	Column         int64          `json:"column"`
	RowSpan        int64          `json:"rowSpan"`
	ColumnSpan     int64          `json:"columnSpan"`
	Blocks         []wireBlock    `json:"blocks"`
	DisplayedValue string         `json:"displayedValue"`
}

type wireProjectedAsset struct {
	ID         string         `json:"id"`
	MediaType  string         `json:"mediaType"`
	SHA256     string         `json:"sha256"`
	ByteLength int64          `json:"byteLength"`
	Coordinate wireCoordinate `json:"coordinate"`
	Producer   wireProducer   `json:"producer"`
}

type wireDiagnostic struct{}

type wireFactText struct {
	Values []string
	Scalar bool
}

func (value *wireFactText) UnmarshalJSON(data []byte) error {
	var scalar string
	if err := json.Unmarshal(data, &scalar); err == nil {
		value.Values = []string{scalar}
		value.Scalar = true
		return nil
	}
	var values []string
	if err := json.Unmarshal(data, &values); err != nil || values == nil {
		return errors.New("invalid fact text")
	}
	value.Values = values
	return nil
}

func (value wireFactText) MarshalJSON() ([]byte, error) {
	if value.Scalar {
		if len(value.Values) != 1 {
			return nil, errors.New("invalid scalar fact text")
		}
		return json.Marshal(value.Values[0])
	}
	return json.Marshal(value.Values)
}

type wireAssetMetadata struct {
	ID         int64  `json:"id"`
	MediaType  string `json:"mediaType"`
	OriginPart string `json:"originPart"`
	ByteLength *int64 `json:"byteLength,omitempty"`
}

type wireAsset struct {
	ID         int64  `json:"id"`
	MediaType  string `json:"mediaType"`
	OriginPart string `json:"originPart"`
	Data       []byte `json:"data"`
}

func recomputePayloadAccounting(request Request, payload []byte) (ResultAccounting, error) {
	var wire wirePayload
	if err := decodeStrict(payload, &wire); err != nil {
		return ResultAccounting{}, errors.New("invalid wire payload")
	}
	if err := validateWirePayload(request, wire); err != nil {
		return ResultAccounting{}, err
	}

	assetBytes := int64(0)
	for index, asset := range wire.Assets {
		projected := wire.Core.Assets[index]
		observed := wire.Native.Observed.Assets[index]
		assetSHA := fmt.Sprintf("%x", sha256.Sum256(asset.Data))
		expectedID := fmt.Sprintf("anydoc:%s:asset:%d", request.SourceSHA256, index+1)
		if asset.ID < 0 || asset.MediaType == "" || asset.OriginPart == "" || projected.ID != expectedID || projected.MediaType != asset.MediaType || projected.ByteLength != int64(len(asset.Data)) || projected.SHA256 != assetSHA || observed.ID != asset.ID || observed.MediaType != asset.MediaType || observed.OriginPart != asset.OriginPart || observed.ByteLength == nil || *observed.ByteLength != int64(len(asset.Data)) || !packageCoordinate(projected.Coordinate, asset.OriginPart) || !validProducer(projected.Producer) {
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

	nativeLength, coreLength, err := topLevelProjectionLengths(payload)
	if err != nil {
		return ResultAccounting{}, errors.New("invalid wire payload")
	}
	accounting := ResultAccounting{
		SourceBytes: request.SourceBytes, RawBytes: int64(nativeLength + coreLength + len(`{"native":,"core":}`)),
		AssetCount: int64(len(wire.Assets)), AssetBytes: assetBytes,
		DiagnosticCount: int64(len(wire.Diagnostics)), DiagnosticBytes: diagnosticBytes,
	}
	accounting.ExpandedBytes = accounting.SourceBytes + accounting.RawBytes + accounting.AssetBytes + accounting.DiagnosticBytes
	if accounting.ExpandedBytes > request.Limits.ExpandedBytes || accounting.AssetCount > request.Limits.AssetCount {
		return ResultAccounting{}, errors.New("expanded limit")
	}
	return accounting, nil
}

func validateWirePayload(request Request, wire wirePayload) error {
	if wire.Kind != "anydoc-admission-v2" || wire.Assets == nil || wire.Diagnostics == nil || len(wire.Diagnostics) != 0 {
		return errors.New("invalid wire payload")
	}
	if wire.Native.Kind != "anydoc-native-v2" || wire.Native.Source.DocumentSHA256 != request.SourceSHA256 || wire.Native.Source.Format != request.Format || wire.Native.Observed.BlockCount < 0 || wire.Native.Observed.NoteCount < 0 || wire.Native.Observed.Assets == nil || wire.Native.Facts == nil {
		return errors.New("invalid native facts")
	}
	if wire.Core.SchemaVersion != 2 || wire.Core.Source.DocumentSHA256 != request.SourceSHA256 || wire.Core.Source.Format != request.Format || wire.Core.Source.MediaType != formatMediaType(request.Format) || !validProducer(wire.Core.Producer) || wire.Core.Blocks == nil || wire.Core.Assets == nil || wire.Core.Diagnostics == nil || len(wire.Core.Diagnostics) != 0 || len(wire.Core.Assets) != len(wire.Assets) || len(wire.Native.Observed.Assets) != len(wire.Assets) {
		return errors.New("invalid core projection")
	}
	var relationships wireRelationships
	if err := decodeStrict([]byte(wire.Core.Metadata.AnydocRelationships), &relationships); err != nil || relationships.Notes == nil || relationships.Inlines == nil {
		return errors.New("invalid core projection")
	}
	if err := validateRelationships(relationships, wire.Native.Observed, wire.Assets); err != nil {
		return errors.New("invalid core projection")
	}
	provenance := make(map[string]wireCoordinate)
	blockFacts := make(map[string]struct{})
	blockTextFacts := make(map[string]string)
	factKinds := make(map[string]int)
	nativeAssetCount := int64(-1)
	var coordinateKinds []string
	for _, fact := range wire.Native.Facts {
		if err := validateFact(fact, request, provenance); err != nil {
			return fmt.Errorf("invalid native fact %q (%s): %w", fact.FactPath, fact.Kind, err)
		}
		factKinds[fact.Kind]++
		if fact.Kind == "asset-count" {
			nativeAssetCount = *fact.Count
		}
		if fact.Kind == "block" {
			if _, exists := blockFacts[fact.FactPath]; exists {
				return errors.New("duplicate native block")
			}
			blockFacts[fact.FactPath] = struct{}{}
		}
		if fact.Kind == "block-text" {
			if _, exists := blockTextFacts[fact.FactPath]; exists {
				return errors.New("duplicate native block text")
			}
			blockTextFacts[fact.FactPath] = fact.Text.Values[0]
		}
		if fact.Kind == "coordinate-kinds" {
			coordinateKinds = fact.Kinds
		}
	}
	if factKinds["ordered-text"] != 1 || factKinds["asset-count"] != 1 || factKinds["block-count"] != 1 || factKinds["coordinate-kinds"] != 1 || factKinds["no-parser-downgrade"] != 1 || factKinds["notes"] < 1 {
		return errors.New("incomplete native facts")
	}
	mainBlockCount := int64(0)
	for path := range blockFacts {
		if strings.HasPrefix(path, "blocks/") {
			mainBlockCount++
		}
	}
	if wire.Native.Observed.BlockCount != mainBlockCount || nativeCountFact(wire.Native.Facts, "block-count") != mainBlockCount {
		return errors.New("native block count mismatch")
	}
	expectedCoordinateKinds := []string{"document"}
	if len(wire.Assets) > 0 {
		expectedCoordinateKinds = append(expectedCoordinateKinds, "package-part")
	}
	if nativeAssetCount != int64(len(wire.Assets)) || !equalStrings(coordinateKinds, expectedCoordinateKinds) {
		return errors.New("native summary mismatch")
	}
	for _, fact := range wire.Native.Facts {
		if fact.Kind != "provenance" {
			if _, ok := provenance[fact.FactPath]; !ok {
				return errors.New("unbound native fact")
			}
		}
	}
	for index, asset := range wire.Assets {
		coordinate, ok := provenance[fmt.Sprintf("assets/%d", index+1)]
		if !ok || !packageCoordinate(coordinate, asset.OriginPart) {
			return errors.New("unbound native asset")
		}
	}
	seenIDs := make(map[string]struct{})
	for _, block := range wire.Core.Blocks {
		if err := validateBlock(block, request.SourceSHA256, seenIDs, provenance, blockFacts, blockTextFacts, 1); err != nil {
			return errors.New("invalid core projection")
		}
	}
	return nil
}

func validateFact(fact wireFact, request Request, provenance map[string]wireCoordinate) error {
	if fact.FactPath == "" {
		return errors.New("fact path")
	}
	baseOnly := fact.Path == nil && fact.Coordinate == nil && fact.Producer == nil && fact.Level == nil && fact.Target == nil && fact.Ordered == nil && fact.Depth == nil && fact.Columns == nil && fact.Rows == nil && fact.Count == nil && fact.Kinds == nil
	switch fact.Kind {
	case "ordered-text", "notes":
		if !baseOnly || fact.Text == nil || fact.Text.Scalar {
			return errors.New("fact shape")
		}
	case "asset-count", "block-count":
		if fact.Path != nil || fact.Coordinate != nil || fact.Producer != nil || fact.Text != nil || fact.Level != nil || fact.Target != nil || fact.Ordered != nil || fact.Depth != nil || fact.Columns != nil || fact.Rows != nil || fact.Count == nil || *fact.Count < 0 || fact.Kinds != nil {
			return errors.New("fact shape")
		}
	case "coordinate-kinds":
		if fact.Path != nil || fact.Coordinate != nil || fact.Producer != nil || fact.Text != nil || fact.Level != nil || fact.Target != nil || fact.Ordered != nil || fact.Depth != nil || fact.Columns != nil || fact.Rows != nil || fact.Count != nil || fact.Kinds == nil {
			return errors.New("fact shape")
		}
		for _, kind := range fact.Kinds {
			if kind != "document" && kind != "package-part" {
				return errors.New("fact coordinate kind")
			}
		}
	case "no-parser-downgrade":
		if !baseOnly || fact.Text != nil {
			return errors.New("fact shape")
		}
	case "block":
		if !baseOnly || fact.Text != nil {
			return errors.New("fact shape")
		}
	case "block-text":
		if fact.Text == nil || !fact.Text.Scalar || len(fact.Text.Values) != 1 || fact.Path != nil || fact.Coordinate != nil || fact.Producer != nil || fact.Level != nil || fact.Target != nil || fact.Ordered != nil || fact.Depth != nil || fact.Columns != nil || fact.Rows != nil || fact.Count != nil || fact.Kinds != nil {
			return errors.New("fact shape")
		}
	case "heading":
		if fact.Level == nil || *fact.Level < 1 || *fact.Level > 6 || fact.Text == nil || !fact.Text.Scalar || len(fact.Text.Values) != 1 || fact.Path != nil || fact.Coordinate != nil || fact.Producer != nil || fact.Target != nil || fact.Ordered != nil || fact.Depth != nil || fact.Columns != nil || fact.Rows != nil || fact.Count != nil || fact.Kinds != nil {
			return errors.New("fact shape")
		}
	case "link":
		if fact.Text == nil || !fact.Text.Scalar || len(fact.Text.Values) != 1 || fact.Target == nil || fact.Path != nil || fact.Coordinate != nil || fact.Producer != nil || fact.Level != nil || fact.Ordered != nil || fact.Depth != nil || fact.Columns != nil || fact.Rows != nil || fact.Count != nil || fact.Kinds != nil {
			return errors.New("fact shape")
		}
	case "list":
		if fact.Ordered == nil || fact.Depth == nil || *fact.Depth < 1 || fact.Text == nil || fact.Text.Scalar || fact.Path != nil || fact.Coordinate != nil || fact.Producer != nil || fact.Level != nil || fact.Target != nil || fact.Columns != nil || fact.Rows != nil || fact.Count != nil || fact.Kinds != nil {
			return errors.New("fact shape")
		}
	case "table":
		if fact.Columns == nil || fact.Rows == nil || fact.Text != nil || fact.Path != nil || fact.Coordinate != nil || fact.Producer != nil || fact.Level != nil || fact.Target != nil || fact.Ordered != nil || fact.Depth != nil || fact.Count != nil || fact.Kinds != nil {
			return errors.New("fact shape")
		}
	case "provenance":
		if fact.Path == nil || *fact.Path != fact.FactPath || fact.Coordinate == nil || fact.Producer == nil || !validProducer(*fact.Producer) || !validCoordinate(*fact.Coordinate, request.SourceSHA256) || fact.Text != nil || fact.Level != nil || fact.Target != nil || fact.Ordered != nil || fact.Depth != nil || fact.Columns != nil || fact.Rows != nil || fact.Count != nil || fact.Kinds != nil {
			return errors.New("fact provenance")
		}
		if _, exists := provenance[fact.FactPath]; exists {
			return errors.New("duplicate provenance")
		}
		provenance[fact.FactPath] = *fact.Coordinate
	default:
		return errors.New("fact kind")
	}
	return nil
}

func validateBlock(block wireBlock, sourceSHA string, seen map[string]struct{}, provenance map[string]wireCoordinate, blockFacts map[string]struct{}, blockTextFacts map[string]string, depth int) error {
	if depth > 128 || block.ID == "" || !strings.HasPrefix(block.ID, "anydoc:"+sourceSHA+":") || !documentCoordinate(block.Coordinate, sourceSHA) || !validProducer(block.Producer) || block.HeadingPath == nil {
		return errors.New("block provenance")
	}
	if _, exists := seen[block.ID]; exists {
		return errors.New("duplicate block")
	}
	seen[block.ID] = struct{}{}
	factPath, bound := blockFactPath(block.ID)
	if !bound {
		return errors.New("block native path")
	}
	if _, exists := provenance[factPath]; !exists {
		return errors.New("block missing native provenance")
	}
	if _, exists := blockFacts[factPath]; !exists {
		return errors.New("block missing native fact")
	}
	switch block.Kind {
	case "text":
		if block.Role == nil || !oneOf(*block.Role, "heading", "paragraph", "code", "quote", "note") || block.Text == nil || block.Inlines == nil || block.Ordered != nil || block.Items != nil || block.Columns != nil || block.HeaderRows != nil || block.Rows != nil {
			return errors.New("text block")
		}
		if nativeText, exists := blockTextFacts[factPath]; !exists || nativeText != *block.Text {
			return errors.New("text missing native fact")
		}
		if *block.Role == "heading" {
			if block.Level == nil || *block.Level < 1 || *block.Level > 6 {
				return errors.New("heading")
			}
		} else if block.Level != nil {
			return errors.New("level")
		}
		for _, inline := range block.Inlines {
			if !documentCoordinate(inline.Coordinate, sourceSHA) || !validProducer(inline.Producer) || !oneOf(inline.Kind, "text", "link") || inline.Kind == "link" && inline.Target == nil || inline.Kind == "text" && inline.Target != nil {
				return errors.New("inline")
			}
		}
	case "list":
		if block.Ordered == nil || block.Items == nil || block.Role != nil || block.Text != nil || block.Inlines != nil || block.Level != nil || block.Columns != nil || block.HeaderRows != nil || block.Rows != nil {
			return errors.New("list block")
		}
		for itemIndex, item := range block.Items {
			if item.ID != fmt.Sprintf("%s:item:%d", block.ID, itemIndex+1) || !documentCoordinate(item.Coordinate, sourceSHA) || !validProducer(item.Producer) || item.Blocks == nil {
				return errors.New("list item")
			}
			for _, child := range item.Blocks {
				if child.Kind != "text" && child.Kind != "list" {
					return errors.New("list child")
				}
				if err := validateBlock(child, sourceSHA, seen, provenance, blockFacts, blockTextFacts, depth+1); err != nil {
					return err
				}
			}
		}
	case "table":
		if block.Columns == nil || block.HeaderRows == nil || *block.HeaderRows < 0 || block.Rows == nil || block.Role != nil || block.Text != nil || block.Inlines != nil || block.Level != nil || block.Ordered != nil || block.Items != nil {
			return errors.New("table block")
		}
		for rowIndex, row := range block.Rows {
			for columnIndex, cell := range row {
				if cell.ID != fmt.Sprintf("%s:row:%d:column:%d", block.ID, rowIndex+1, columnIndex+1) || !documentCoordinate(cell.Coordinate, sourceSHA) || !validProducer(cell.Producer) || cell.Row != int64(rowIndex+1) || cell.Column != int64(columnIndex+1) || cell.RowSpan < 1 || cell.ColumnSpan < 1 || cell.Blocks == nil {
					return errors.New("table cell")
				}
				cellFactPath := fmt.Sprintf("%s/rows/%d/columns/%d", factPath, rowIndex+1, columnIndex+1)
				if _, exists := provenance[cellFactPath]; !exists {
					return errors.New("table cell missing native provenance")
				}
				for _, child := range cell.Blocks {
					if child.Kind != "text" && child.Kind != "list" {
						return errors.New("table child")
					}
					if err := validateBlock(child, sourceSHA, seen, provenance, blockFacts, blockTextFacts, depth+1); err != nil {
						return err
					}
				}
			}
		}
	default:
		return errors.New("block kind")
	}
	return nil
}

func blockFactPath(id string) (string, bool) {
	parts := strings.SplitN(id, ":", 4)
	if len(parts) != 4 {
		return "", false
	}
	path := parts[3]
	if strings.HasPrefix(path, "document/") {
		path = strings.TrimPrefix(path, "document/")
	} else if strings.HasPrefix(path, "note:") {
		path = "notes/" + strings.TrimPrefix(path, "note:")
	} else {
		return "", false
	}
	path = strings.ReplaceAll(path, "/block:", "/blocks/")
	path = strings.ReplaceAll(path, "block:", "blocks/")
	path = strings.ReplaceAll(path, "/item:", "/items/")
	path = strings.ReplaceAll(path, "/row:", "/rows/")
	path = strings.ReplaceAll(path, "/column:", "/columns/")
	return path, true
}

func nativeCountFact(facts []wireFact, kind string) int64 {
	for _, fact := range facts {
		if fact.Kind == kind && fact.Count != nil {
			return *fact.Count
		}
	}
	return -1
}

func validateRelationships(value wireRelationships, observed wireObserved, assets []wireAsset) error {
	if int64(len(value.Notes)) != observed.NoteCount {
		return errors.New("note count")
	}
	noteIDs := make(map[string]struct{})
	for _, note := range value.Notes {
		if note.ID == "" || !oneOf(note.Kind, "footnote", "endnote") {
			return errors.New("note")
		}
		if _, exists := noteIDs[note.ID]; exists {
			return errors.New("duplicate note")
		}
		noteIDs[note.ID] = struct{}{}
	}
	for _, inline := range value.Inlines {
		if inline.Path == "" || !oneOf(inline.Kind, "link", "image", "anchor", "noteRef", "lineBreak") {
			return errors.New("inline")
		}
		switch inline.Kind {
		case "link":
			if inline.Target == nil || inline.Source != nil || inline.Anchor != nil || inline.NoteID != nil || !oneOf(inline.Target.Kind, "external", "relative", "anchor") || inline.Target.Value == "" {
				return errors.New("link")
			}
		case "image":
			if inline.Source == nil || inline.Target != nil || inline.Anchor != nil || inline.NoteID != nil || !oneOf(inline.Source.Kind, "asset", "external", "unavailable") {
				return errors.New("image")
			}
			if inline.Source.Kind == "asset" {
				if inline.Source.AssetID == nil || *inline.Source.AssetID < 0 || inline.Source.URL != nil || !hasAssetID(assets, *inline.Source.AssetID) {
					return errors.New("asset source")
				}
			} else if inline.Source.Kind == "external" {
				if inline.Source.URL == nil || *inline.Source.URL == "" || inline.Source.AssetID != nil {
					return errors.New("external source")
				}
			} else if inline.Source.AssetID != nil || inline.Source.URL != nil {
				return errors.New("unavailable source")
			}
		case "anchor":
			if inline.Anchor == nil || inline.Target != nil || inline.Source != nil || inline.NoteID != nil {
				return errors.New("anchor")
			}
		case "noteRef":
			if inline.NoteID == nil || inline.Target != nil || inline.Source != nil || inline.Anchor != nil {
				return errors.New("note")
			}
			if _, ok := noteIDs[*inline.NoteID]; !ok {
				return errors.New("dangling note")
			}
		case "lineBreak":
			if inline.Target != nil || inline.Source != nil || inline.Anchor != nil || inline.NoteID != nil {
				return errors.New("break")
			}
		}
	}
	return nil
}

func hasAssetID(assets []wireAsset, id int64) bool {
	for _, asset := range assets {
		if asset.ID == id {
			return true
		}
	}
	return false
}
func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func validProducer(value wireProducer) bool {
	return value.Kind == "parser" && value.Name == "anydoc" && value.Version == "0.1.7" && value.AdapterVersion == "2-admission"
}
func validCoordinate(value wireCoordinate, sourceSHA string) bool {
	return documentCoordinate(value, sourceSHA) || value.Kind == "package-part" && value.Part != nil && *value.Part != "" && value.DocumentSHA256 == nil
}
func documentCoordinate(value wireCoordinate, sourceSHA string) bool {
	return value.Kind == "document" && value.DocumentSHA256 != nil && *value.DocumentSHA256 == sourceSHA && value.Part == nil && value.Anchor == nil
}
func packageCoordinate(value wireCoordinate, part string) bool {
	return value.Kind == "package-part" && value.Part != nil && *value.Part == part && value.DocumentSHA256 == nil && value.Anchor == nil
}
func oneOf(value string, values ...string) bool {
	for _, candidate := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
func formatMediaType(format Format) string {
	if format == FormatDOCX {
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	}
	return "application/octet-stream"
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

func topLevelProjectionLengths(payload []byte) (int, int, error) {
	index := skipSpace(payload, 0)
	if index >= len(payload) || payload[index] != '{' {
		return 0, 0, errors.New("object")
	}
	index++
	nativeLength, coreLength := -1, -1
	for {
		index = skipSpace(payload, index)
		if index >= len(payload) {
			return 0, 0, errors.New("object")
		}
		if payload[index] == '}' {
			break
		}
		keyStart := index
		keyEnd, err := scanJSONString(payload, keyStart)
		if err != nil {
			return 0, 0, err
		}
		var key string
		if err := json.Unmarshal(payload[keyStart:keyEnd], &key); err != nil {
			return 0, 0, err
		}
		index = skipSpace(payload, keyEnd)
		if index >= len(payload) || payload[index] != ':' {
			return 0, 0, errors.New("colon")
		}
		valueStart := skipSpace(payload, index+1)
		valueEnd, err := scanJSONValue(payload, valueStart)
		if err != nil {
			return 0, 0, err
		}
		switch key {
		case "native":
			nativeLength = valueEnd - valueStart
		case "core":
			coreLength = valueEnd - valueStart
		}
		index = skipSpace(payload, valueEnd)
		if index < len(payload) && payload[index] == ',' {
			index++
			continue
		}
		if index >= len(payload) || payload[index] != '}' {
			return 0, 0, errors.New("separator")
		}
	}
	if nativeLength < 0 || coreLength < 0 {
		return 0, 0, errors.New("projection")
	}
	return nativeLength, coreLength, nil
}

func scanJSONValue(payload []byte, start int) (int, error) {
	if start >= len(payload) {
		return 0, errors.New("value")
	}
	if payload[start] == '"' {
		return scanJSONString(payload, start)
	}
	if payload[start] != '{' && payload[start] != '[' {
		index := start
		for index < len(payload) && payload[index] != ',' && payload[index] != '}' && payload[index] != ']' && payload[index] != ' ' && payload[index] != '\n' && payload[index] != '\r' && payload[index] != '\t' {
			index++
		}
		if index == start {
			return 0, errors.New("scalar")
		}
		return index, nil
	}
	depth := 0
	for index := start; index < len(payload); index++ {
		switch payload[index] {
		case '"':
			end, err := scanJSONString(payload, index)
			if err != nil {
				return 0, err
			}
			index = end - 1
		case '{', '[':
			depth++
		case '}', ']':
			depth--
			if depth == 0 {
				return index + 1, nil
			}
		}
	}
	return 0, errors.New("unterminated value")
}

func scanJSONString(payload []byte, start int) (int, error) {
	if start >= len(payload) || payload[start] != '"' {
		return 0, errors.New("string")
	}
	for index := start + 1; index < len(payload); index++ {
		if payload[index] == '\\' {
			index++
			continue
		}
		if payload[index] == '"' {
			return index + 1, nil
		}
	}
	return 0, errors.New("unterminated string")
}

func skipSpace(payload []byte, index int) int {
	for index < len(payload) && (payload[index] == ' ' || payload[index] == '\n' || payload[index] == '\r' || payload[index] == '\t') {
		index++
	}
	return index
}
