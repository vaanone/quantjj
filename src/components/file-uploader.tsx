"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FolderOpen, FileSpreadsheet, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseFile, type ParseResult } from "@/lib/excel-parser";
import { toast } from "sonner";

interface FileUploaderProps {
  /** Called once per successfully parsed file. */
  onLoaded: (result: ParseResult, fileName: string) => void;
  compact?: boolean;
}

const ALLOWED_EXTS = [".xlsx", ".xls", ".csv", ".tsv", ".txt"];

function isAllowedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
}

export function FileUploader({ onLoaded, compact = false }: FileUploaderProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) => isAllowedFile(f.name));
      if (files.length === 0) {
        toast.error("No supported files", {
          description: `Allowed: ${ALLOWED_EXTS.join(", ")}`,
        });
        return;
      }

      setLoading(true);
      let successCount = 0;
      let failCount = 0;

      // Parse files sequentially to avoid blocking the UI on large folders.
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
      setLoading(false);
    },
    [onLoaded],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) handleFiles(files);
    },
    [handleFiles],
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {/* Hidden inputs */}
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_EXTS.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error — non-standard attributes for directory upload
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Files button (multi-select) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Files</span>
        </Button>

        {/* Folder button (pick a directory → all CSV/Excel inside) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => folderInputRef.current?.click()}
          disabled={loading}
          className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FolderOpen className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Folder</span>
        </Button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        group cursor-pointer rounded-xl border-2 border-dashed
        p-8 text-center transition-all
        ${dragging
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/5"}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_EXTS.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error — non-standard attributes for directory upload
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-full bg-white/5 p-3">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          ) : (
            <FileSpreadsheet className="h-6 w-6 text-emerald-400" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-white">
            {loading ? "Parsing..." : "Drop MT5 Excel / CSV files here"}
          </p>
          <p className="mt-1 text-xs text-white/50">
            Select multiple files or a whole folder — all loaded files appear in the dropdown
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          disabled={loading}
          className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          <Upload className="h-4 w-4" />
          Choose Files
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            folderInputRef.current?.click();
          }}
          disabled={loading}
          className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
        >
          <FolderOpen className="h-4 w-4" />
          Choose Folder
        </Button>
      </div>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/40">
        <AlertCircle className="h-3 w-3" />
        Required columns: Date, Open, High, Low, Close (Volume optional)
      </p>
    </div>
  );
}
