"use client";

import { ThemeProvider } from "@/components/theme-provider";

export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return <ThemeProvider nonce={nonce}>{children}</ThemeProvider>;
}
