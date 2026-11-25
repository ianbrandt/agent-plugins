package ledger

import (
	"errors"
	"testing"
	"time"
)

var t0 = time.Date(2026, 3, 2, 8, 0, 0, 0, time.UTC)

func open(t *testing.T, cards ...string) *Ledger {
	t.Helper()
	l := New()
	for _, c := range cards {
		if err := l.Open(c); err != nil {
			t.Fatal(err)
		}
	}
	return l
}

func mustPost(t *testing.T, l *Ledger, e Entry) Entry {
	t.Helper()
	got, err := l.Post(e)
	if err != nil {
		t.Fatalf("Post(%s): %v", e.ID, err)
	}
	return got
}

func TestPostUpdatesBalance(t *testing.T) {
	l := open(t, "c1")
	mustPost(t, l, Entry{ID: "l1", Card: "c1", Kind: Load, Amount: 2000, At: t0})
	got := mustPost(t, l, Entry{ID: "f1", Card: "c1", Kind: Fare, Amount: -275, At: t0})

	if got.Seq != 2 || got.BalanceAfter != 1725 {
		t.Errorf("Post = seq %d, balance %d; want 2, 1725", got.Seq, got.BalanceAfter)
	}
	if bal, _ := l.Balance("c1"); bal != 1725 {
		t.Errorf("Balance = %d, want 1725", bal)
	}
}

func TestPostRejectsDuplicateID(t *testing.T) {
	l := open(t, "c1")
	mustPost(t, l, Entry{ID: "l1", Card: "c1", Kind: Load, Amount: 2000, At: t0})

	_, err := l.Post(Entry{ID: "l1", Card: "c1", Kind: Load, Amount: 2000, At: t0})
	if !errors.Is(err, ErrDuplicate) {
		t.Fatalf("err = %v, want ErrDuplicate", err)
	}
	if bal, _ := l.Balance("c1"); bal != 2000 {
		t.Errorf("Balance = %d, want 2000", bal)
	}
}

func TestPostRejectsOverdraft(t *testing.T) {
	l := open(t, "c1")
	mustPost(t, l, Entry{ID: "l1", Card: "c1", Kind: Load, Amount: 200, At: t0})

	_, err := l.Post(Entry{ID: "f1", Card: "c1", Kind: Fare, Amount: -275, At: t0})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}
}

func TestPostRejectsUnknownCard(t *testing.T) {
	l := open(t)
	_, err := l.Post(Entry{ID: "l1", Card: "nope", Kind: Load, Amount: 100, At: t0})
	if !errors.Is(err, ErrUnknownCard) {
		t.Fatalf("err = %v, want ErrUnknownCard", err)
	}
}

func TestEntriesFiltersByCard(t *testing.T) {
	l := open(t, "c1", "c2")
	mustPost(t, l, Entry{ID: "a", Card: "c1", Kind: Load, Amount: 500, At: t0})
	mustPost(t, l, Entry{ID: "b", Card: "c2", Kind: Load, Amount: 500, At: t0})
	mustPost(t, l, Entry{ID: "c", Card: "c1", Kind: Fare, Amount: -275, At: t0})

	got := l.Entries("c1")
	if len(got) != 2 || got[0].ID != "a" || got[1].ID != "c" {
		t.Fatalf("Entries(c1) = %v, want a, c", got)
	}
}

func TestSince(t *testing.T) {
	l := open(t, "c1")
	for _, id := range []string{"a", "b", "c"} {
		mustPost(t, l, Entry{ID: id, Card: "c1", Kind: Load, Amount: 100, At: t0})
	}
	if got := l.Since(1); len(got) != 2 || got[0].ID != "b" {
		t.Errorf("Since(1) = %v, want b, c", got)
	}
	if got := l.Since(3); got != nil {
		t.Errorf("Since(3) = %v, want nil", got)
	}
}

func TestSubscribe(t *testing.T) {
	l := open(t, "c1")
	var seen []string
	l.Subscribe(func(e Entry) { seen = append(seen, e.ID) })
	mustPost(t, l, Entry{ID: "a", Card: "c1", Kind: Load, Amount: 100, At: t0})
	mustPost(t, l, Entry{ID: "b", Card: "c1", Kind: Load, Amount: 100, At: t0})

	if len(seen) != 2 || seen[0] != "a" || seen[1] != "b" {
		t.Errorf("seen = %v, want a, b", seen)
	}
}
