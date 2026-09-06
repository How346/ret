declare global {
  interface Window {
    electronPrint?: {
      printHtml: (html: string, options?: { paperWidthMm?: number; paperHeightMm?: number }) => Promise<{ ok: boolean }>;
    };
  }
}

export {};
