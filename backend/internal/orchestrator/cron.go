package orchestrator

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// CronExpr is a parsed 5-field cron expression: minute hour day-of-month month
// day-of-week. Fields accept `*`, `a`, `a-b`, `a-b/n`, `*/n`, and comma lists of
// those. Day-of-week is 0-6 (Sunday = 0; 7 also accepted for Sunday). The
// convenience macros `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly` are
// also understood. This is a small self-contained parser — no external cron
// dependency (RUNBOOK_MODULE_PLAN.md §6.4: no new Go deps).
type CronExpr struct {
	raw    string
	minute [60]bool
	hour   [24]bool
	dom    [32]bool // 1-31
	month  [13]bool // 1-12
	dow    [7]bool  // 0-6
	// domRestricted / dowRestricted follow Vixie cron semantics: when only one
	// of the two day fields is a wildcard, the other alone decides the day.
	domRestricted bool
	dowRestricted bool
}

var cronMacros = map[string]string{
	"@yearly":   "0 0 1 1 *",
	"@annually": "0 0 1 1 *",
	"@monthly":  "0 0 1 * *",
	"@weekly":   "0 0 * * 0",
	"@daily":    "0 0 * * *",
	"@midnight": "0 0 * * *",
	"@hourly":   "0 * * * *",
}

// ParseCron parses a 5-field expression (or a macro).
func ParseCron(expr string) (CronExpr, error) {
	raw := strings.TrimSpace(expr)
	if raw == "" {
		return CronExpr{}, fmt.Errorf("empty cron expression")
	}
	spec := raw
	if m, ok := cronMacros[strings.ToLower(raw)]; ok {
		spec = m
	}
	fields := strings.Fields(spec)
	if len(fields) != 5 {
		return CronExpr{}, fmt.Errorf("cron expression must have 5 fields (got %d)", len(fields))
	}
	c := CronExpr{raw: raw}
	if err := fillField(fields[0], 0, 59, c.minute[:]); err != nil {
		return CronExpr{}, fmt.Errorf("minute: %w", err)
	}
	if err := fillField(fields[1], 0, 23, c.hour[:]); err != nil {
		return CronExpr{}, fmt.Errorf("hour: %w", err)
	}
	if err := fillField(fields[2], 1, 31, c.dom[:]); err != nil {
		return CronExpr{}, fmt.Errorf("day-of-month: %w", err)
	}
	if err := fillField(fields[3], 1, 12, c.month[:]); err != nil {
		return CronExpr{}, fmt.Errorf("month: %w", err)
	}
	if err := fillField(normalizeDow(fields[4]), 0, 6, c.dow[:]); err != nil {
		return CronExpr{}, fmt.Errorf("day-of-week: %w", err)
	}
	c.domRestricted = fields[2] != "*"
	c.dowRestricted = fields[4] != "*"
	return c, nil
}

// String returns the original (pre-macro) expression.
func (c CronExpr) String() string { return c.raw }

// normalizeDow maps the Vixie "7 = Sunday" convention onto 0 for whole tokens
// (a bare "7" or the endpoints of a range), without mangling multi-digit text.
func normalizeDow(field string) string {
	repl := func(tok string) string {
		if tok == "7" {
			return "0"
		}
		return tok
	}
	parts := strings.Split(field, ",")
	for i, p := range parts {
		if slash := strings.IndexByte(p, '/'); slash >= 0 {
			parts[i] = normalizeDowRange(p[:slash], repl) + "/" + p[slash+1:]
		} else {
			parts[i] = normalizeDowRange(p, repl)
		}
	}
	return strings.Join(parts, ",")
}

func normalizeDowRange(rng string, repl func(string) string) string {
	if dash := strings.IndexByte(rng, '-'); dash >= 0 {
		return repl(rng[:dash]) + "-" + repl(rng[dash+1:])
	}
	return repl(rng)
}

func fillField(field string, min, max int, set []bool) error {
	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return fmt.Errorf("empty term")
		}
		step := 1
		rng := part
		if slash := strings.IndexByte(part, '/'); slash >= 0 {
			rng = part[:slash]
			s, err := strconv.Atoi(part[slash+1:])
			if err != nil || s <= 0 {
				return fmt.Errorf("bad step %q", part[slash+1:])
			}
			step = s
		}
		lo, hi := min, max
		if rng != "*" {
			if dash := strings.IndexByte(rng, '-'); dash >= 0 {
				a, err1 := strconv.Atoi(rng[:dash])
				b, err2 := strconv.Atoi(rng[dash+1:])
				if err1 != nil || err2 != nil {
					return fmt.Errorf("bad range %q", rng)
				}
				lo, hi = a, b
			} else {
				n, err := strconv.Atoi(rng)
				if err != nil {
					return fmt.Errorf("bad value %q", rng)
				}
				lo, hi = n, n
			}
		}
		if lo < min || hi > max || lo > hi {
			return fmt.Errorf("value out of range [%d-%d]: %q", min, max, part)
		}
		// set is value-indexed (set[v]); the arrays are sized to allow it.
		for v := lo; v <= hi; v += step {
			set[v] = true
		}
	}
	return nil
}

func anyTrue(s []bool) bool {
	for _, v := range s {
		if v {
			return true
		}
	}
	return false
}

// Next returns the first time strictly after `after` that matches the
// expression, truncated to the minute. It gives up (returns zero) after
// scanning ~4 years, which only happens for an impossible date like Feb 30.
func (c CronExpr) Next(after time.Time) time.Time {
	if !anyTrue(c.minute[:]) { // zero value / never parsed
		return time.Time{}
	}
	t := after.Truncate(time.Minute).Add(time.Minute)
	limit := after.AddDate(4, 0, 0)
	for t.Before(limit) {
		if !c.month[t.Month()] {
			// jump to the first day of the next month
			t = time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location()).AddDate(0, 1, 0)
			continue
		}
		if !c.dayMatches(t) {
			t = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location()).AddDate(0, 0, 1)
			continue
		}
		if !c.hour[t.Hour()] {
			t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, t.Location()).Add(time.Hour)
			continue
		}
		if !c.minute[t.Minute()] {
			t = t.Add(time.Minute)
			continue
		}
		return t
	}
	return time.Time{}
}

func (c CronExpr) dayMatches(t time.Time) bool {
	dom := c.dom[t.Day()]
	dow := c.dow[int(t.Weekday())]
	switch {
	case c.domRestricted && c.dowRestricted:
		return dom || dow // Vixie cron: union when both are restricted
	case c.domRestricted:
		return dom
	case c.dowRestricted:
		return dow
	default:
		return true
	}
}
