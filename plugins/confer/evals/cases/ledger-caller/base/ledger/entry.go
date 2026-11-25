package ledger

import (
	"errors"
	"fmt"
	"time"
)

// Kind is the reason for an entry.
type Kind int

const (
	Load     Kind = iota + 1 // value added to a card
	Fare                     // a ride charged to a card
	Reversal                 // a correction of an earlier entry
)

func (k Kind) String() string {
	switch k {
	case Load:
		return "load"
	case Fare:
		return "fare"
	case Reversal:
		return "reversal"
	}
	return fmt.Sprintf("Kind(%d)", int(k))
}

// Entry is one change to a card's balance. Amounts are in cents: loads are
// positive, fares are negative or zero, and reversals may be either.
type Entry struct {
	Seq          uint64 // set by Post; the first entry is 1
	ID           string // chosen by the caller, unique across the ledger
	Card         string
	Kind         Kind
	Amount       int64
	BalanceAfter int64 // set by Post
	At           time.Time
}

var (
	ErrUnknownCard       = errors.New("ledger: unknown card")
	ErrCardExists        = errors.New("ledger: card already open")
	ErrDuplicate         = errors.New("ledger: duplicate entry ID")
	ErrInsufficientFunds = errors.New("ledger: insufficient funds")
	ErrInvalidEntry      = errors.New("ledger: invalid entry")
)

func (e Entry) validate() error {
	switch {
	case e.ID == "":
		return fmt.Errorf("%w: missing ID", ErrInvalidEntry)
	case e.Card == "":
		return fmt.Errorf("%w: %s: missing card", ErrInvalidEntry, e.ID)
	case e.Kind == Load && e.Amount <= 0:
		return fmt.Errorf("%w: %s: load of %d", ErrInvalidEntry, e.ID, e.Amount)
	case e.Kind == Fare && e.Amount > 0:
		return fmt.Errorf("%w: %s: fare of %d", ErrInvalidEntry, e.ID, e.Amount)
	case e.Kind != Load && e.Kind != Fare && e.Kind != Reversal:
		return fmt.Errorf("%w: %s: %v", ErrInvalidEntry, e.ID, e.Kind)
	}
	return nil
}
