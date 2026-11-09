package metrics

import "sync"

// Counters counts events by name. It is safe for concurrent use.
type Counters struct {
	mu     sync.Mutex
	counts map[string]int
}

func New() *Counters {
	return &Counters{counts: map[string]int{}}
}

// Inc adds one to the named counter.
func (c *Counters) Inc(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.counts[name]++
}
