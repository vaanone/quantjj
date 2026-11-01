"use client";

import { Upload, FileSpreadsheet, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseFile, type ParseResult } from "@/lib/excel-parser";
import { toast } from "sonner";

interface FileUploaderProps {
  /** Called once per successfully parsed file. */
  onLoaded: (result: ParseResult, fileName: string) => void;
  compact?: boolean;
}

// Only CSV files are accepted.
const ALLOWED_EXTS = [".csv"];

function isAllowedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
}

// Google Drive folder containing the user's MT5 CSV files.
const DRIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/1ksSNA1o68VteTu4SGHfjpmtgKGVgJ9HC?usp=sharing";

export function FileUploader({ onLoaded, compact = false }: FileUploaderProps) {
  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => isAllowedFile(f.name));
    if (files.length === 0) {
      toast.error("No CSV files", {
        description: `Allowed: ${ALLOWED_EXTS.join(", ")}`,
      });
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
      try {
        const result = await parseFile(file);
        if (result.candles.length === 0) {
          failCount++;
          toast.error(`No candles in ${file.name}`, {
            description: result.warnings[0] ?? "File appears empty or unreadable.",
          });
          continue;
        }
        onLoaded(result, file.name);
        successCount++;
      } catch (err) {
        failCount++;
        console.error(`Failed to parse ${file.name}:`, err);
        toast.error(`Failed: ${file.name}`, {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    if (successCount > 0) {
      toast.success(`Loaded ${successCount} file${successCount > 1 ? "s" : ""}`, {
        description: failCount > 0 ? `${failCount} failed` : undefined,
      });
    }
  };

  // Compact mode (header): single "Drive" button that opens the Google Drive
  // folder in a new tab. Also keeps a hidden file input for drag-drop fallback.
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {/* Google Drive folder link */}
        <Button
          variant="outline"
          size="sm"
          asChild
          className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          <a href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">Drive</span>
          </a>
        </Button>
      </div>
    );
  }

  // Full mode (empty state): drag-drop + Google Drive link button.
  return (
    <div className="flex flex-col items-center gap-4">
      <Button
        variant="outline"
        size="sm"
        asChild
        className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
      >
        <a href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">
          <FileSpreadsheet className="h-4 w-4" />
          Open Google Drive Folder
        </a>
      </Button>
      <p className="text-[11px] text-white/40">
        CSV files · Required: Date, Open, High, Low, Close (Volume optional)
      </p>
    </div>
  );
}
