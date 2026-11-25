package ledger

import (
	"errors"
	"fmt"
	"sync"
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

func TestPostRetryReturnsStoredEntry(t *testing.T) {
	l := open(t, "c1")
	first := mustPost(t, l, Entry{ID: "l1", Card: "c1", Kind: Load, Amount: 2000, At: t0})
	mustPost(t, l, Entry{ID: "f1", Card: "c1", Kind: Fare, Amount: -275, At: t0})

	again := mustPost(t, l, Entry{ID: "l1", Card: "c1", Kind: Load, Amount: 2000, At: t0.Add(time.Minute)})
	if again != first {
		t.Errorf("retry = %+v, want the stored entry %+v", again, first)
	}
	if bal, _ := l.Balance("c1"); bal != 1725 {
		t.Errorf("Balance = %d, want 1725", bal)
	}
	if n := len(l.Entries("c1")); n != 2 {
		t.Errorf("len(Entries) = %d, want 2", n)
	}
}

func TestPostRejectsIDOfAnotherCard(t *testing.T) {
	l := open(t, "c1", "c2")
	mustPost(t, l, Entry{ID: "l1", Card: "c1", Kind: Load, Amount: 2000, At: t0})

	_, err := l.Post(Entry{ID: "l1", Card: "c2", Kind: Load, Amount: 2000, At: t0})
	if !errors.Is(err, ErrDuplicate) {
		t.Fatalf("err = %v, want ErrDuplicate", err)
	}
	if bal, _ := l.Balance("c2"); bal != 0 {
		t.Errorf("Balance(c2) = %d, want 0", bal)
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
	if got := l.Entries("c3"); len(got) != 0 {
		t.Errorf("Entries(c3) = %v, want none", got)
	}
}

func TestEntriesIsNotExtendedByAppend(t *testing.T) {
	l := open(t, "c1")
	mustPost(t, l, Entry{ID: "a", Card: "c1", Kind: Load, Amount: 500, At: t0})
	mustPost(t, l, Entry{ID: "b", Card: "c1", Kind: Load, Amount: 500, At: t0})

	got := append(l.Entries("c1"), Entry{ID: "x"})
	mustPost(t, l, Entry{ID: "c", Card: "c1", Kind: Load, Amount: 500, At: t0})

	if got[2].ID != "x" {
		t.Errorf("appended entry = %q, want x", got[2].ID)
	}
	if e := l.Entries("c1"); len(e) != 3 || e[2].ID != "c" {
		t.Errorf("Entries(c1) = %v, want a, b, c", e)
	}
}

func TestLatest(t *testing.T) {
	l := open(t, "c1", "c2")
	mustPost(t, l, Entry{ID: "a", Card: "c1", Kind: Load, Amount: 2000, At: t0})
	mustPost(t, l, Entry{ID: "b", Card: "c1", Kind: Fare, Amount: -275, At: t0})
	mustPost(t, l, Entry{ID: "c", Card: "c1", Kind: Fare, Amount: -650, At: t0})
	mustPost(t, l, Entry{ID: "d", Card: "c1", Kind: Load, Amount: 500, At: t0})

	if e, ok := l.Latest("c1", Fare); !ok || e.ID != "c" {
		t.Errorf("Latest(c1, Fare) = %v, %v; want c", e.ID, ok)
	}
	if e, ok := l.Latest("c1", Load); !ok || e.ID != "d" {
		t.Errorf("Latest(c1, Load) = %v, %v; want d", e.ID, ok)
	}
	if _, ok := l.Latest("c2", Fare); ok {
		t.Error("Latest(c2, Fare) found an entry")
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

	mustPost(t, l, Entry{ID: "a", Card: "c1", Kind: Load, Amount: 100, At: t0})

	if len(seen) != 2 || seen[0] != "a" || seen[1] != "b" {
		t.Errorf("seen = %v, want a, b", seen)
	}
}

func TestSubscribersSeeSequenceOrder(t *testing.T) {
	const posts = 200
	l := open(t, "c1")
	var seqs []uint64
	l.Subscribe(func(e Entry) { seqs = append(seqs, e.Seq) })

	var wg sync.WaitGroup
	for i := range posts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := l.Post(Entry{ID: fmt.Sprint(i), Card: "c1", Kind: Load, Amount: 100, At: t0}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()

	if len(seqs) != posts {
		t.Fatalf("delivered %d entries, want %d", len(seqs), posts)
	}
	for i, seq := range seqs {
		if seq != uint64(i)+1 {
			t.Fatalf("entry %d delivered was seq %d, want %d", i, seq, i+1)
		}
	}
}

func TestSubscriberCanReadLedger(t *testing.T) {
	l := open(t, "c1")
	var balances []int64
	l.Subscribe(func(e Entry) {
		bal, err := l.Balance(e.Card)
		if err != nil {
			t.Error(err)
		}
		balances = append(balances, bal)
	})
	mustPost(t, l, Entry{ID: "a", Card: "c1", Kind: Load, Amount: 500, At: t0})
	mustPost(t, l, Entry{ID: "b", Card: "c1", Kind: Fare, Amount: -275, At: t0})

	if len(balances) != 2 || balances[0] != 500 || balances[1] != 225 {
		t.Errorf("balances = %v, want 500, 225", balances)
	}
}
