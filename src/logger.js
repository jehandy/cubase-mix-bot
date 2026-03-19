/**
 * File-based logger utility
 *
 * Creates per-service loggers that write to Logs/<service>.log
 * and mirror output to console.error (required by MCP stdio transport).
 *
 * Log level controlled via LOG_LEVEL env var (default: 'info').
 * Uses async file writes to avoid blocking the event loop.
 */

import { appendFile, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'Logs');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

let dirCreated = false;

function ensureLogsDir() {
  if (!dirCreated) {
    mkdirSync(LOGS_DIR, { recursive: true });
    dirCreated = true;
  }
}

/**
 * Create a logger for a named service.
 * Writes to Logs/<service>.log and mirrors to console.error.
 */
export function createLogger(service) {
  const logFile = join(LOGS_DIR, `${service}.log`);

  function write(level, msg) {
    if (LEVELS[level] < minLevel) return;
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
    console.error(line);
    ensureLogsDir();
    appendFile(logFile, line + '\n', () => {});
  }

  return {
    info:  (msg) => write('info',  msg),
    warn:  (msg) => write('warn',  msg),
    error: (msg) => write('error', msg),
    debug: (msg) => write('debug', msg),
  };
}
