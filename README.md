# TermCast

Web-based terminal secured by passkeys, powered by Bun.

## Installation

Install the latest release to `~/.local/bin/termcast`:

```sh
curl -fsSL https://raw.githubusercontent.com/gera2ld/termcast/main/scripts/install.sh | sh
```

The script downloads the release binary matching your platform (macOS or Linux, arm64 or x64), verifies its SHA-256 checksum against `version.txt`, decompresses it when needed, and strips the macOS quarantine attribute. Make sure `~/.local/bin` is on your `PATH`.

Or install it as a mise tool:

```sh
mise use github:gera2ld/termcast
```

Once installed, run `termcast update` to upgrade to the latest release.

## Why

- Passkeys are safe and convenient
- No more password login to servers
- No SSH server, daemon, or private keys to manage
- Commands run straight on the machine hosting TermCast via Bun's built-in pty
- Easy access to other servers with predefined commands

## Usage

- Run `termcast serve`, configure a reverse proxy to `http://localhost:9998` for HTTPS support.
- On your first run, you'll see a setup URL to initialize the server.
- You may also run `termcast grant` to get a short-lived login token or URL (expires in 5 minutes).

Note: HTTPS is required for passkeys, so you'll need to set up a reverse proxy to handle it.

## Use Case

TermCast runs each command you define directly on the machine hosting it — no SSH client, SSH server, or jump host involved. Every command is just a program and its arguments; TermCast launches it in a pty and streams the session to your browser.

After setting up TermCast, you can disable SSH password login entirely while keeping an easy-to-remember password for your Linux user. You can even block port 22 to lock down SSH, since TermCast is an HTTP service. And because commands run locally, defining them is trivial — create "Run Bash" (`bash`), "Attach to tmux" (`tmux -u2 new -A -s home`), or "Manage Server A" (`ssh serverA`), then manage everything from a single terminal window in your browser.
