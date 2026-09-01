package mcp

import (
	"context"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/userctx"
)

// owns verifies the context user may address server id (U2). A cached session
// is keyed only by id, so entry points that don't already go through
// store.Get must call this first.
func (m *Manager) owns(ctx context.Context, id string) error {
	_, err := m.store.Get(userctx.From(ctx), id)
	return err
}

// rpCacheTTL matches toolCacheTTL — resources/prompts lists are cheap but a
// server that lists slowly shouldn't be hit on every keystroke.
const rpCacheTTL = 60 * time.Second

// ensure returns a live connection for id, connecting if needed.
func (m *Manager) ensure(ctx context.Context, id string) (*conn, error) {
	m.mu.Lock()
	c := m.conns[id]
	m.mu.Unlock()
	if c != nil {
		return c, nil
	}
	if _, err := m.Connect(ctx, id); err != nil {
		return nil, err
	}
	m.mu.Lock()
	c = m.conns[id]
	m.mu.Unlock()
	if c == nil {
		return nil, apierr.Unreachable("mcp server not connected")
	}
	return c, nil
}

func serverCaps(c *conn) *sdk.ServerCapabilities {
	if ir := c.session.InitializeResult(); ir != nil {
		return ir.Capabilities
	}
	return nil
}

// refreshRP re-lists resources + prompts for a connected server and caches
// them. A server that doesn't advertise a capability yields an empty slice,
// not an error.
func (m *Manager) refreshRP(ctx context.Context, id string, cfg *ServerConfig, c *conn) error {
	lctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	caps := serverCaps(c)

	var (
		resources []ResourceSpec
		templates []ResourceTemplateSpec
		prompts   []PromptSpec
	)

	if caps != nil && caps.Resources != nil {
		rl, err := c.session.ListResources(lctx, nil)
		if err != nil {
			return apierr.Upstream("mcp resources/list: " + err.Error())
		}
		for _, r := range rl.Resources {
			resources = append(resources, ResourceSpec{
				Server: cfg.ID, ServerName: cfg.Name,
				URI: r.URI, Name: r.Name, Title: r.Title,
				Description: r.Description, MIMEType: r.MIMEType, Size: r.Size,
			})
		}
		tl, err := c.session.ListResourceTemplates(lctx, nil)
		if err == nil { // templates are optional even when resources are supported
			for _, t := range tl.ResourceTemplates {
				templates = append(templates, ResourceTemplateSpec{
					Server: cfg.ID, ServerName: cfg.Name,
					URITemplate: t.URITemplate, Name: t.Name, Title: t.Title,
					Description: t.Description, MIMEType: t.MIMEType,
				})
			}
		}
	}

	if caps != nil && caps.Prompts != nil {
		pl, err := c.session.ListPrompts(lctx, nil)
		if err != nil {
			return apierr.Upstream("mcp prompts/list: " + err.Error())
		}
		for _, p := range pl.Prompts {
			spec := PromptSpec{
				Server: cfg.ID, ServerName: cfg.Name,
				Name: p.Name, Title: p.Title, Description: p.Description,
			}
			for _, a := range p.Arguments {
				spec.Arguments = append(spec.Arguments, PromptArgSpec{
					Name: a.Name, Description: a.Description, Required: a.Required,
				})
			}
			prompts = append(prompts, spec)
		}
	}

	m.mu.Lock()
	c.resources = resources
	c.templates = templates
	c.prompts = prompts
	c.rpAt = time.Now()
	m.mu.Unlock()
	m.markRP(id, len(resources), len(prompts))
	return nil
}

