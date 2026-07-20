package runtimebridge

import "log/slog"

// Option configures one runtime bridge service instance.
type Option func(*Service)

// WithLogger routes service-owned diagnostics to logger.
func WithLogger(logger *slog.Logger) Option {
	return func(service *Service) {
		if logger != nil {
			service.logger = logger
		}
	}
}

// Logger returns the logger that owns this service's diagnostics.
func (s *Service) Logger() *slog.Logger {
	if s != nil && s.logger != nil {
		return s.logger
	}
	return slog.Default()
}
