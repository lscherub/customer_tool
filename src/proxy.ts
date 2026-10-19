import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Server-side authentication gate (Next 16 `proxy` convention — middleware.ts
 * is deprecated). Runs before every protected page render, so direct URL
 * access and refreshes are redirected just like navigation links.
 *
 * This validates the Supabase session cookie against the auth server. It is
 * the UI-layer gate; the real data boundary is Supabase RLS (authenticated
 * role only) plus the admin-checked RPCs for destructive operations.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;

  // Without Supabase configuration there is no authentication at all:
  // never fall back to local data, always land on the sign-in page.
  if (!url || !anon) {
    if (path === '/signin') return NextResponse.next({ request });
    return redirect(request, '/signin');
  }

  const supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // Important: getUser() verifies the token with the Supabase auth server,
  // and refreshes the session (writing updated cookies to the response) when
  // the access token has expired but the refresh token is still valid.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    if (path === '/signin') return supabaseResponse;
    return redirect(request, '/signin');
  }
  if (path === '/signin' || path === '/') {
    // Authenticated users never see the sign-in page; dashboard is the home.
    if (path === '/signin') return redirect(request, '/');
  }
  return supabaseResponse;
}

function redirect(request: NextRequest, to: string): NextResponse {
  const r = NextResponse.redirect(new URL(to + (request.nextUrl.search ?? ''), request.url));
  return r;
}

export const config = {
  // Protect every route except API routes, Next internals and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};