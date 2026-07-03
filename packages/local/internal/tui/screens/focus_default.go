package screens

// Default no-op Focus implementations for screens that haven't yet
// specialised cross-screen selection routing. Each screen owns its own
// Focus method; later slices replace these no-ops with real selection-
// staging logic per ADR-0051. Defining them here keeps the diff that
// added the Focus interface method small — one file instead of nine.

func (o *Overview) Focus(_, _ string)  {}
func (s *Runs) Focus(_, _ string)      {}
func (s *Baselines) Focus(_, _ string) {}
func (s *Feedback) Focus(_, _ string)  {}
func (s *Cassettes) Focus(_, _ string) {}
func (s *Index) Focus(_, _ string)     {}
func (s *Stub) Focus(_, _ string)      {}
