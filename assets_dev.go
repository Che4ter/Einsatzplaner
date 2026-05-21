//go:build !production

package main

import (
	"embed"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// newAssetHandler serves frontend files from disk so edits are visible without rebuilding.
// Wails runtime assets are served by the bundled asset server under /wails/*.
func newAssetHandler(assets embed.FS) http.Handler {
	disk := http.FileServer(http.Dir("frontend"))
	bundled := application.BundledAssetFileServer(assets)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/wails/") {
			bundled.ServeHTTP(w, r)
			return
		}
		disk.ServeHTTP(w, r)
	})
}
