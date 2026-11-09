package sched

import "time"

// Run calls fn on every tick until stop is closed.
func Run(j Job, fn func(), stop <-chan struct{}) {
	ticker := time.NewTicker(time.Duration(j.Interval) * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			fn()
		case <-stop:
			return
		}
	}
}

// NextRun returns when the job is due after last.
func NextRun(j Job, last time.Time) time.Time {
	return last.Add(time.Duration(j.Interval) * time.Millisecond)
}
