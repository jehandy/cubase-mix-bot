/**
 * File-based logger utility
 *
 * Creates per-service loggers that write to Logs/<service>.log
 * and mirror output to console.error (required by MCP stdio transport).
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'Logs');

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
    const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
    console.error(line);
    ensureLogsDir();
    appendFileSync(logFile, line + '\n');
  }

  return {
    info:  (msg) => write('INFO',  msg),
    warn:  (msg) => write('WARN',  msg),
    error: (msg) => write('ERROR', msg),
    debug: (msg) => write('DEBUG', msg),
  };
}
