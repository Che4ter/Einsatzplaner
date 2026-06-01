package main

// FirestoreProjectID and FirestoreAPIKey are injected at build time via:
//
//	-ldflags "-X main.FirestoreProjectID=my-proj -X main.FirestoreAPIKey=AIza..."
//
// When either is empty the app runs in local-only mode and cloud features are
// hidden from the UI.  The API key is designed to be public (Firebase's own
// security model); the real secret is the UUID room code held by the user.
var FirestoreProjectID string
var FirestoreAPIKey string
