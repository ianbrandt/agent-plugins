// Package ledger keeps the balance and history of each fare card.
package ledger

import (
	"fmt"
	"sync"
)

// Ledger records card entries in memory. It is safe for concurrent use.
type Ledger struct {
	mu       sync.Mutex
	entries  []Entry            // in sequence order; entries[i].Seq == i+1
	ids      map[string]int     // entry ID to its index in entries
	byCard   map[string][]Entry // each card's entries, in sequence order
	balances map[string]int64
	subs     []func(Entry)
	queue    []Entry // recorded but not yet delivered to subs

	delivering sync.Mutex // held while entries in queue are delivered
}

// New returns an empty ledger.
func New() *Ledger {
	return &Ledger{
		ids:      map[string]int{},
		byCard:   map[string][]Entry{},
		balances: map[string]int64{},
	}
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

// Subscribe registers fn to receive each new entry. fn is called outside the
// ledger's lock, for one entry at a time, in sequence order. Post returns
// after fn has received the entry it recorded.
func (l *Ledger) Subscribe(fn func(Entry)) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.subs = append(l.subs, fn)
}

// Post records e and returns it with Seq and BalanceAfter set.
//
// Posting an ID again for the same card records nothing and returns the
// entry stored the first time, so a caller can retry a Post whose result it
// lost. An ID already used for another card returns ErrDuplicate.
func (l *Ledger) Post(e Entry) (Entry, error) {
	if err := e.validate(); err != nil {
		return Entry{}, err
	}

	l.mu.Lock()
	if i, ok := l.ids[e.ID]; ok {
		prev := l.entries[i]
		l.mu.Unlock()
		if prev.Card != e.Card {
			return Entry{}, fmt.Errorf("%w: %s", ErrDuplicate, e.ID)
		}
		return prev, nil
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
	l.record(e)
	l.queue = append(l.queue, e)
	l.mu.Unlock()

	l.deliver()
	return e, nil
}

func (l *Ledger) record(e Entry) {
	l.ids[e.ID] = len(l.entries)
	l.entries = append(l.entries, e)
	l.byCard[e.Card] = append(l.byCard[e.Card], e)
	l.balances[e.Card] = e.BalanceAfter
}

// deliver hands queued entries to the subscribers in sequence order. One
// goroutine delivers at a time; a Post that arrives meanwhile waits here
// until its entry has been delivered.
func (l *Ledger) deliver() {
	l.delivering.Lock()
	defer l.delivering.Unlock()
	for {
		l.mu.Lock()
		if len(l.queue) == 0 {
			l.mu.Unlock()
			return
		}
		e := l.queue[0]
		l.queue = l.queue[1:]
		subs := l.subs
		l.mu.Unlock()

		for _, fn := range subs {
			fn(e)
		}
	}
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

// Entries returns the entries for card, in sequence order. The ledger only
// ever appends to a card's entries, so the result is shared rather than
// copied, and callers must not modify it.
func (l *Ledger) Entries(card string) []Entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	s := l.byCard[card]
	return s[:len(s):len(s)]
}

// Latest returns the most recent entry of kind for card.
func (l *Ledger) Latest(card string, kind Kind) (Entry, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	s := l.byCard[card]
	for i := len(s) - 1; i >= 0; i-- {
		if s[i].Kind == kind {
			return s[i], true
		}
	}
	return Entry{}, false
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
