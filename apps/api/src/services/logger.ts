/**
 * Lightweight structured logger.
 * Outputs JSON in production, coloured text in development.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const COLOURS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info:  '\x1b[32m', // green
  warn:  '\x1b[33m', // yellow
  error: '\x1b[31m'  // red
};
const RESET = '\x1b[0m';

const isProd = process.env.NODE_ENV === 'production';
const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (isProd ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[minLevel];
}

function formatProd(level: LogLevel, message: string, meta?: object): string {
  return JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {})
  });
}

function formatDev(level: LogLevel, message: string, meta?: object): string {
  const colour = COLOURS[level];
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const label = level.toUpperCase().padEnd(5);
  const suffix = meta && Object.keys(meta).length > 0
    ? `  ${JSON.stringify(meta)}`
    : '';
  return `${colour}${ts} ${label}${RESET} ${message}${suffix}`;
}

function write(level: LogLevel, message: string, meta?: object) {
  if (!shouldLog(level)) return;
  const line = isProd
    ? formatProd(level, message, meta)
    : formatDev(level, message, meta);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (message: string, meta?: object) => write('debug', message, meta),
  info:  (message: string, meta?: object) => write('info',  message, meta),
  warn:  (message: string, meta?: object) => write('warn',  message, meta),
  error: (message: string, meta?: object | unknown) => {
    // Accept Error objects gracefully
    if (meta instanceof Error) {
      write('error', message, { error: meta.message, stack: isProd ? undefined : meta.stack });
    } else {
      write('error', message, meta as object | undefined);
    }
  }
};
