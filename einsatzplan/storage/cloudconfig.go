package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// CloudConfig persists the last-used room code and year so the app can
// reconnect automatically on next launch.  It is stored at
// {UserConfigDir}/einsatzplan/cloud.json with 0600 permissions.
type CloudConfig struct {
	RoomCode string `json:"roomCode"`
	LastYear int    `json:"lastYear,omitempty"`
}

func cloudConfigPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "einsatzplan", "cloud.json"), nil
}

// LoadCloudConfig reads the persisted cloud config, or returns an empty one
// if the file does not exist yet.
func LoadCloudConfig() (*CloudConfig, error) {
	p, err := cloudConfigPath()
	if err != nil {
		return &CloudConfig{}, nil
	}
	data, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return &CloudConfig{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read cloud config: %w", err)
	}
	var cfg CloudConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse cloud config: %w", err)
	}
	return &cfg, nil
}

// SaveCloudConfig writes cfg atomically to disk.
func SaveCloudConfig(cfg *CloudConfig) error {
	p, err := cloudConfigPath()
	if err != nil {
		return fmt.Errorf("config dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".cloud-*.json")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("close: %w", err)
	}
	if err := os.Chmod(tmpPath, 0600); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod: %w", err)
	}
	if err := os.Rename(tmpPath, p); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// ClearCloudConfig removes the persisted cloud config file.
func ClearCloudConfig() {
	if p, err := cloudConfigPath(); err == nil {
		os.Remove(p)
	}
}
