// middleware.ts (Next.js Root Middleware)
import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from './lib/auth/jwt';

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/forgot-password',
  '/login',
  '/register',
  '/forgot-password',
  '/health',
];

// Admin-only routes
const ADMIN_ROUTES = [
  '/api/v1/admin',
  '/settings/users',
  '/settings/roles',
];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const method = request.method;

  // CORS Handling
  if (method === 'OPTIONS') {
    return handleCors(request);
  }

  // Health Check
  if (pathname === '/health') {
    return NextResponse.json({ status: 'ok' });
  }

  // Skip middleware for public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Authentication Check
  const token = extractToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify JWT Token
  const payload = verifyAccessToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid Token' }, { status: 401 });
  }

  // Admin Routes Check
  if (ADMIN_ROUTES.some((route) => pathname.startsWith(route))) {
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Add user info to request headers
  const response = NextResponse.next();
  response.headers.set('X-User-Id', payload.sub);
  response.headers.set('X-User-Email', payload.email);
  response.headers.set('X-User-Role', payload.role);

  return response;
}

/**
 * Extract Token from Request
 */
function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return request.cookies.get('accessToken')?.value || null;
}

/**
 * Handle CORS
 */
function handleCors(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');

  if (allowedOrigins.includes(origin || '')) {
    return new NextResponse(null, {
      headers: {
        'Access-Control-Allow-Origin': origin!,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  return new NextResponse(null, { status: 403 });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
