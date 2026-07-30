package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// PromptTextPreviewTargetKind identifies how one static-preview template is
// selected from the exact current analysis.
type PromptTextPreviewTargetKind string

const (
	PromptTextPreviewTargetPosition      PromptTextPreviewTargetKind = "position"
	PromptTextPreviewTargetTemplateRange PromptTextPreviewTargetKind = "template-range"
)

// PromptTextPreviewTarget is the closed position-or-range request union.
type PromptTextPreviewTarget struct {
	Kind     PromptTextPreviewTargetKind
	Position *Position
	Range    *Range
}

type promptTextPreviewPositionWire struct {
	Line      *uint32 `json:"line"`
	Character *uint32 `json:"character"`
}

type promptTextPreviewRangeWire struct {
	Start *promptTextPreviewPositionWire `json:"start"`
	End   *promptTextPreviewPositionWire `json:"end"`
}

// UnmarshalJSON rejects fields belonging to another target variant.
func (t *PromptTextPreviewTarget) UnmarshalJSON(data []byte) error {
	var header struct {
		Kind PromptTextPreviewTargetKind `json:"kind"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		return err
	}
	switch header.Kind {
	case PromptTextPreviewTargetPosition:
		var value struct {
			Kind     PromptTextPreviewTargetKind    `json:"kind"`
			Position *promptTextPreviewPositionWire `json:"position"`
		}
		if err := decodePromptTextPreviewClosed(data, &value); err != nil {
			return err
		}
		position, ok := requiredPromptTextPreviewPosition(value.Position)
		if !ok {
			return errors.New("missing PromptText preview position")
		}
		*t = PromptTextPreviewTarget{Kind: value.Kind, Position: &position}
	case PromptTextPreviewTargetTemplateRange:
		var value struct {
			Kind  PromptTextPreviewTargetKind `json:"kind"`
			Range *promptTextPreviewRangeWire `json:"range"`
		}
		if err := decodePromptTextPreviewClosed(data, &value); err != nil {
			return err
		}
		if value.Range == nil {
			return errors.New("missing PromptText preview template range")
		}
		start, startOK := requiredPromptTextPreviewPosition(value.Range.Start)
		end, endOK := requiredPromptTextPreviewPosition(value.Range.End)
		if !startOK || !endOK {
			return errors.New("incomplete PromptText preview template range")
		}
		sourceRange := Range{Start: start, End: end}
		*t = PromptTextPreviewTarget{Kind: value.Kind, Range: &sourceRange}
	default:
		return fmt.Errorf("unknown PromptText preview target kind %q", header.Kind)
	}
	return nil
}

// MarshalJSON emits only fields owned by the active target variant.
func (t PromptTextPreviewTarget) MarshalJSON() ([]byte, error) {
	switch t.Kind {
	case PromptTextPreviewTargetPosition:
		return json.Marshal(struct {
			Kind     PromptTextPreviewTargetKind `json:"kind"`
			Position *Position                   `json:"position"`
		}{Kind: t.Kind, Position: t.Position})
	case PromptTextPreviewTargetTemplateRange:
		return json.Marshal(struct {
			Kind  PromptTextPreviewTargetKind `json:"kind"`
			Range *Range                      `json:"range"`
		}{Kind: t.Kind, Range: t.Range})
	default:
		return nil, fmt.Errorf("unknown PromptText preview target kind %q", t.Kind)
	}
}

// PromptTextPreviewStaticParams requests one template from an exact open
// document revision.
type PromptTextPreviewStaticParams struct {
	ProtocolVersion uint16                  `json:"protocolVersion"`
	URI             DocumentURI             `json:"uri"`
	OpenEpoch       uint64                  `json:"openEpoch"`
	Version         int64                   `json:"version"`
	SourceHash      string                  `json:"sourceHash"`
	Target          PromptTextPreviewTarget `json:"target"`
}

// UnmarshalJSON keeps the private request closed at every object boundary.
func (p *PromptTextPreviewStaticParams) UnmarshalJSON(data []byte) error {
	var value struct {
		ProtocolVersion *uint16                  `json:"protocolVersion"`
		URI             *DocumentURI             `json:"uri"`
		OpenEpoch       *uint64                  `json:"openEpoch"`
		Version         *int64                   `json:"version"`
		SourceHash      *string                  `json:"sourceHash"`
		Target          *PromptTextPreviewTarget `json:"target"`
	}
	if err := decodePromptTextPreviewClosed(data, &value); err != nil {
		return err
	}
	if value.ProtocolVersion == nil ||
		value.URI == nil ||
		value.OpenEpoch == nil ||
		value.Version == nil ||
		value.SourceHash == nil ||
		value.Target == nil {
		return errors.New("incomplete PromptText static preview params")
	}
	*p = PromptTextPreviewStaticParams{
		ProtocolVersion: *value.ProtocolVersion,
		URI:             *value.URI,
		OpenEpoch:       *value.OpenEpoch,
		Version:         *value.Version,
		SourceHash:      *value.SourceHash,
		Target:          *value.Target,
	}
	return nil
}

func requiredPromptTextPreviewPosition(
	value *promptTextPreviewPositionWire,
) (Position, bool) {
	if value == nil || value.Line == nil || value.Character == nil {
		return Position{}, false
	}
	return Position{Line: *value.Line, Character: *value.Character}, true
}

// PromptTextPreviewResultStamp is echoed by every static-preview result.
type PromptTextPreviewResultStamp struct {
	ProtocolVersion uint16      `json:"protocolVersion"`
	URI             DocumentURI `json:"uri"`
	OpenEpoch       uint64      `json:"openEpoch"`
	Version         int64       `json:"version"`
	SourceHash      string      `json:"sourceHash"`
}

// PromptTextPreviewResultKind is the closed client-facing result union.
type PromptTextPreviewResultKind string

const (
	PromptTextPreviewResultReady       PromptTextPreviewResultKind = "ready"
	PromptTextPreviewResultChoose      PromptTextPreviewResultKind = "choose"
	PromptTextPreviewResultUnavailable PromptTextPreviewResultKind = "unavailable"
)

// PromptTextPreviewSelection identifies one current template for display.
// Ordinal is request-local presentation and must never be used as identity.
type PromptTextPreviewSelection struct {
	Ordinal uint32 `json:"ordinal"`
	Range   Range  `json:"range"`
}

// PromptTextPreviewStructuralStatus reports request or template completeness.
type PromptTextPreviewStructuralStatus string

const (
	PromptTextPreviewStructuralComplete  PromptTextPreviewStructuralStatus = "complete"
	PromptTextPreviewStructuralTruncated PromptTextPreviewStructuralStatus = "truncated"
)

// PromptTextPreviewContentStatus reports preview byte completeness.
type PromptTextPreviewContentStatus string

const (
	PromptTextPreviewContentComplete  PromptTextPreviewContentStatus = "complete"
	PromptTextPreviewContentTruncated PromptTextPreviewContentStatus = "truncated"
)

// PromptTextPreviewEvidence describes the strongest proof contributing bytes.
type PromptTextPreviewEvidence string

const (
	PromptTextPreviewEvidenceSyntaxExact   PromptTextPreviewEvidence = "syntax-exact"
	PromptTextPreviewEvidenceSemanticExact PromptTextPreviewEvidence = "semantic-exact"
)

// PromptTextPreviewTruncation is metadata for omitted preview bytes.
type PromptTextPreviewTruncationReason string

const (
	PromptTextPreviewTruncatedByBytes PromptTextPreviewTruncationReason = "max-preview-bytes"
	PromptTextPreviewTruncatedByDepth PromptTextPreviewTruncationReason = "max-fragment-depth"
)

// PromptTextPreviewTruncation reports the first preview-only bound.
type PromptTextPreviewTruncation struct {
	Reason       PromptTextPreviewTruncationReason `json:"reason"`
	Limit        uint32                            `json:"limit"`
	EmittedBytes uint32                            `json:"emittedBytes"`
}

// PromptTextPreviewReadyResult contains exact static-preview document bytes.
type PromptTextPreviewReadyResult struct {
	PromptTextPreviewResultStamp
	Kind           PromptTextPreviewResultKind       `json:"kind"`
	Selection      PromptTextPreviewSelection        `json:"selection"`
	RequestStatus  PromptTextPreviewStructuralStatus `json:"requestStatus"`
	TemplateStatus PromptTextPreviewStructuralStatus `json:"templateStatus"`
	PreviewStatus  PromptTextPreviewContentStatus    `json:"previewStatus"`
	Evidence       PromptTextPreviewEvidence         `json:"evidence"`
	Text           string                            `json:"text"`
	Truncation     *PromptTextPreviewTruncation      `json:"truncation,omitempty"`
}

// PromptTextPreviewChooseResult asks the client to select one current range.
type PromptTextPreviewChooseResult struct {
	PromptTextPreviewResultStamp
	Kind          PromptTextPreviewResultKind       `json:"kind"`
	RequestStatus PromptTextPreviewStructuralStatus `json:"requestStatus"`
	Choices       []PromptTextPreviewSelection      `json:"choices"`
}

// PromptTextPreviewUnavailableReason is the server-owned failure vocabulary.
type PromptTextPreviewUnavailableReason string

const (
	PromptTextPreviewDocumentNotOpen     PromptTextPreviewUnavailableReason = "document-not-open"
	PromptTextPreviewRevisionMismatch    PromptTextPreviewUnavailableReason = "revision-mismatch"
	PromptTextPreviewAnalysisUnavailable PromptTextPreviewUnavailableReason = "analysis-unavailable"
	PromptTextPreviewRequestUnsupported  PromptTextPreviewUnavailableReason = "request-unsupported"
	PromptTextPreviewTemplateNotFound    PromptTextPreviewUnavailableReason = "template-not-found"
	PromptTextPreviewTemplateAmbiguous   PromptTextPreviewUnavailableReason = "template-ambiguous"
	PromptTextPreviewTemplateUnsupported PromptTextPreviewUnavailableReason = "template-unsupported"
	PromptTextPreviewUnavailable         PromptTextPreviewUnavailableReason = "preview-unavailable"
)

// PromptTextPreviewUnavailableResult reports no document bytes.
type PromptTextPreviewUnavailableResult struct {
	PromptTextPreviewResultStamp
	Kind   PromptTextPreviewResultKind        `json:"kind"`
	Reason PromptTextPreviewUnavailableReason `json:"reason"`
}

func decodePromptTextPreviewClosed(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}
