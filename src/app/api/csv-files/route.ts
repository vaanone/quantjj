import { NextResponse } from "next/server";
import { listFiles, useVps } from "@/lib/csv-source";

export const dynamic = "force-dynamic";

// Lists CSV files from the configured source: the Amazon VPS (HTTP) when
// CSV_BASE_URL is set, otherwise Google Drive. The response shape is the
// same either way: { files: [{ id, name, modifiedTime }] }.
export async function GET() {
  const { files, error } = await listFiles();
  if (error && files.length === 0) {
    return NextResponse.json(
      { error, source: useVps() ? "vps" : "drive", files: [] },
      { status: 500 },
    );
  }
  return NextResponse.json({ files, source: useVps() ? "vps" : "drive" });
}
