package sched

import "time"

// Backoff returns how long to wait after a failed run.
func Backoff(j Job, failures int) time.Duration {
	return time.Duration(j.Interval*(failures+1)) * time.Second
}
