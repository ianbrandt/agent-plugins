// Package ledger keeps the balance and history of each fare card.
package ledger

import (
	"fmt"
	"sync"
)

// Ledger records card entries in memory. It is safe for concurrent use.
type Ledger struct {
	mu       sync.Mutex
	entries  []Entry // in sequence order; entries[i].Seq == i+1
	ids      map[string]bool
	balances map[string]int64
	subs     []func(Entry)
}

// New returns an empty ledger.
func New() *Ledger {
	return &Ledger{ids: map[string]bool{}, balances: map[string]int64{}}
}

// Open registers card with a zero balance.
func (l *Ledger) Open(card string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.balances[card]; ok {
		return fmt.Errorf("%w: %s", ErrCardExists, card)
	}
	l.balances[card] = 0
	return nil
}

// Subscribe registers fn to receive each new entry. fn is called after the
// entry is recorded, outside the ledger's lock.
func (l *Ledger) Subscribe(fn func(Entry)) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.subs = append(l.subs, fn)
}

// Post records e and returns it with Seq and BalanceAfter set. An entry ID
// can be posted once: a second Post with the same ID returns ErrDuplicate.
func (l *Ledger) Post(e Entry) (Entry, error) {
	if err := e.validate(); err != nil {
		return Entry{}, err
	}

	l.mu.Lock()
	if l.ids[e.ID] {
		l.mu.Unlock()
		return Entry{}, fmt.Errorf("%w: %s", ErrDuplicate, e.ID)
	}
	bal, ok := l.balances[e.Card]
	if !ok {
		l.mu.Unlock()
		return Entry{}, fmt.Errorf("%w: %s", ErrUnknownCard, e.Card)
	}
	if bal+e.Amount < 0 {
		l.mu.Unlock()
		return Entry{}, fmt.Errorf("%w: %s", ErrInsufficientFunds, e.Card)
	}
	e.Seq = uint64(len(l.entries)) + 1
	e.BalanceAfter = bal + e.Amount
	l.entries = append(l.entries, e)
	l.ids[e.ID] = true
	l.balances[e.Card] = e.BalanceAfter
	subs := l.subs
	l.mu.Unlock()

	for _, fn := range subs {
		fn(e)
	}
	return e, nil
}

// Balance returns the balance of card, in cents.
func (l *Ledger) Balance(card string) (int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	bal, ok := l.balances[card]
	if !ok {
		return 0, fmt.Errorf("%w: %s", ErrUnknownCard, card)
	}
	return bal, nil
}

// Entries returns a copy of the entries for card, in sequence order.
func (l *Ledger) Entries(card string) []Entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []Entry
	for _, e := range l.entries {
		if e.Card == card {
			out = append(out, e)
		}
	}
	return out
}

// Since returns a copy of the entries after seq, in sequence order.
func (l *Ledger) Since(seq uint64) []Entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	if seq >= uint64(len(l.entries)) {
		return nil
	}
	return append([]Entry(nil), l.entries[seq:]...)
}
