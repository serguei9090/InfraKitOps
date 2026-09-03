package server

import (
	"io"
	"net/http"
	"path"
	"strings"
)

// StaticHandler serves the built web frontend from dir and delegates every
// /api/* request to next (the API router from NewRouter). It is meant to wrap
// the API handler for a hosted web deployment (DEPLOY_PLAN.md D0):
//
//   - /api/*                → next, unchanged (auth middleware still applies)
//   - an existing file      → served from dir; hashed /assets/* get a long
//     immutable cache, everything else no-cache
//   - anything else with no
//     file extension        → index.html (SPA history fallback)
//   - a missing file with
//     an extension          → 404
//
// Static assets are intentionally NOT behind the API's auth middleware: the
// shell and its JS load before the user has a session and authenticate against
// /api/v1 from the browser.
func StaticHandler(dir string, next http.Handler) http.Handler {
	root := http.Dir(dir)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			// No static resource answers a POST/PUT/… — let the API layer
			// produce the 404/405 with its normal error shape.
			next.ServeHTTP(w, r)
			return
		}

		clean := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
		if hasDotSegment(clean) {
			http.NotFound(w, r)
			return
		}

		if f, err := root.Open(clean); err == nil {
			defer f.Close()
			if st, serr := f.Stat(); serr == nil && !st.IsDir() {
				setStaticCache(w, clean)
				if rs, ok := f.(io.ReadSeeker); ok {
					http.ServeContent(w, r, st.Name(), st.ModTime(), rs)
					return
				}
			}
		}

		// SPA fallback: a route the client router owns (no file extension).
		if path.Ext(clean) == "" {
			serveIndex(w, r, root)
			return
		}
		http.NotFound(w, r)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, root http.Dir) {
	f, err := root.Open("/index.html")
	if err != nil {
		http.Error(w, "frontend not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.Error(w, "frontend not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if rs, ok := f.(io.ReadSeeker); ok {
		http.ServeContent(w, r, "index.html", st.ModTime(), rs)
	}
}

// setStaticCache marks Vite's content-hashed assets immutable and keeps
// everything else revalidated so a redeploy is picked up promptly.
func setStaticCache(w http.ResponseWriter, p string) {
	if strings.HasPrefix(p, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
}

// hasDotSegment reports whether any path segment starts with a dot (blocks
// /.git, /.env, dotfiles in general). http.Dir already blocks "..".
func hasDotSegment(p string) bool {
	for _, seg := range strings.Split(p, "/") {
		if strings.HasPrefix(seg, ".") && seg != "." {
			return true
		}
	}
	return false
}
