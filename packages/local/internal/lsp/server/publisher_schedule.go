package server

func (p *Publisher) publishDebounced() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.timer = nil
	p.publishLocked("", true)
	p.mu.Unlock()
	p.flushDiagnosticSubmissions()
}

func (p *Publisher) stopTimerLocked() {
	if p.timer != nil {
		p.timer.Stop()
		p.timer = nil
	}
}
