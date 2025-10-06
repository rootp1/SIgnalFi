import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level,
  redact: {
    paths: ['req.headers.authorization'],
    remove: true
  },
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' }
  } : undefined
});

export function childLogger(bindings: Record<string, any>) {
  return logger.child(bindings);
}
