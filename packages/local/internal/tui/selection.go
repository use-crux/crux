package tui

// Kind names a record type that screens can stage in the workbench's
// cross-screen selection store. See ADR-0051 for the architectural
// rationale. Adding a kind is additive; removing one is a breaking
// change for every screen that reads it.
type Kind string

const (
	KindRun     Kind = "run"
	KindSpan    Kind = "span"
	KindInsight Kind = "insight"
)

// GetSelection returns the workbench's currently-staged id for `kind`,
// or "" if nothing is staged. Cheap; safe to call every render.
func (w *Workbench) GetSelection(kind Kind) string {
	if w.selection == nil {
		return ""
	}
	return w.selection[kind]
}

// SetSelection stages `id` under `kind`, replacing any previous value.
// Empty id is treated the same as ClearSelection.
func (w *Workbench) SetSelection(kind Kind, id string) {
	if id == "" {
		w.ClearSelection(kind)
		return
	}
	if w.selection == nil {
		w.selection = make(map[Kind]string)
	}
	w.selection[kind] = id
}

// ClearSelection removes any staged id under `kind`. No-op if absent.
func (w *Workbench) ClearSelection(kind Kind) {
	if w.selection == nil {
		return
	}
	delete(w.selection, kind)
}
