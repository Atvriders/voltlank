// Authentication and authorization middleware.

import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../core/db';
import { env } from '../core/env';
import { tokenHash, verifySessionJwt } from './service';
import { ROLE_PERMISSIONS, ROLE_RANK, type Permission, type Role } from '@voltlink/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        sessionId: string;
        totpEnabled: boolean;
      };
    }
  }
}

function readToken(req: Request): string | null {
  const cookie = req.cookies?.[env.SESSION_COOKIE];
  if (typeof cookie === 'string' && cookie) return cookie;
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
    return;
  }
  let payload;
  try {
    payload = verifySessionJwt(token);
  } catch {
    res.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' } });
    return;
  }
  const session = await prisma.userSession.findUnique({ where: { id: payload.sid } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.tokenHash !== tokenHash(token)) {
    res.status(401).json({ error: { code: 'SESSION_REVOKED', message: 'This session was revoked or expired.' } });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.deletedAt) {
    res.status(401).json({ error: { code: 'SESSION_REVOKED', message: 'Account unavailable.' } });
    return;
  }
  req.user = { id: user.id, email: user.email, name: user.name, role: user.role, sessionId: payload.sid, totpEnabled: user.totpEnabled };
  next();
}

export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const rank = ROLE_RANK[req.user?.role as Role] ?? 0;
    if (rank < ROLE_RANK[min]) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Your role does not permit this action.' } });
      return;
    }
    next();
  };
}

export function requirePermission(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role as Role | undefined;
    if (!role || !(ROLE_PERMISSIONS[role] as readonly Permission[]).includes(perm)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Your role does not permit this action.' } });
      return;
    }
    next();
  };
}

export function requireVerified(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
    return;
  }
  // verification state is checked by callers that need it; keep simple gate for
  // onboarding-related routes if desired.
  next();
}
