package fare

import (
	"fmt"
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
	want := Result{OpenGate: true, Charged: 275, Balance: 725}
	if got != want {
		t.Errorf("retry = %+v, want %+v", got, want)
	}
	if bal, _ := l.Balance("c1"); bal != 725 {
		t.Errorf("Balance = %d, want 725", bal)
	}
}

func TestTransferIsFree(t *testing.T) {
	_, c := setup(t, 1000)
	if _, err := c.Tap(Tap{ID: "t1", Card: "c1", Gate: "north", At: t0}); err != nil {
		t.Fatal(err)
	}
	got, err := c.Tap(Tap{ID: "t2", Card: "c1", Gate: "airport", At: t0.Add(40 * time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	want := Result{OpenGate: true, Balance: 725, Transfer: true}
	if got != want {
		t.Errorf("Tap = %+v, want %+v", got, want)
	}
}

func TestTransferRetryIsStillFree(t *testing.T) {
	_, c := setup(t, 1000)
	if _, err := c.Tap(Tap{ID: "t1", Card: "c1", Gate: "north", At: t0}); err != nil {
		t.Fatal(err)
	}
	tap := Tap{ID: "t2", Card: "c1", Gate: "north", At: t0.Add(40 * time.Minute)}
	if _, err := c.Tap(tap); err != nil {
		t.Fatal(err)
	}
	got, err := c.Tap(tap)
	if err != nil {
		t.Fatal(err)
	}
	want := Result{OpenGate: true, Balance: 725, Transfer: true}
	if got != want {
		t.Errorf("retry = %+v, want %+v", got, want)
	}
}

func TestOneTransferPerPaidFare(t *testing.T) {
	_, c := setup(t, 1000)
	for i, at := range []time.Duration{0, 30 * time.Minute} {
		if _, err := c.Tap(Tap{ID: fmt.Sprint(i), Card: "c1", Gate: "north", At: t0.Add(at)}); err != nil {
			t.Fatal(err)
		}
	}
	got, err := c.Tap(Tap{ID: "third", Card: "c1", Gate: "north", At: t0.Add(60 * time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	want := Result{OpenGate: true, Charged: 275, Balance: 450}
	if got != want {
		t.Errorf("Tap = %+v, want %+v", got, want)
	}
}

func TestTapAfterWindowIsCharged(t *testing.T) {
	_, c := setup(t, 1000)
	if _, err := c.Tap(Tap{ID: "t1", Card: "c1", Gate: "north", At: t0}); err != nil {
		t.Fatal(err)
	}
	got, err := c.Tap(Tap{ID: "t2", Card: "c1", Gate: "north", At: t0.Add(TransferWindow)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Transfer || got.Charged != 275 {
		t.Errorf("Tap = %+v, want a charge of 275", got)
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
