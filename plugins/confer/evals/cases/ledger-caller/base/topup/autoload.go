package topup

import (
	"fmt"
	"log"
	"sync"

	"example.com/farecard/ledger"
)

// Plan is a rider's standing order to reload a card when it runs low.
type Plan struct {
	Card   string
	Below  int64 // reload when a fare leaves the balance under this, in cents
	Amount int64 // cents to load
	Token  string
}

// AutoLoader reloads cards that have a plan. Subscribe Notify to the ledger.
type AutoLoader struct {
	svc *Service
	log *log.Logger

	mu    sync.Mutex
	plans map[string]Plan
}

func NewAutoLoader(svc *Service, logger *log.Logger) *AutoLoader {
	return &AutoLoader{svc: svc, log: logger, plans: map[string]Plan{}}
}

// Enroll adds or replaces the plan for p.Card.
func (a *AutoLoader) Enroll(p Plan) error {
	if p.Amount <= 0 || p.Amount > MaxLoad || p.Below <= 0 {
		return ErrBadAmount
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.plans[p.Card] = p
	return nil
}

// Cancel removes the plan for card.
func (a *AutoLoader) Cancel(card string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.plans, card)
}

// Notify reloads the card when a fare leaves its balance under the plan's
// threshold, so the rider's next tap is not declined.
func (a *AutoLoader) Notify(e ledger.Entry) {
	if e.Kind != ledger.Fare {
		return
	}
	a.mu.Lock()
	p, ok := a.plans[e.Card]
	a.mu.Unlock()
	if !ok || e.BalanceAfter >= p.Below {
		return
	}

	order := Order{
		ID:     fmt.Sprintf("auto/%s/%d", e.Card, e.Seq),
		Card:   e.Card,
		Amount: p.Amount,
		Token:  p.Token,
	}
	if _, err := a.svc.Load(order); err != nil {
		a.log.Printf("autoload %s: %v", e.Card, err)
	}
}
