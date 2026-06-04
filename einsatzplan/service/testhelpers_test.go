package service

// SetEmitter injects a test event emitter. Defined here (not in production
// code) so Wails binding generation never sees it.
func (s *PlannerService) SetEmitter(e EventEmitter) { s.emitter = e }
