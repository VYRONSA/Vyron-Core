import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase
    .from("platform_release_notes")
    .select("*")
    .order("released_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, releaseNotes: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const version = body?.version ? String(body.version) : "";
  const title = body?.title ? String(body.title) : "";
  if (!version || !title) {
    return NextResponse.json({ ok: false, message: "version and title are required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("platform_release_notes")
    .insert({ version, title, body: body.body ? String(body.body) : null })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "create",
    entityType: "platform_release_note",
    entityId: data.id,
    metadata: { version },
  });

  return NextResponse.json({ ok: true, id: data.id });
}
