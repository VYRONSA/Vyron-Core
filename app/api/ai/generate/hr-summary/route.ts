import { NextRequest } from "next/server";
import { handleGenerateRequest } from "@/app/api/ai/generate/_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleGenerateRequest(request, "hr_summary");
}
