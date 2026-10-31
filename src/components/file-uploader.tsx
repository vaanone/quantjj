"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseFile, type ParseResult } from "@/lib/excel-parser";
import { toast } from "sonner";

interface FileUploaderProps {
  onLoaded: (result: ParseResult, fileName: string) => void;
  compact?: boolean;
}

export function FileUploader({ onLoaded, compact = false }: FileUploaderProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const allowed = [".xlsx", ".xls", ".csv", ".tsv", ".txt"];
      const lower = file.name.toLowerCase();
      if (!allowed.some((ext) => lower.endsWith(ext))) {
        toast.error("Unsupported file type", {
          description: "Please upload .xlsx, .xls, .csv or .tsv",
        });
        return;
      }

      setLoading(true);
      try {
        const result = await parseFile(file);
        if (result.candles.length === 0) {
          toast.error("No candles found", {
            description: result.warnings[0] ?? "The file appears to be empty or unreadable.",
          });
          return;
        }
        if (result.warnings.length > 0) {
          toast.warning("Parsed with warnings", { description: result.warnings[0] });
        }
        onLoaded(result, file.name);
        toast.success(`Loaded ${result.candles.length} candles`, {
          description: `${result.symbol || file.name}`,
        });
      } catch (err) {
        console.error(err);
        toast.error("Failed to parse file", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setLoading(false);
      }
    },
    [onLoaded],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  if (compact) {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Upload Excel/CSV
        </Button>
      </>
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
        accept=".xlsx,.xls,.csv,.tsv,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
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
            {loading ? "Parsing..." : "Drop your MT5 Excel / CSV file here"}
          </p>
          <p className="mt-1 text-xs text-white/50">
            Supports .xlsx, .xls, .csv — MT5 History Center &amp; standard exports
          </p>
        </div>
      </div>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/40">
        <AlertCircle className="h-3 w-3" />
        Required columns: Date, Open, High, Low, Close (Volume optional)
      </p>
    </div>
  );
}
