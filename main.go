package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"einsatzplaner/einsatzplan/service"
	"einsatzplaner/einsatzplan/storage"
)

// Version is set at build time via -ldflags "-X main.Version=v1.2.3".
var Version = "dev"

//go:embed all:frontend
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

func main() {
	store := &storage.JSONStore{}
	planner := service.NewPlannerService(nil, nil, store)
	planner.SetVersion(Version)

	app := application.New(application.Options{
		Name:        "Einsatzplaner",
		Description: "Einsatzplaner für Vereine, GZs und kleine Teams",
		Icon:        appIcon,
		Services: []application.Service{
			application.NewService(planner),
		},
		Assets: application.AssetOptions{
			Handler: newAssetHandler(assets),
		},
	})

	// Inject app reference now that it's fully constructed.
	planner.SetApp(app)

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:           "Einsatzplaner",
		Width:           1280,
		Height:          860,
		MinWidth:        900,
		MinHeight:       600,
		InitialPosition: application.WindowCentered,
		StartState:      application.WindowStateNormal,
	})
	planner.SetWindow(win)

	// Guard against closing with unsaved changes.
	win.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !planner.IsDirtySync() {
			return
		}
		event.Cancel()

		dlg := app.Dialog.Question().
			SetTitle("Ungespeicherte Änderungen").
			SetMessage("Es gibt ungespeicherte Änderungen. Wirklich beenden?")

		cancelBtn := dlg.AddButton("Abbrechen")
		cancelBtn.SetAsCancel()

		quitBtn := dlg.AddButton("Beenden")
		quitBtn.OnClick(func() {
			planner.ClearDirty()
			win.Close()
		})

		dlg.Show()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
