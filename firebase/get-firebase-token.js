#!/usr/bin/env node
// get-firebase-token.js — print a valid Google OAuth2 access token for the
// currently logged-in firebase-tools account.
//
// Strategy:
//   1. Read the refresh_token from the firebase-tools configstore.
//   2. Exchange it for a fresh access_token via the Google OAuth2 endpoint.
//   3. Print the access_token to stdout (one line, no trailing newline).
//
// Requires: firebase-tools installed globally (npm install -g firebase-tools)
//           and `firebase login` completed.
'use strict';

const https = require('https');
const path  = require('path');

// Resolve firebase-tools installation next to this script, or fall back to
// the global npm prefix locations.
function resolveFirebaseTools() {
  const candidates = [
    // Global npm on most Linux setups
    '/home/' + (process.env.USER || '') + '/.local/lib/node_modules/firebase-tools',
    '/usr/lib/node_modules/firebase-tools',
    '/usr/local/lib/node_modules/firebase-tools',
  ];
  for (const c of candidates) {
    try { require.resolve(path.join(c, 'package.json')); return c; } catch {}
  }
  // Last resort: hope it's on NODE_PATH
  return 'firebase-tools';
}

const ftBase = resolveFirebaseTools();

// firebase-tools bundles its own copy of configstore.
let Configstore;
try {
  Configstore = require(path.join(ftBase, 'node_modules/configstore'));
} catch {
  Configstore = require('configstore');
}

// Read stored tokens.
const store = new Configstore('firebase-tools');

// Support two storage layouts used by different firebase-tools versions.
let refreshToken = store.get('tokens.refresh_token')
  || (store.get('tokens') || {}).refresh_token;

// Newer versions store the default account under 'user.tokens'.
if (!refreshToken) {
  const user = store.get('user');
  refreshToken = user && user.tokens && user.tokens.refresh_token;
}

if (!refreshToken) {
  process.stderr.write(
    'No firebase-tools refresh token found. Run: firebase login\n'
  );
  process.exit(1);
}

// OAuth2 client credentials used by firebase-tools (public, not secret).
const api = require(path.join(ftBase, 'lib/api'));
const clientId     = api.clientId     ? api.clientId()     : '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const clientSecret = api.clientSecret ? api.clientSecret() : '';

const body = new URLSearchParams({
  client_id:     clientId,
  client_secret: clientSecret,
  refresh_token: refreshToken,
  grant_type:    'refresh_token',
}).toString();

const req = https.request(
  {
    hostname: 'oauth2.googleapis.com',
    path:     '/token',
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(data); } catch {
        process.stderr.write('Invalid JSON response from token endpoint\n');
        process.exit(1);
      }
      if (parsed.access_token) {
        process.stdout.write(parsed.access_token);
      } else {
        process.stderr.write(
          'Token refresh failed: ' + (parsed.error_description || parsed.error || data) + '\n'
        );
        process.exit(1);
      }
    });
  }
);

req.on('error', (e) => {
  process.stderr.write('Network error: ' + e.message + '\n');
  process.exit(1);
});

req.write(body);
req.end();
