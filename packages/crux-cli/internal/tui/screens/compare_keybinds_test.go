package screens

import "testing"

// TestCompareKeybindsHonorContract asserts Compare's Keybinds() reflect
// the polymorphic-verb contract: `o` is open-in-external-viewer (not
// "only diffs"), `f` is the only-diffs filter, `p` is promote, `y` is
// the yank-to-clipboard prefix. The old design's `o only diffs` /
// `p copy prompt` / `c copy to clipboard` labels were three contract
// violations — see KEYBINDS.md. Plan S9.
func TestCompareKeybindsHonorContract(t *testing.T) {
	c := NewCompare()
	binds := c.Keybinds()

	var (
		hasOExternal bool
		hasFFilter   bool
		hasPPromote  bool
		hasYYank     bool
	)
	for _, b := range binds {
		if b.Key == "o" && b.Label == "only diffs" {
			t.Errorf("Compare keybind `o` still labeled \"only diffs\" — should be open-in-viewer per KEYBINDS contract")
		}
		if b.Key == "o" && b.Label != "only diffs" {
			hasOExternal = true
		}
		if b.Key == "f" {
			hasFFilter = true
		}
		if b.Key == "p" {
			hasPPromote = true
		}
		if b.Key == "y" {
			hasYYank = true
		}
		if b.Key == "p" && b.Label == "copy prompt" {
			t.Errorf("Compare keybind `p` still labeled \"copy prompt\" — should be promote per KEYBINDS")
		}
	}
	if !hasOExternal {
		t.Error("Compare keybinds missing `o open in viewer`")
	}
	if !hasFFilter {
		t.Error("Compare keybinds missing `f` (only-diffs filter)")
	}
	if !hasPPromote {
		t.Error("Compare keybinds missing `p promote`")
	}
	if !hasYYank {
		t.Error("Compare keybinds missing `y` (yank prefix)")
	}
}
