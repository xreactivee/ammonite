# ammonite

A modern SSH desktop environment built with TypeScript, React, Rust, and Tauri that connects to remote Linux servers, manages encrypted profiles, and handles secure SFTP and terminal sessions.

## Features
- Connects to remote Linux servers via SSH with support for encrypted profile persistence using SQLite and system keyring storage
- Validates and stores known host fingerprints to prevent man-in-the-middle attacks
- Renders an interactive desktop interface with terminal and SFTP file management capabilities
- Handles authentication errors, sudo requirements, and binary file checks dynamically

## Tech Stack
- TypeScript
- React
- Rust
- Tauri
- Tailwind CSS
- CodeMirror
- xterm.js
- Russh
- Rusqlite

## Installation
```bash
git clone https://github.com/xreactivee/ammonite.git
cd ammonite
npm install
npm run tauri dev
```

## Usage
Run `npm run tauri dev` to start the application in development mode or `npm run tauri build` to compile the desktop binary.

## License
MIT