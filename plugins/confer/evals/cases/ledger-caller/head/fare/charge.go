// Package fare charges fares when a card is tapped at a gate.
package fare

import (
	"errors"
	"fmt"
	"time"

	"example.com/farecard/ledger"
)

// TransferWindow is how long after a paid fare the next tap rides free.
const TransferWindow = 90 * time.Minute

// Fares maps a gate to its fare, in cents.
type Fares map[string]int64

// Tap is one read of a card at a gate. A gate that gets no answer sends the
// same tap again with the same ID.
type Tap struct {
	ID   string
	Card string
	Gate string
	At   time.Time
}

// Result tells the gate what to do and what to show the rider.
type Result struct {
	OpenGate bool
	Charged  int64 // cents
	Balance  int64 // cents, after the charge
	Transfer bool
	Declined string
}

// Charger posts a fare entry for each tap.
type Charger struct {
	ledger *ledger.Ledger
	fares  Fares
}

func NewCharger(l *ledger.Ledger, fares Fares) *Charger {
	return &Charger{ledger: l, fares: fares}
}

// Tap charges the fare for t. A tap within TransferWindow of the card's last
// paid fare is a transfer and costs nothing; the transfer is recorded as a
// zero fare, so the tap after it is charged again.
//
// A declined tap is not an error: the result says why, and the gate stays
// closed.
func (c *Charger) Tap(t Tap) (Result, error) {
	fare, ok := c.fares[t.Gate]
	if !ok {
		return Result{}, fmt.Errorf("fare: unknown gate %q", t.Gate)
	}
	if prev, ok := c.ledger.Latest(t.Card, ledger.Fare); ok && prev.Amount < 0 && t.At.Sub(prev.At) < TransferWindow {
		fare = 0
	}

	e, err := c.ledger.Post(ledger.Entry{
		ID:     "tap/" + t.ID,
		Card:   t.Card,
		Kind:   ledger.Fare,
		Amount: -fare,
		At:     t.At,
	})
	switch {
	case errors.Is(err, ledger.ErrInsufficientFunds):
		bal, err := c.ledger.Balance(t.Card)
		if err != nil {
			return Result{}, err
		}
		return Result{Balance: bal, Declined: "insufficient funds"}, nil
	case errors.Is(err, ledger.ErrUnknownCard):
		return Result{Declined: "unknown card"}, nil
	case err != nil:
		return Result{}, err
	}
	return Result{
		OpenGate: true,
		Charged:  -e.Amount,
		Balance:  e.BalanceAfter,
		Transfer: e.Amount == 0,
	}, nil
}
