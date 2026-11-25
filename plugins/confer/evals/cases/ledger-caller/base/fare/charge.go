// Package fare charges fares when a card is tapped at a gate.
package fare

import (
	"errors"
	"fmt"
	"time"

	"example.com/farecard/ledger"
)

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

// Tap charges the fare for t. A declined tap is not an error: the result
// says why, and the gate stays closed.
func (c *Charger) Tap(t Tap) (Result, error) {
	fare, ok := c.fares[t.Gate]
	if !ok {
		return Result{}, fmt.Errorf("fare: unknown gate %q", t.Gate)
	}

	e, err := c.ledger.Post(ledger.Entry{
		ID:     "tap/" + t.ID,
		Card:   t.Card,
		Kind:   ledger.Fare,
		Amount: -fare,
		At:     t.At,
	})
	switch {
	case errors.Is(err, ledger.ErrDuplicate):
		// The gate is resending a tap that was already charged.
		bal, err := c.ledger.Balance(t.Card)
		if err != nil {
			return Result{}, err
		}
		return Result{OpenGate: true, Balance: bal}, nil
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
	return Result{OpenGate: true, Charged: fare, Balance: e.BalanceAfter}, nil
}
