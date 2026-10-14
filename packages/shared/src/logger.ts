// A tiny JSON-lines logger for the workers. Services use Fastify's own logger.
// Logs carry IDs and error codes, never file contents.

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

export function createLogger(name: string, base: Fields = {}): Logger {
  const write = (level: Level, msg: string, fields?: Fields): void => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, name, msg, ...base, ...fields });
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
