import { NextResponse } from "next/server";

// Google Drive folder ID (from the shared link).
const DRIVE_FOLDER_ID = "1ksSNA1o68VteTu4SGHfjpmtgKGVgJ9HC";

// API key — stored in environment variable for security.
// The user must set GOOGLE_DRIVE_API_KEY in .env.local
const API_KEY = process.env.GOOGLE_DRIVE_API_KEY || "";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string; // ISO 8601 timestamp from Drive API
}

/**
 * Lists all CSV files inside the configured Google Drive folder.
 * Uses the Google Drive API v3 files.list endpoint with an API key.
 *
 * The folder must be shared as "Anyone with the link can view" for
 * API-key access to work (no OAuth needed).
 */
export async function GET() {
  if (!API_KEY) {
    return NextResponse.json(
      {
        error: "GOOGLE_DRIVE_API_KEY is not set. Add it to .env.local",
        files: [],
      },
      { status: 500 },
    );
  }

  try {
    // Query: files in this folder, not trashed, CSV mime type or .csv extension.
    // Drive sometimes stores CSVs as text/csv, sometimes as application/vnd.google-apps.spreadsheet
    // (Google Sheets). We only want actual CSV files here.
    const query = encodeURIComponent(
      `'${DRIVE_FOLDER_ID}' in parents and trashed = false and ` +
        `(mimeType = 'text/csv' or mimeType = 'application/csv' or ` +
        `name contains '.csv')`,
    );

    const fields = encodeURIComponent(
      "files(id, name, mimeType, size, modifiedTime)",
    );

    const url =
      `https://www.googleapis.com/drive/v3/files?q=${query}` +
      `&fields=${fields}` +
      `&orderBy=name` +
      `&pageSize=200` +
      `&key=${API_KEY}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Drive API error: ${res.status} ${errText}`, files: [] },
        { status: res.status },
      );
    }

    const data = await res.json();

    // Filter to only .csv files (in case Drive returns non-CSV matches).
    const csvFiles: DriveFile[] = (data.files || []).filter(
      (f: DriveFile) => f.name.toLowerCase().endsWith(".csv"),
    );

    return NextResponse.json({
      files: csvFiles.map((f) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime || null,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to list Drive files: ${msg}`, files: [] },
      { status: 500 },
    );
  }
}
