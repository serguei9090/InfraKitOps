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
type roleKey struct{}
type nameKey struct{}

// With returns a copy of ctx that carries userID.
func With(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, key{}, userID)
}

// WithRole adds the caller's coarse role ("admin" / "operator" / "viewer").
func WithRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, roleKey{}, role)
}

// WithName adds the caller's username (for audit lines).
func WithName(ctx context.Context, name string) context.Context {
	return context.WithValue(ctx, nameKey{}, name)
}

// Name returns the caller's username, or "".
func Name(ctx context.Context) string {
	if v, ok := ctx.Value(nameKey{}).(string); ok {
		return v
	}
	return ""
}

// From returns the user id on ctx, or "" in single-user mode.
func From(ctx context.Context) string {
	if v, ok := ctx.Value(key{}).(string); ok {
		return v
	}
	return ""
}

// Role returns the caller's role, or "" in single-user mode.
func Role(ctx context.Context) string {
	if v, ok := ctx.Value(roleKey{}).(string); ok {
		return v
	}
	return ""
}

// IsAdmin is true for an admin caller. Single-user mode ("" role) also counts
// as admin — there's only one operator and they own the box.
func IsAdmin(ctx context.Context) bool {
	r := Role(ctx)
	return r == "" || r == "admin"
}
