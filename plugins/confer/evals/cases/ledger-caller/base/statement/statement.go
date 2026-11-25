// Package statement builds a card's monthly statement from the ledger.
package statement

import (
	"fmt"
	"io"
	"text/tabwriter"
	"time"

	"example.com/farecard/ledger"
)

// Statement lists a card's entries in [From, To) between its opening and
// closing balances.
type Statement struct {
	Card    string
	From    time.Time
	To      time.Time
	Opening int64
	Lines   []ledger.Entry
	Closing int64
}

// Builder builds statements.
type Builder struct {
	ledger *ledger.Ledger
}

func NewBuilder(l *ledger.Ledger) *Builder {
	return &Builder{ledger: l}
}

// Build returns the statement for card covering [from, to).
func (b *Builder) Build(card string, from, to time.Time) (Statement, error) {
	if _, err := b.ledger.Balance(card); err != nil {
		return Statement{}, err
	}
	st := Statement{Card: card, From: from, To: to}

	all := b.ledger.Entries(card)
	lines := all[:0]
	for _, e := range all {
		switch {
		case e.At.Before(from):
			st.Opening += e.Amount
		case e.At.Before(to):
			lines = append(lines, e)
		}
	}
	st.Lines = lines

	st.Closing = st.Opening
	for _, e := range st.Lines {
		st.Closing += e.Amount
	}
	return st, nil
}

// Month returns the bounds of the calendar month that contains t.
func Month(t time.Time) (from, to time.Time) {
	from = time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
	return from, from.AddDate(0, 1, 0)
}

// WriteText writes st as a plain-text table.
func (st Statement) WriteText(w io.Writer) error {
	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintf(tw, "Card %s, %s to %s\t\t\t\n", st.Card, st.From.Format(time.DateOnly), st.To.AddDate(0, 0, -1).Format(time.DateOnly))
	fmt.Fprintf(tw, "Opening balance\t\t%s\t\n", cents(st.Opening))
	for _, e := range st.Lines {
		fmt.Fprintf(tw, "%s\t%s\t%s\t\n", e.At.Format("Jan 2 15:04"), e.Kind, cents(e.Amount))
	}
	fmt.Fprintf(tw, "Closing balance\t\t%s\t\n", cents(st.Closing))
	return tw.Flush()
}

func cents(c int64) string {
	sign := ""
	if c < 0 {
		sign, c = "-", -c
	}
	return fmt.Sprintf("%s$%d.%02d", sign, c/100, c%100)
}
