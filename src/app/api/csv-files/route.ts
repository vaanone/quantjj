import { NextResponse } from "next/server";
import { fetchFile, useVps } from "@/lib/csv-source";

export const dynamic = "force-dynamic";

// Downloads a single CSV file from the configured source (VPS if
// CSV_BASE_URL is set, otherwise Google Drive).
//
// Query params:
//   name       — the CSV file name (required for VPS; also used for display).
//   id         — the Drive file ID (only used by the Drive fallback).
//   forceFresh — "1" to bypass the in-memory cache and re-download from the
//                source. Used by the polling loop after it detected a
//                modifiedTime change, so an updated CSV is actually fetched
//                instead of serving the stale cached copy.
//
// Serves from an in-memory cache first, then the source, with a stale-cache
// fallback so the chart stays usable if the VPS is briefly unreachable.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name") || "unknown.csv";
  const id = searchParams.get("id") || name; // VPS: id == name; Drive: real id
  const forceFresh = searchParams.get("forceFresh") === "1";

  const result = await fetchFile({ id, name }, { forceFresh });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, source: useVps() ? "vps" : "drive" },
      { status: 503 },
    );
  }

  return new NextResponse(result.content, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Csv-Cache": result.status,
      "X-Csv-Source": useVps() ? "vps" : "drive",
    },
  });
}
