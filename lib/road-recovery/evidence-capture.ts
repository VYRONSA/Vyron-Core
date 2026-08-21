"use client";

/**
 * Browser-side evidence capture: upload the bytes, then record the fact.
 *
 * ONE capture path, shared by the requirements checklist, the driver's job card and the
 * custody panel, so all three produce identical rows and there is a single place where the
 * storage-path convention lives.
 *
 * WHY THE BROWSER UPLOADS DIRECTLY
 *
 * The `rr-evidence` bucket (sql/072) is private, and its INSERT policy allows a write only
 * where the FIRST path segment is one of the caller's own companies:
 *
 *     <company_id>/<service_job_id>/<file>
 *
 * Uploading under the user's own session is what makes that policy the thing that enforces
 * tenancy. Routing the bytes through a server route would replace a policy the database
 * checks with a check the application would have to remember to make, and would push
 * multi-megabyte photographs through a serverless function for no benefit.
 *
 * The server therefore receives only the resulting PATH. A forged path gains nothing: the
 * upload that would have put a file there was already refused.
 *
 * GPS is attached where the device offers it and omitted where it does not. It is never
 * invented, and a refusal to share location never blocks the capture — a photograph with
 * no coordinates is still evidence, and the requirement that specifically wants a verified
 * position is `gps_arrival`, which has its own flow.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase";
import { rrFetchJson } from "@/lib/road-recovery/use-rr-poll";

export const RR_EVIDENCE_BUCKET = "rr-evidence";

/** What the capture endpoint answers. */
export type CaptureResult = {
  evidenceId: string;
  linked: string[];
  skipped: string[];
  linkError: string | null;
};

export type CaptureInput = {
  companyId: string;
  serviceJobId: string;
  /** Omit for a note-only capture (a recorded detail such as an engine number). */
  file?: File | null;
  requirementCodes?: string[];
  notes?: string | null;
  evidenceType?: "rr_requirement" | "rr_custody";
  capturedByRole?: string;
  /** Attach the device position when it is available. Off for note-only captures. */
  withGps?: boolean;
  metadata?: Record<string, unknown>;
};

function safeName(name: string): string {
  // Storage keys are path segments: keep this conservative rather than clever.
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(-80);
  return cleaned || "evidence";
}

async function readPosition(): Promise<{
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { latitude: null, longitude: null, accuracy: null };
  }
  return new Promise((resolve) => {
    const give = () => resolve({ latitude: null, longitude: null, accuracy: null });
    const timer = setTimeout(give, 8000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
        });
      },
      () => {
        clearTimeout(timer);
        give();
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
    );
  });
}

export async function captureEvidence(input: CaptureInput): Promise<CaptureResult> {
  let storagePath: string | null = null;

  if (input.file) {
    const supabase = getSupabaseBrowserClient();
    // The path IS the tenant key — see the policy quoted above.
    storagePath = `${input.companyId}/${input.serviceJobId}/${Date.now()}-${safeName(input.file.name)}`;

    const { error } = await supabase.storage
      .from(RR_EVIDENCE_BUCKET)
      .upload(storagePath, input.file, {
        // Evidence is never overwritten. A second capture is a second item.
        upsert: false,
        contentType: input.file.type || "application/octet-stream",
      });

    if (error) {
      throw new Error(
        `The file could not be stored, so nothing was recorded: ${error.message}`
      );
    }
  }

  const position = input.withGps === false ? { latitude: null, longitude: null, accuracy: null } : await readPosition();

  try {
    return await rrFetchJson<CaptureResult>(
      `/api/road-recovery/jobs/${input.serviceJobId}/evidence`,
      {
        method: "POST",
        body: JSON.stringify({
          companyId: input.companyId,
          evidenceType: input.evidenceType || "rr_requirement",
          capturedByRole: input.capturedByRole || "controller",
          requirementCodes: input.requirementCodes || [],
          storagePath,
          notes: input.notes || null,
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          metadata: {
            ...(input.metadata || {}),
            ...(input.file
              ? { fileName: input.file.name, contentType: input.file.type, sizeBytes: input.file.size }
              : {}),
          },
        }),
      }
    );
  } catch (error: unknown) {
    // The bytes are stored but the record failed. Say so plainly rather than reporting a
    // clean failure — the object exists, and a retry creates a second one.
    const detail = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      storagePath
        ? `The file uploaded but the evidence record failed: ${detail}. Nothing was linked to the requirement; retry to record it again.`
        : detail
    );
  }
}

/** A signed URL for viewing a stored item. Private bucket: links are short-lived. */
export async function evidenceViewUrl(storagePath: string, seconds = 300): Promise<string | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.storage
      .from(RR_EVIDENCE_BUCKET)
      .createSignedUrl(storagePath, seconds);
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}
