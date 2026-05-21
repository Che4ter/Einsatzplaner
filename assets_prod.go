//go:build production

package main

import (
	"embed"
	"net/http"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// newAssetHandler serves frontend files from the embedded FS for production builds.
func newAssetHandler(assets embed.FS) http.Handler {
	return application.BundledAssetFileServer(assets)
}
