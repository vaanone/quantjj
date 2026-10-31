"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Cloud,
  Download,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseBuffer, type ParseResult } from "@/lib/excel-parser";
import { toast } from "sonner";

interface DriveFilePickerProps {
  /** Called once per successfully parsed file. */
  onLoaded: (result: ParseResult, fileName: string) => void;
  compact?: boolean;
}

interface DriveFile {
  id: string;
  name: string;
}

export function DriveFilePicker({ onLoaded, compact = false }: DriveFilePickerProps) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch the list of CSV files from our API route.
  const fetchFiles = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/drive-files");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch files");
        if (compact) {
          toast.error("Drive API not configured", {
            description: data.error?.slice(0, 120),
          });
        }
        return;
      }
      setFiles(data.files || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setLoadingList(false);
    }
  }, [compact]);

  // Fetch the file list on first mount.
  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Download and parse a single file.
  const loadFile = useCallback(
    async (file: DriveFile) => {
      setLoadingFile(file.id);
      try {
        const res = await fetch(
          `/api/drive-file?id=${file.id}&name=${encodeURIComponent(file.name)}`,
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Download failed" }));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const csvText = await res.text();
        // Parse the CSV using the same parser as file uploads.
        const encoder = new TextEncoder();
        const buffer = encoder.encode(csvText).buffer;
        const result = parseBuffer(buffer, file.name);
        if (result.candles.length === 0) {
          throw new Error(result.warnings[0] || "No candles found");
        }
        onLoaded(result, file.name);
        setLoadedIds((prev) => new Set(prev).add(file.id));
        toast.success(`Loaded ${file.name}`, {
          description: `${result.candles.length} candles · ${result.symbol || "—"}`,
        });
        setDropdownOpen(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Failed: ${file.name}`, { description: msg.slice(0, 120) });
      } finally {
        setLoadingFile(null);
      }
    },
    [onLoaded],
  );

  // Load all files at once.
  const loadAll = useCallback(async () => {
    for (const file of files) {
      if (loadedIds.has(file.id)) continue;
      await loadFile(file);
    }
  }, [files, loadedIds, loadFile]);

  // ====== Compact mode (header button + dropdown) ======
  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (files.length === 0 && !loadingList) fetchFiles();
              setDropdownOpen(!dropdownOpen);
            }}
            disabled={loadingList}
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            {loadingList ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Cloud className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Drive</span>
            {files.length > 0 && (
              <Badge className="ml-1 h-4 px-1 text-[9px] font-mono">{files.length}</Badge>
            )}
          </Button>
          {files.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={loadAll}
              disabled={loadingFile !== null}
              className="h-8 px-2 text-[11px] text-white/60 hover:text-white"
              title="Load all files"
            >
              {loadingFile ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>

        {/* Dropdown panel */}
        {dropdownOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-white/15 bg-[#15161d] p-2 shadow-xl">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
                Drive Files ({files.length})
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchFiles}
                disabled={loadingList}
                className="h-6 w-6 p-0 text-white/40 hover:text-white"
              >
                <RefreshCw className={`h-3 w-3 ${loadingList ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2 text-[11px] text-red-400">
                <AlertCircle className="mb-1 h-3 w-3" />
                {error.slice(0, 100)}
              </div>
            )}

            <div className="max-h-64 overflow-y-auto">
              {files.length === 0 && !loadingList && !error && (
                <p className="py-4 text-center text-[11px] text-white/40">
                  No CSV files found in the Drive folder.
                </p>
              )}
              {files.map((file) => {
                const isLoaded = loadedIds.has(file.id);
                const isLoading = loadingFile === file.id;
                return (
                  <button
                    key={file.id}
                    onClick={() => loadFile(file)}
                    disabled={isLoading}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-400" />
                    ) : isLoaded ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-white/40" />
                    )}
                    <span className="flex-1 truncate font-mono">{file.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ====== Full mode (empty state) ======
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
            Google Drive Files ({files.length})
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchFiles}
            disabled={loadingList}
            className="h-6 w-6 p-0 text-white/40 hover:text-white"
          >
            <RefreshCw className={`h-3 w-3 ${loadingList ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {error && (
          <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
            <AlertCircle className="mb-1 inline h-3 w-3" /> {error}
          </div>
        )}

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {loadingList && files.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching files from Drive…
            </div>
          )}
          {files.length === 0 && !loadingList && !error && (
            <p className="py-6 text-center text-xs text-white/40">
              No CSV files found in the Drive folder.
            </p>
          )}
          {files.map((file) => {
            const isLoaded = loadedIds.has(file.id);
            const isLoading = loadingFile === file.id;
            return (
              <button
                key={file.id}
                onClick={() => loadFile(file)}
                disabled={isLoading}
                className="flex w-full items-center gap-2 rounded-md border border-white/5 bg-white/[0.01] px-3 py-2 text-left text-xs text-white/80 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/[0.06] disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                ) : isLoaded ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-white/40" />
                )}
                <span className="flex-1 truncate font-mono">{file.name}</span>
                {isLoaded && (
                  <span className="text-[10px] text-emerald-400">loaded</span>
                )}
              </button>
            );
          })}
        </div>

        {files.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={loadAll}
            disabled={loadingFile !== null}
            className="mt-3 w-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            {loadingFile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Load All Files
          </Button>
        )}
      </div>

      <p className="text-[11px] text-white/40">
        CSV files · Required: Date, Open, High, Low, Close (Volume optional)
      </p>
    </div>
  );
}
