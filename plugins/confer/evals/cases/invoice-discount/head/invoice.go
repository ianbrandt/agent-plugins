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

// Discount returns total reduced by percent, a whole number from 0 to 100.
func Discount(total, percent int64) int64 {
	return total - total*(percent/100)
}
