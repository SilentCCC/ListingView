import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { adminPassword } from './config.js';
import { httpError } from './http.js';

export interface AuthStatus {
  authenticated: boolean;
  passwordRequired: boolean;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;

const sessionSecret = crypto.randomBytes(32);
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function passwordDigest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function isPasswordMatch(candidate: string): boolean {
  if (!adminPassword) return true;
  return crypto.timingSafeEqual(passwordDigest(candidate), passwordDigest(adminPassword));
}

function signToken(expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt, v: passwordDigest(adminPassword).toString('hex').slice(0, 16) }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token: string): boolean {
  if (!adminPassword) return true;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature) return false;
  const expectedSig = crypto.createHmac('sha256', sessionSecret).update(payload).digest();
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number; v?: string };
    const expectedVersion = passwordDigest(adminPassword).toString('hex').slice(0, 16);
    return typeof parsed.exp === 'number' && parsed.exp > Date.now() && parsed.v === expectedVersion;
  } catch {
    return false;
  }
}

function extractToken(request: Request): string {
  const authHeader = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match?.[1]?.trim() || '';
}

function clientKey(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'local';
}

export function isAdminPasswordRequired(): boolean {
  return Boolean(adminPassword);
}

export function isRequestAuthenticated(request: Request): boolean {
  if (!adminPassword) return true;
  const token = extractToken(request);
  return Boolean(token && verifyToken(token));
}

export function getAuthStatus(request: Request): AuthStatus {
  return {
    authenticated: isRequestAuthenticated(request),
    passwordRequired: isAdminPasswordRequired(),
  };
}

export function loginAdmin(request: Request, passwordInput: unknown): { status: AuthStatus; token: string } {
  if (!adminPassword) {
    return {
      status: { authenticated: true, passwordRequired: false },
      token: '',
    };
  }
  const now = Date.now();
  const key = clientKey(request);
  const record = failedAttempts.get(key);
  if (record && record.resetAt <= now) {
    failedAttempts.delete(key);
  } else if (record && record.count >= MAX_FAILED_ATTEMPTS) {
    throw httpError(429, '密码尝试次数过多，请稍后再试');
  }

  const candidate = typeof passwordInput === 'string' ? passwordInput : '';
  if (!candidate || !isPasswordMatch(candidate)) {
    const active = failedAttempts.get(key);
    if (!active || active.resetAt <= now) {
      failedAttempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    } else {
      active.count += 1;
    }
    throw httpError(401, '管理员密码错误');
  }

  failedAttempts.delete(key);
  const token = signToken(now + SESSION_TTL_MS);
  return {
    status: { authenticated: true, passwordRequired: true },
    token,
  };
}

export function requireAdmin(request: Request, _response: Response, next: NextFunction): void {
  if (isRequestAuthenticated(request)) {
    next();
    return;
  }
  next(httpError(401, '需要输入管理员密码解锁后才能执行编辑操作'));
}
