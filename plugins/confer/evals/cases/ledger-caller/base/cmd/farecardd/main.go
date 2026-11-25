// Command farecardd serves the fare card API to gates, kiosks, and the web.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"example.com/farecard/fare"
	"example.com/farecard/ledger"
	"example.com/farecard/statement"
	"example.com/farecard/topup"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	gatewayURL := flag.String("gateway", "http://localhost:9090/capture", "payment gateway capture URL")
	flag.Parse()

	l := ledger.New()
	charger := fare.NewCharger(l, fare.Fares{"north": 275, "south": 275, "airport": 650})
	loads := topup.New(l, &gateway{url: *gatewayURL, client: &http.Client{Timeout: 10 * time.Second}})
	auto := topup.NewAutoLoader(loads, log.Default())
	l.Subscribe(auto.Notify)
	statements := statement.NewBuilder(l)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /cards/{card}", func(w http.ResponseWriter, r *http.Request) {
		if err := l.Open(r.PathValue("card")); err != nil {
			fail(w, http.StatusConflict, err)
			return
		}
		w.WriteHeader(http.StatusCreated)
	})
	mux.HandleFunc("POST /taps", func(w http.ResponseWriter, r *http.Request) {
		var t fare.Tap
		if !decode(w, r, &t) {
			return
		}
		res, err := charger.Tap(t)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		reply(w, res)
	})
	mux.HandleFunc("POST /loads", func(w http.ResponseWriter, r *http.Request) {
		var o topup.Order
		if !decode(w, r, &o) {
			return
		}
		e, err := loads.Load(o)
		switch {
		case errors.Is(err, topup.ErrAlreadyLoaded):
			w.WriteHeader(http.StatusOK)
		case err != nil:
			fail(w, http.StatusUnprocessableEntity, err)
		default:
			reply(w, e)
		}
	})
	mux.HandleFunc("PUT /cards/{card}/autoload", func(w http.ResponseWriter, r *http.Request) {
		var p topup.Plan
		if !decode(w, r, &p) {
			return
		}
		p.Card = r.PathValue("card")
		if err := auto.Enroll(p); err != nil {
			fail(w, http.StatusUnprocessableEntity, err)
		}
	})
	mux.HandleFunc("GET /cards/{card}/statement", func(w http.ResponseWriter, r *http.Request) {
		month, err := time.Parse("2006-01", r.URL.Query().Get("month"))
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		from, to := statement.Month(month)
		st, err := statements.Build(r.PathValue("card"), from, to)
		if err != nil {
			fail(w, http.StatusNotFound, err)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		st.WriteText(w)
	})
	mux.HandleFunc("GET /entries", func(w http.ResponseWriter, r *http.Request) {
		after, err := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		reply(w, l.Since(after))
	})

	log.Printf("listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

// gateway captures payments through the payment provider's HTTP API.
type gateway struct {
	url    string
	client *http.Client
}

func (g *gateway) Capture(token string, amount int64) error {
	body, err := json.Marshal(map[string]any{"token": token, "amount": amount, "currency": "USD"})
	if err != nil {
		return err
	}
	resp, err := g.client.Post(g.url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("gateway: %s", resp.Status)
	}
	return nil
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		fail(w, http.StatusBadRequest, err)
		return false
	}
	return true
}

func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, err error) {
	http.Error(w, err.Error(), code)
}
