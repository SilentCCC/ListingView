import type { Request, Response, NextFunction } from 'express';

export function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => unknown) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function httpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}
