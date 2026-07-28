package observability

import "encoding/json"

// ObservabilityRedactionSurface is a privacy-safe, closed telemetry surface
// affected by declarative pattern redaction.
type ObservabilityRedactionSurface string

const (
	RedactionSurfaceArtifactPreview ObservabilityRedactionSurface = "artifact.preview"
	RedactionSurfaceArtifactURI     ObservabilityRedactionSurface = "artifact.uri"
	RedactionSurfaceAttributes      ObservabilityRedactionSurface = "attributes"
	RedactionSurfaceErrorMessage    ObservabilityRedactionSurface = "error.message"
)

var observabilityRedactionSurfaceOrder = [...]ObservabilityRedactionSurface{
	RedactionSurfaceArtifactPreview,
	RedactionSurfaceArtifactURI,
	RedactionSurfaceAttributes,
	RedactionSurfaceErrorMessage,
}

// ObservabilityRedactionEvidence reports only that declarative patterns changed
// captured telemetry and which broad surfaces were affected.
type ObservabilityRedactionEvidence struct {
	Applied  bool                            `json:"applied"`
	Surfaces []ObservabilityRedactionSurface `json:"surfaces"`
}

// UnmarshalJSON tolerates future SDK surface names while retaining only the
// vocabulary this Local version can present.
func (evidence *ObservabilityRedactionEvidence) UnmarshalJSON(data []byte) error {
	type wire ObservabilityRedactionEvidence
	var decoded wire
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	evidence.Applied = decoded.Applied
	evidence.Surfaces = canonicalRedactionSurfaces(decoded.Surfaces)
	return nil
}

type RecordPrivacy struct {
	Redaction ObservabilityRedactionEvidence `json:"redaction"`
}

func canonicalRedactionSurfaces(surfaces []ObservabilityRedactionSurface) []ObservabilityRedactionSurface {
	if len(surfaces) == 0 {
		return nil
	}
	present := make(map[ObservabilityRedactionSurface]struct{}, len(surfaces))
	for _, surface := range surfaces {
		present[surface] = struct{}{}
	}
	canonical := make([]ObservabilityRedactionSurface, 0, len(observabilityRedactionSurfaceOrder))
	for _, surface := range observabilityRedactionSurfaceOrder {
		if _, ok := present[surface]; ok {
			canonical = append(canonical, surface)
		}
	}
	return canonical
}

func mergeRedactionEvidence(evidence ...*ObservabilityRedactionEvidence) *ObservabilityRedactionEvidence {
	surfaces := make([]ObservabilityRedactionSurface, 0, len(observabilityRedactionSurfaceOrder))
	for _, item := range evidence {
		if item == nil || !item.Applied {
			continue
		}
		surfaces = append(surfaces, item.Surfaces...)
	}
	surfaces = canonicalRedactionSurfaces(surfaces)
	if len(surfaces) == 0 {
		return nil
	}
	return &ObservabilityRedactionEvidence{Applied: true, Surfaces: surfaces}
}
