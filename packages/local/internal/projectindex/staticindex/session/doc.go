// Package session owns high-level Static Index orchestration for the Go local
// runtime.
//
// The package is the boundary that host and service code call when they need a
// project-level Static Index attempt. It delegates planning to the planner
// package and execution to the run package while keeping low-level worker,
// cache, and patch details out of route and devtools code.
package session
