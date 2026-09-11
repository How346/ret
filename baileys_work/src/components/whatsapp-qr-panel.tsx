import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, QrCode } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isDesktopPrintingAvailable } from "@/lib/printer-prefs";

export function WhatsAppQrPanel() {
  const [qr, setQr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!isDesktopPrintingAvailable() || !window.electronAPI?.getWhatsAppStatus) return;
    let offQr = () => {}, offReady = () => {};
    void window.electronAPI.getWhatsAppStatus().then(s => { setReady(!!s.ready); setQr(s.qr || null); });
    offQr = window.electronAPI.onWhatsAppQr?.(url => { setQr(url); setReady(false); }) || (() => {});
    offReady = window.electronAPI.onWhatsAppReady?.(() => { setReady(true); setQr(null); }) || (() => {});
    return () => { offQr(); offReady(); };
  }, []);

  if (!isDesktopPrintingAvailable()) return null;

  const start = async () => {
    if (!window.electronAPI?.initializeWhatsApp) return;
    setStarting(true);
    try {
      const s = await window.electronAPI.initializeWhatsApp();
      setReady(!!s.ready); setQr(s.qr || null);
    } finally { setStarting(false); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-sm"><MessageCircle className="h-4 w-4" /> Background WhatsApp connection</div>
      {ready ? (
        <div className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> WhatsApp connected and ready</div>
      ) : qr ? (
        <div className="flex flex-col items-center gap-2">
          <div className="text-xs text-muted-foreground text-center">Open WhatsApp on your phone → Linked devices → Link a device, then scan this QR.</div>
          <img src={qr} alt="WhatsApp QR code" className="w-64 h-64 rounded-lg border bg-white p-2" />
          <div className="text-[11px] text-muted-foreground">No Chromium or browser window is used; Baileys keeps the WhatsApp connection in the background.</div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">Connect once. Baileys saves the encrypted session keys locally for future launches.</div>
          <Button size="sm" variant="outline" onClick={start} disabled={starting}>{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4 mr-1" />} {starting ? "Starting…" : "Connect WhatsApp"}</Button>
        </div>
      )}
    </Card>
  );
}
