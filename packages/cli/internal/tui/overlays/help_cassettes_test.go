package overlays

import (
	"strings"
	"testing"
)

// TestHelpFooterShowsCassettesExceptionsWhenActive asserts that when
// the focused screen is "cassettes", the help-overlay footer carries
// a reminder about the three documented KEYBINDS exceptions (p=play,
// R=re-record, e=edit). The note appears only when relevant — other
// screens get the plain config footer.
func TestHelpFooterShowsCassettesExceptionsWhenActive(t *testing.T) {
	h := NewHelp()

	t.Run("cassettes_shows_note", func(t *testing.T) {
		h.SetScreenKeybinds("cassettes", nil)
		h.Open()
		out := h.View(120, 40)
		if !strings.Contains(out, "exceptions to the verb contract") {
			t.Errorf("help footer missing Cassettes exceptions reminder when screen is \"cassettes\"")
		}
	})

	t.Run("other_screens_no_note", func(t *testing.T) {
		h2 := NewHelp()
		h2.SetScreenKeybinds("runs", nil)
		h2.Open()
		out := h2.View(120, 40)
		if strings.Contains(out, "exceptions to the verb contract") {
			t.Errorf("help footer leaks the Cassettes-exceptions note onto an unrelated screen")
		}
	})
}
