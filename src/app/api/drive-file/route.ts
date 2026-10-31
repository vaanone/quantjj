import { NextResponse } from "next/server";

// API key — stored in environment variable for security.
const API_KEY = process.env.GOOGLE_DRIVE_API_KEY || "";

/**
 * Downloads a specific CSV file from Google Drive by its file ID.
 * Uses the Drive API v3 files.get endpoint with alt=media to get the raw
 * file content.
 *
 * Query params:
 *   id — the Google Drive file ID (required)
 *   name — the file name (optional, used for display)
 */
export async function GET(request: Request) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_DRIVE_API_KEY is not set. Add it to .env.local" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("id");
  const fileName = searchParams.get("name") || "unknown.csv";

  if (!fileId) {
    return NextResponse.json(
      { error: "Missing required parameter: id" },
      { status: 400 },
    );
  }

  try {
    // Download the file content (alt=media returns the raw bytes).
    const url =
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;

    const res = await fetch(url);

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Drive API error: ${res.status} ${errText}` },
        { status: res.status },
      );
    }

    // Get the CSV text content.
    const csvText = await res.text();

    // Return as a downloadable CSV response so the client can parse it.
    return new NextResponse(csvText, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to download file: ${msg}` },
      { status: 500 },
    );
  }
}
