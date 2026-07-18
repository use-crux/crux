package screens

// Default no-op Focus implementations for screens without drill-in state.

func (o *Overview) Focus(_, _ string) {}
func (s *Runs) Focus(_, _ string)     {}
func (s *Index) Focus(_, _ string)    {}
