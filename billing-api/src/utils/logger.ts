/**
 * Logger utility using Pino
 */
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

let transport: pino.DestinationStream | undefined;
try {
  transport = pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  });
} catch {
  // pino-pretty not available, use default
}

const rootLogger = transport ? pino({ level }, transport) : pino({ level });

export function createLogger(name: string) {
  return rootLogger.child({ name });
}

export { rootLogger as logger };
