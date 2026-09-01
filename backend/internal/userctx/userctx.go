// Package userctx carries the authenticated user id on a request context so
// low-level packages (vault, llm, mcp, orchestrator) can scope data per user
// without importing internal/server or internal/auth.
//
// An empty id (the zero value / no user on the context) means single-user
// mode — every scoped lookup then falls back to the legacy shared store,
// keeping `--auth off` byte-identical.
package userctx

import "context"

type key struct{}

// With returns a copy of ctx that carries userID.
func With(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, key{}, userID)
}

// From returns the user id on ctx, or "" in single-user mode.
func From(ctx context.Context) string {
	if v, ok := ctx.Value(key{}).(string); ok {
		return v
	}
	return ""
}
