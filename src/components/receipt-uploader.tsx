"use client";

import { useEffect, useRef, useState } from "react";
import type { ReceiptRow } from "@/types/finance";

type Props = {
  transactionId: string;
  initialReceipts?: ReceiptRow[];
  onChange?: (receipts: ReceiptRow[]) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(mimeType: string) {
  return mimeType === "application/pdf";
}

export function ReceiptUploader({ transactionId, initialReceipts = [], onChange }: Props) {
  const [receipts, setReceipts] = useState<ReceiptRow[]>(initialReceipts);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep receipts in sync if the parent re-mounts with new initialReceipts
  useEffect(() => {
    setReceipts(initialReceipts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  function notify(next: ReceiptRow[]) {
    setReceipts(next);
    onChange?.(next);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);

    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("transaction_id", transactionId);
      body.append("file", file);

      try {
        const res = await fetch("/api/household/receipts/upload", {
          method: "POST",
          body,
        });
        const json = await res.json();
        if (!res.ok) {
          setUploadError(json.error ?? "Upload failed");
          break;
        }
        notify([...receipts, json.receipt as ReceiptRow]);
      } catch {
        setUploadError("Network error during upload.");
        break;
      }
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDelete(receiptId: string) {
    setDeletingId(receiptId);
    try {
      const res = await fetch(`/api/household/receipts/${receiptId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        notify(receipts.filter((r) => r.id !== receiptId));
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleView(receiptId: string) {
    const res = await fetch(`/api/household/receipts/${receiptId}`);
    if (!res.ok) return;
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-center transition-colors hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
      >
        <svg
          className="h-6 w-6 text-zinc-400 dark:text-zinc-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {uploading ? "Uploading…" : "Click or drag to upload receipt"}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          JPEG, PNG, WEBP, HEIC, PDF · max 20 MB
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        multiple
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {uploadError ? (
        <p className="text-xs text-red-600 dark:text-red-400">{uploadError}</p>
      ) : null}

      {/* Attached receipts list */}
      {receipts.length > 0 ? (
        <ul className="space-y-2">
          {receipts.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {/* Icon */}
              <span className="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden>
                {isPdf(r.mime_type) ? (
                  <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                )}
              </span>

              {/* Name + size */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {r.file_name}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatBytes(r.file_size)}
                </p>
              </div>

              {/* Actions */}
              <button
                type="button"
                onClick={() => handleView(r.id)}
                className="shrink-0 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
              >
                View
              </button>
              <button
                type="button"
                disabled={deletingId === r.id}
                onClick={() => handleDelete(r.id)}
                className="shrink-0 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                {deletingId === r.id ? "…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
