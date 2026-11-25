// Package topup adds value to fare cards, paid from a rider's payment card.
package topup

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"example.com/farecard/ledger"
)

const (
	MaxLoad    = 100_00 // largest single load, in cents
	DailyLimit = 250_00 // most one card can load in a day, in cents
)

var (
	ErrBadAmount     = errors.New("topup: amount out of range")
	ErrDailyLimit    = errors.New("topup: daily load limit reached")
	ErrAlreadyLoaded = errors.New("topup: order already loaded")
)

// Payments takes money from a rider's payment card.
type Payments interface {
	Capture(token string, amount int64) error
}

// Order asks for Amount cents to be added to Card and paid with Token. ID is
// chosen by the client, which sends the same ID when it retries an order.
type Order struct {
	ID     string
	Card   string
	Amount int64
	Token  string
}

// Service loads fare cards.
type Service struct {
	ledger   *ledger.Ledger
	payments Payments
	now      func() time.Time

	mu     sync.Mutex
	loaded map[string]int64 // cents loaded, by card and day
}

func New(l *ledger.Ledger, p Payments) *Service {
	return &Service{ledger: l, payments: p, now: time.Now, loaded: map[string]int64{}}
}

// Load credits o to its card, then captures the payment. If the capture
// fails, the credit is reversed.
func (s *Service) Load(o Order) (ledger.Entry, error) {
	if o.Amount <= 0 || o.Amount > MaxLoad {
		return ledger.Entry{}, ErrBadAmount
	}
	now := s.now()
	day := o.Card + "/" + now.Format(time.DateOnly)
	if !s.reserve(day, o.Amount) {
		return ledger.Entry{}, ErrDailyLimit
	}

	e, err := s.ledger.Post(ledger.Entry{
		ID:     "load/" + o.ID,
		Card:   o.Card,
		Kind:   ledger.Load,
		Amount: o.Amount,
		At:     now,
	})
	if errors.Is(err, ledger.ErrDuplicate) {
		s.release(day, o.Amount)
		return ledger.Entry{}, ErrAlreadyLoaded
	}
	if err != nil {
		s.release(day, o.Amount)
		return ledger.Entry{}, err
	}

	if err := s.payments.Capture(o.Token, o.Amount); err != nil {
		s.release(day, o.Amount)
		_, rerr := s.ledger.Post(ledger.Entry{
			ID:     "load/" + o.ID + "/reversal",
			Card:   o.Card,
			Kind:   ledger.Reversal,
			Amount: -o.Amount,
			At:     s.now(),
		})
		if rerr != nil {
			return ledger.Entry{}, fmt.Errorf("topup: capture failed (%v), and reversing the credit failed: %w", err, rerr)
		}
		return ledger.Entry{}, fmt.Errorf("topup: capture failed: %w", err)
	}
	return e, nil
}

func (s *Service) reserve(day string, amount int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded[day]+amount > DailyLimit {
		return false
	}
	s.loaded[day] += amount
	return true
}

func (s *Service) release(day string, amount int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.loaded[day] -= amount
}
