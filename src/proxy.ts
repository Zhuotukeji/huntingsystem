import { NextRequest, NextResponse } from "next/server";

const sessionCookie = "hunting_session";

export function proxy(request: NextRequest) {
  if (!request.cookies.get(sessionCookie)?.value) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
