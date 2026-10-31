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

// How often to poll the Drive folder for new files (ms).
const POLL_INTERVAL = 30000; // 30 seconds

export function DriveFilePicker({ onLoaded, compact = false }: DriveFilePickerProps) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Track whether we've done the initial auto-load so we don't repeat it.
  const hasAutoLoadedRef = useRef(false);
  // Keep latest `files` and `loadedIds` in refs so the poll interval can read
  // fresh values without re-subscribing every render.
  const filesRef = useRef<DriveFile[]>([]);
  const loadedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { loadedIdsRef.current = loadedIds; }, [loadedIds]);

  // Fetch the list of CSV files from our API route.
  const fetchFiles = useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/drive-files");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch files");
        if (compact && !silent) {
          toast.error("Drive API not configured", {
            description: data.error?.slice(0, 120),
          });
        }
        return [];
      }
      const newFiles: DriveFile[] = data.files || [];
      setFiles(newFiles);
      return newFiles;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return [];
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [compact]);

  // Download and parse a single file. Returns true on success.
  const loadFile = useCallback(
    async (file: DriveFile): Promise<boolean> => {
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
        const encoder = new TextEncoder();
        const buffer = encoder.encode(csvText).buffer;
        const result = parseBuffer(buffer, file.name);
        if (result.candles.length === 0) {
          throw new Error(result.warnings[0] || "No candles found");
        }
        onLoaded(result, file.name);
        setLoadedIds((prev) => {
          const next = new Set(prev);
          next.add(file.id);
          return next;
        });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Failed: ${file.name}`, { description: msg.slice(0, 120) });
        return false;
      } finally {
        setLoadingFile(null);
      }
    },
    [onLoaded],
  );

  // Auto-load all currently-fetched files (used on mount + when new files
  // appear during polling).
  const autoLoadAll = useCallback(
    async (fileList: DriveFile[]) => {
      if (fileList.length === 0) return;
      setAutoLoading(true);
      let success = 0;
      for (const file of fileList) {
        if (loadedIdsRef.current.has(file.id)) continue;
        const ok = await loadFile(file);
        if (ok) success++;
      }
      if (success > 0) {
        toast.success(`Auto-loaded ${success} file${success > 1 ? "s" : ""} from Drive`, {
          description: `${fileList.length} total in folder`,
        });
      }
      setAutoLoading(false);
    },
    [loadFile],
  );

  // ====== On mount: fetch file list, then auto-load ALL files ======
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fileList = await fetchFiles();
      if (cancelled || fileList.length === 0) return;
      hasAutoLoadedRef.current = true;
      await autoLoadAll(fileList);
    })();
    return () => { cancelled = true; };
  }, [fetchFiles, autoLoadAll]);

  // ====== Polling: check for new files every POLL_INTERVAL ms ======
  // When new files appear (ones we haven't loaded yet), auto-load them.
  useEffect(() => {
    const interval = setInterval(async () => {
      const fileList = await fetchFiles(true);
      // Find files that exist in Drive but haven't been loaded yet.
      const newFiles = fileList.filter(
        (f) => !loadedIdsRef.current.has(f.id),
      );
      if (newFiles.length > 0) {
        await autoLoadAll(newFiles);
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchFiles, autoLoadAll]);

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

  // Manual "load all" button (re-loads any unloaded files).
  const loadAll = useCallback(async () => {
    const unloaded = filesRef.current.filter(
      (f) => !loadedIdsRef.current.has(f.id),
    );
    if (unloaded.length === 0) {
      toast.info("All files already loaded");
      return;
    }
    await autoLoadAll(unloaded);
  }, [autoLoadAll]);

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
            disabled={loadingList || autoLoading}
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            {loadingList || autoLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Cloud className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Drive</span>
            {files.length > 0 && (
              <Badge className="ml-1 h-4 px-1 text-[9px] font-mono">
                {loadedIds.size}/{files.length}
              </Badge>
            )}
          </Button>
          {files.length > 0 && loadedIds.size < files.length && (
            <Button
              variant="ghost"
              size="sm"
              onClick={loadAll}
              disabled={loadingFile !== null}
              className="h-8 px-2 text-[11px] text-white/60 hover:text-white"
              title="Load remaining files"
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
                Drive Files ({loadedIds.size}/{files.length})
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchFiles()}
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
            <p className="mt-2 border-t border-white/5 px-2 pt-2 text-[10px] text-white/30">
              Auto-refreshes every 30s · new files load automatically
            </p>
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
            Google Drive ({loadedIds.size}/{files.length} loaded)
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchFiles()}
            disabled={loadingList}
            className="h-6 w-6 p-0 text-white/40 hover:text-white"
          >
            <RefreshCw className={`h-3 w-3 ${loadingList ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {autoLoading && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] text-emerald-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Auto-loading files from Drive…
          </div>
        )}

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
            disabled={loadingFile !== null || autoLoading}
            className="mt-3 w-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            {loadingFile || autoLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Load All Files
          </Button>
        )}
      </div>

      <p className="text-[11px] text-white/40">
        Auto-loads on open · refreshes every 30s for new files · CSV files ·
        Required: Date, Open, High, Low, Close (Volume optional)
      </p>
    </div>
  );
}
