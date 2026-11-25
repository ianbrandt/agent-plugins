package fare

import (
	"testing"
	"time"

	"example.com/farecard/ledger"
)

var t0 = time.Date(2026, 3, 2, 8, 0, 0, 0, time.UTC)

func setup(t *testing.T, balance int64) (*ledger.Ledger, *Charger) {
	t.Helper()
	l := ledger.New()
	if err := l.Open("c1"); err != nil {
		t.Fatal(err)
	}
	if balance > 0 {
		if _, err := l.Post(ledger.Entry{ID: "load", Card: "c1", Kind: ledger.Load, Amount: balance, At: t0}); err != nil {
			t.Fatal(err)
		}
	}
	return l, NewCharger(l, Fares{"north": 275, "airport": 650})
}

func TestTapCharges(t *testing.T) {
	_, c := setup(t, 1000)
	got, err := c.Tap(Tap{ID: "t1", Card: "c1", Gate: "north", At: t0})
	if err != nil {
		t.Fatal(err)
	}
	want := Result{OpenGate: true, Charged: 275, Balance: 725}
	if got != want {
		t.Errorf("Tap = %+v, want %+v", got, want)
	}
}

func TestTapRetryIsNotChargedAgain(t *testing.T) {
	l, c := setup(t, 1000)
	tap := Tap{ID: "t1", Card: "c1", Gate: "north", At: t0}
	if _, err := c.Tap(tap); err != nil {
		t.Fatal(err)
	}
	got, err := c.Tap(tap)
	if err != nil {
		t.Fatal(err)
	}
	if !got.OpenGate || got.Balance != 725 {
		t.Errorf("retry = %+v, want an open gate and balance 725", got)
	}
	if bal, _ := l.Balance("c1"); bal != 725 {
		t.Errorf("Balance = %d, want 725", bal)
	}
}

func TestTapDeclinesLowBalance(t *testing.T) {
	_, c := setup(t, 300)
	got, err := c.Tap(Tap{ID: "t1", Card: "c1", Gate: "airport", At: t0})
	if err != nil {
		t.Fatal(err)
	}
	want := Result{Balance: 300, Declined: "insufficient funds"}
	if got != want {
		t.Errorf("Tap = %+v, want %+v", got, want)
	}
}

func TestTapUnknownGate(t *testing.T) {
	_, c := setup(t, 1000)
	if _, err := c.Tap(Tap{ID: "t1", Card: "c1", Gate: "south", At: t0}); err == nil {
		t.Error("Tap at an unknown gate succeeded")
	}
}
