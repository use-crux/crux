package output

// osc8Start and osc8End bracket an OSC-8 terminal hyperlink. The sequence is
//
//	ESC ] 8 ; ; <uri> ESC \   <text>   ESC ] 8 ; ; ESC \
//
// where ESC = 0x1B and `\` = 0x5C (ST, the String Terminator). We use the ST
// terminator rather than BEL for spec fidelity. No `id=` parameter is set:
// clig.dev advises simple utilities against assigning hyperlink ids.
const (
	osc8Open  = "\x1b]8;;"
	osc8Close = "\x1b\\"
)

// Hyperlink renders text as an OSC-8 terminal hyperlink to url when the target
// stream is a rich terminal; otherwise it returns a script-safe plain fallback
// that never loses the URL.
//
// onStdout selects which stream's TTY status gates the link: true picks the
// primary (Out) stream, false the diagnostic (Err) stream. A link is emitted
// only when [IO.ColorEnabled] is true AND that stream is a TTY — the color gate
// doubles as a "rich terminal" proxy and keeps CI logs free of escape noise.
//
// Fallback (not linkable):
//   - text == "" or text == url → the bare url
//   - otherwise → "text (url)", so the destination survives `| grep`/CI capture
//
// OSC-8 degrades silently on terminals without support (they show text only),
// so emitting it on any TTY is safe.
//
//	io.Hyperlink("trace abc123", "http://localhost:4400/traces/abc123", false)
//	// TTY+color → clickable "trace abc123"
//	// piped      → "trace abc123 (http://localhost:4400/traces/abc123)"
func (io *IO) Hyperlink(text, url string, onStdout bool) string {
	streamTTY := io.stderrTTY
	if onStdout {
		streamTTY = io.stdoutTTY
	}
	if !io.colorEnabled || !streamTTY {
		if text == "" || text == url {
			return url
		}
		return text + " (" + url + ")"
	}
	return osc8Open + url + osc8Close + text + osc8Open + osc8Close
}
