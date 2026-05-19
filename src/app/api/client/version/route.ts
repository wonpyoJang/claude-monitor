import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Bump this when log-turn.py changes
export const CLIENT_VERSION = "1.1.0";

export async function GET() {
  return NextResponse.json({ version: CLIENT_VERSION });
}
