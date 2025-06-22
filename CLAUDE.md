# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Run the server
```bash
bun run src/index.ts
```
Server runs on port specified in .env (default 8091). Creates `tubely.db` SQLite database and `assets/` directory on first run.

### Download sample files
```bash
./samplesdownload.sh
```

### Environment setup
```bash
cp .env.example .env
# Edit .env with your configuration values
```

## Architecture Overview

**Technology Stack**: TypeScript, Bun runtime, SQLite, AWS S3 integration

**Entry Point**: `src/index.ts` - Bun HTTP server with route definitions

**Core Structure**:
- `src/config.ts` - Environment configuration and database initialization
- `src/db/` - Database layer with SQLite schema and operations
- `src/api/` - HTTP handlers organized by domain (auth, videos, users, etc.)
- `src/app/` - Frontend SPA files (HTML, CSS, JS)

**Database**: SQLite with three main tables: users, refresh_tokens, videos. Auto-migration on startup via `src/db/db.ts:autoMigrate`.

**Authentication**: JWT-based with refresh tokens stored in database. Handlers in `src/api/auth.ts`.

**File Storage**: Local assets directory with S3 integration for video/thumbnail uploads. Video processing requires FFMPEG in PATH.

**Configuration**: All config loaded from environment variables via `src/config.ts:envOrThrow`. Required vars: DB_PATH, JWT_SECRET, PLATFORM, FILEPATH_ROOT, ASSETS_ROOT, S3_BUCKET, S3_REGION, S3_CF_DISTRO, PORT.

**API Routes**: RESTful endpoints for user management, video metadata, file uploads, and admin operations. All routes use `withConfig` middleware wrapper.