package billing

// Line is one charge on an invoice, in cents.
type Line struct {
	Description string
	Cents       int64
}

// Total adds up the lines of an invoice.
func Total(lines []Line) int64 {
	var total int64
	for _, l := range lines {
		total += l.Cents
	}
	return total
}
