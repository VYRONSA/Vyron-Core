import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

// Redirecting an already-authenticated visitor away from auth routes is handled by
// middleware.ts (resolveServerAuthorizationContext + isAuthPath), which has the request
// pathname available and correctly exempts /reset-password so a password-recovery or
// invite-acceptance link still renders even when the browser already holds a session
// cookie for a different login. A duplicate check here can't see the pathname, so it
// can't make that exemption — keeping it here would either re-break /reset-password or
// require re-deriving the same routing decision twice. Middleware runs first for every
// request that reaches this layout, so this file only needs to provide the shared shell.
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-950">
      {children}
    </div>
  );
}
