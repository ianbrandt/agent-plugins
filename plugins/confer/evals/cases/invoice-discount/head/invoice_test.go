package billing

import "testing"

func TestDiscountOfAllOfTheTotal(t *testing.T) {
	if got := Discount(2000, 100); got != 0 {
		t.Errorf("got %d, want 0", got)
	}
}