// rpFor returns the cached resources/prompts for a server, refreshing if the
// cache is cold or stale.
func (m *Manager) rpFor(ctx context.Context, id string) (*conn, *ServerConfig, error) {
	cfg, err := m.store.Get(userctx.From(ctx), id)
	if err != nil {
		return nil, nil, err
	}
	c, err := m.ensure(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	m.mu.Lock()
	stale := c.rpAt.IsZero() || time.Since(c.rpAt) >= rpCacheTTL
	m.mu.Unlock()
	if stale {
		if err := m.refreshRP(ctx, id, cfg, c); err != nil {
			return nil, nil, err
		}
	}
	return c, cfg, nil
}

// Resources returns one server's concrete resources + templates.
func (m *Manager) Resources(ctx context.Context, id string) ([]ResourceSpec, []ResourceTemplateSpec, error) {
	c, _, err := m.rpFor(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return c.resources, c.templates, nil
}

// Prompts returns one server's prompt templates.
func (m *Manager) Prompts(ctx context.Context, id string) ([]PromptSpec, error) {
	c, _, err := m.rpFor(ctx, id)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return c.prompts, nil
}

// AggregateResources lists resources + templates across every enabled server.
// A server that fails is skipped (its error surfaces only if all fail).
func (m *Manager) AggregateResources(ctx context.Context) ([]ResourceSpec, []ResourceTemplateSpec, error) {
	servers, err := m.store.List(userctx.From(ctx))
	if err != nil {
		return nil, nil, err
	}
	var (
		res     []ResourceSpec
		tmpl    []ResourceTemplateSpec
		lastErr error
		tried   int
	)
	for _, s := range servers {
		if !s.Enabled {
			continue
		}
		tried++
		r, t, err := m.Resources(ctx, s.ID)
		if err != nil {
			lastErr = err
			continue
		}
		res = append(res, r...)
		tmpl = append(tmpl, t...)
	}
	if len(res) == 0 && len(tmpl) == 0 && tried > 0 && lastErr != nil {
		return nil, nil, lastErr
	}
	return res, tmpl, nil
}

// AggregatePrompts lists prompts across every enabled server.
func (m *Manager) AggregatePrompts(ctx context.Context) ([]PromptSpec, error) {
	servers, err := m.store.List(userctx.From(ctx))
	if err != nil {
		return nil, err
	}
	var (
		out     []PromptSpec
		lastErr error
		tried   int
	)
	for _, s := range servers {
		if !s.Enabled {
			continue
		}
		tried++
		p, err := m.Prompts(ctx, s.ID)
		if err != nil {
			lastErr = err
			continue
		}
		out = append(out, p...)
	}
	if len(out) == 0 && tried > 0 && lastErr != nil {
		return nil, lastErr
	}
	return out, nil
}

// ReadResource fetches one resource's text content, capped.
func (m *Manager) ReadResource(ctx context.Context, id, uri string) (ResourceRead, error) {
	if err := m.owns(ctx, id); err != nil {
		return ResourceRead{}, err
	}
	c, err := m.ensure(ctx, id)
	if err != nil {
		return ResourceRead{}, err
	}
	res, err := c.session.ReadResource(ctx, &sdk.ReadResourceParams{URI: uri})
	if err != nil {
		return ResourceRead{}, apierr.Upstream("mcp resources/read: " + err.Error())
	}
	out := ResourceRead{}
	for _, ct := range res.Contents {
		if ct == nil {
			continue
		}
		text := ct.Text
		if len(text) > maxResultBytes {
			text = text[:maxResultBytes]
			out.Truncated = true
		}
		out.Contents = append(out.Contents, ResourceContent{
			URI: ct.URI, MIMEType: ct.MIMEType, Text: text,
		})
	}
	return out, nil
}

// GetPrompt renders a server prompt with the given string arguments.
func (m *Manager) GetPrompt(ctx context.Context, id, name string, args map[string]string) (PromptResult, error) {
	if err := m.owns(ctx, id); err != nil {
		return PromptResult{}, err
	}
	c, err := m.ensure(ctx, id)
	if err != nil {
		return PromptResult{}, err
	}
	res, err := c.session.GetPrompt(ctx, &sdk.GetPromptParams{Name: name, Arguments: args})
	if err != nil {
		return PromptResult{}, apierr.Upstream("mcp prompts/get: " + err.Error())
	}
	out := PromptResult{Description: res.Description}
	for _, msg := range res.Messages {
		if msg == nil {
			continue
		}
		out.Messages = append(out.Messages, PromptMessage{
			Role: string(msg.Role),
			Text: promptText(msg.Content),
		})
	}
	return out, nil
}

// promptText flattens a prompt message's content to text. Embedded resources
// contribute their text prefixed with the source URI.
func promptText(content sdk.Content) string {
	switch v := content.(type) {
	case *sdk.TextContent:
		return v.Text
	case *sdk.EmbeddedResource:
		if v.Resource != nil {
			if v.Resource.URI != "" {
				return "> from " + v.Resource.URI + "\n\n" + v.Resource.Text
			}
			return v.Resource.Text
		}
	}
	return ""
}
