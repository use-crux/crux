package theme

// Tone names one semantic color role in the Crux palette.
type Tone string

const (
	ToneFg     Tone = "fg"
	ToneDim    Tone = "dim"
	ToneTeal   Tone = "teal"
	ToneGreen  Tone = "green"
	ToneAmber  Tone = "amber"
	ToneRed    Tone = "red"
	ToneViolet Tone = "violet"
	ToneBlue   Tone = "blue"
)

// StatusGlyph returns the one-cell glyph and tone for a status word.
func StatusGlyph(status string) (glyph string, tone Tone) {
	switch status {
	case "pass", "passed", "success", "completed", "ok":
		return "●", ToneGreen
	case "fail", "failed", "error", "errored":
		return "●", ToneRed
	case "warn", "warning", "drift":
		return "▲", ToneAmber
	case "running", "active":
		return "◆", ToneTeal
	case "new":
		return "◆", ToneViolet
	case "skip", "skipped", "idle":
		return "○", ToneDim
	default:
		return "○", ToneDim
	}
}

// SeverityTone maps insight severity labels to their semantic tone.
func SeverityTone(severity string) Tone {
	switch severity {
	case "high":
		return ToneRed
	case "medium":
		return ToneAmber
	case "low":
		return ToneDim
	default:
		return ToneDim
	}
}
