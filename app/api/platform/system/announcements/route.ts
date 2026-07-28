import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase
    .from("platform_announcements")
    .select("*")
    .order("starts_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, announcements: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const title = body?.title ? String(body.title) : "";
  const bodyText = body?.body ? String(body.body) : "";
  if (!title || !bodyText) {
    return NextResponse.json({ ok: false, message: "title and body are required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("platform_announcements")
    .insert({
      title,
      body: bodyText,
      is_active: body.isActive !== false,
      ends_at: body.endsAt || null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "create",
    entityType: "platform_announcement",
    entityId: data.id,
    metadata: {},
  });

  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const id = body?.id ? String(body.id) : "";
  if (!id) return NextResponse.json({ ok: false, message: "id is required." }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if ("isActive" in (body || {})) updates.is_active = Boolean(body.isActive);
  if ("title" in (body || {})) updates.title = String(body.title);
  if ("body" in (body || {})) updates.body = String(body.body);

  const { error } = await supabase.from("platform_announcements").update(updates).eq("id", id);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "update",
    entityType: "platform_announcement",
    entityId: id,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
