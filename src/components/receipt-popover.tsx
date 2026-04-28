"use client";

import { useEffect, useRef, useState } from "react";
import type { ReceiptRow } from "@/types/finance";

type Props = {
  receipts: ReceiptRow[];
  /** Called after a receipt is deleted so the parent can update its state */
  onReceiptDeleted?: (receiptId: string) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(mimeType: string) {
  return mimeType === "application/pdf";
}

async function getSignedUrl(receiptId: string, download = false): Promise<string | null> {
  const url = `/api/household/receipts/${receiptId}${download ? "?download=1" : ""}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
}

export function ReceiptPopover({ receipts, onReceiptDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // receiptId being actioned
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleView(receiptId: string) {
    setBusy(receiptId);
    try {
      const url = await getSignedUrl(receiptId, false);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(receipt: ReceiptRow) {
    setBusy(receipt.id);
    try {
      const url = await getSignedUrl(receipt.id, true);
      if (!url) return;
      // Use an anchor click to trigger the browser download dialog
      const a = document.createElement("a");
      a.href = url;
      a.download = receipt.file_name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setBusy(null);
    }
  }

  if (receipts.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      {/* Trigger icon */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={`${receipts.length} receipt${receipts.length !== 1 ? "s" : ""} attached`}
        aria-label={`${receipts.length} receipt${receipts.length !== 1 ? "s" : ""} — click to view`}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
      >
        {/* Paperclip icon */}
        <svg
          className="h-3.5 w-3.5 shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
        {receipts.length > 1 && (
          <span className="text-[10px] font-semibold leading-none">{receipts.length}</span>
        )}
      </button>

      {/* Popover panel */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {receipts.length} receipt{receipts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2.5">
                {/* File type icon */}
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden>
                  {isPdf(r.mime_type) ? (
                    <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  )}
                </span>

                {/* Name + size */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                    {r.file_name}
                  </p>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {formatBytes(r.file_size)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void handleView(r.id)}
                    title="View"
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    {/* Eye icon */}
                    <svg className="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="sr-only">View</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void handleDownload(r)}
                    title="Download"
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    {/* Download icon */}
                    <svg className="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    <span className="sr-only">Download</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
