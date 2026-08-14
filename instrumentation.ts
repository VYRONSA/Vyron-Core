/**
 * Server startup hook.
 *
 * Runs the Platform Administrator reconciler so a fresh installation — or an
 * installation whose administrator account was deleted — heals itself without anyone
 * running SQL or editing Supabase by hand.
 *
 * Three deliberate properties:
 *
 *   1. It is a no-op on a healthy platform. The reconciler returns immediately unless
 *      there are ZERO platform operators, so a normal boot does no writes at all.
 *   2. It never blocks or fails startup. Provisioning problems are logged; the app
 *      still serves traffic, and the explicit recovery paths (POST
 *      /api/platform/bootstrap, npm run bootstrap:admin) remain available.
 *   3. It only runs in the Node.js runtime. Middleware runs on the Edge runtime, which
 *      has neither the service-role key nor the admin API.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Nothing configured means the operator has not declared an administrator, which is
  // a valid state (e.g. a deployment that manages operators purely from the Console).
  if (!process.env.PLATFORM_BOOTSTRAP_ADMIN_EMAIL) return;

  try {
    const [{ getSupabaseAdminClient }, { reconcilePlatformAdminOnBoot }] = await Promise.all([
      import("@/lib/server-api-auth"),
      import("@/lib/platform/platform-admin-provisioning"),
    ]);

    const result = await reconcilePlatformAdminOnBoot(getSupabaseAdminClient());
    if (!result) return; // Healthy: an operator already exists.

    if (result.ok) {
      console.log(`[platform-bootstrap] ${result.message}`);
    } else {
      console.error(`[platform-bootstrap] ${result.message}`);
    }
  } catch (error) {
    // Missing service-role key, unreachable database, build-time evaluation — none of
    // these should stop the server from starting.
    console.error(
      "[platform-bootstrap] Administrator reconcile skipped:",
      error instanceof Error ? error.message : error
    );
  }
}
