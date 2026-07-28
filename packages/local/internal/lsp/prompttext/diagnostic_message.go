package prompttext

import (
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func promptTextDiagnosticMessage(
	evidence store.PromptTextDiagnosticEvidence,
) string {
	switch evidence.Cause.Kind {
	case "invalid-interpolation":
		var path strings.Builder
		for _, index := range evidence.InterpolationPath {
			path.WriteByte('[')
			path.WriteString(strconv.Itoa(index))
			path.WriteByte(']')
		}
		return "PromptText interpolation " +
			strconv.Itoa(evidence.InterpolationIndex) +
			path.String() +
			" is always invalid (" +
			strings.Join(evidence.Cause.RuntimeKinds, ", ") +
			"). Use a string, finite number, PromptText fragment, false, null, undefined, or a supported sequence."
	case "json-serialization":
		return "md.json() cannot produce text because JSON.stringify() is proven to return undefined for this value."
	default:
		return ""
	}
}
