import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, QrCode } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isDesktopPrintingAvailable } from "@/lib/printer-prefs";

export function WhatsAppQrPanel() {
  const [qr, setQr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktopPrintingAvailable() || !window.electronAPI?.getWhatsAppStatus) return;
    let offQr = () => {}, offReady = () => {}, offError = () => {};
    void window.electronAPI.getWhatsAppStatus().then(s => {
      setReady(!!s.ready);
      setQr(s.qr || null);
      if (!s.ready && !s.qr && s.error) setError(s.error);
    });
    offQr = window.electronAPI.onWhatsAppQr?.(url => { setQr(url); setReady(false); setError(null); }) || (() => {});
    offReady = window.electronAPI.onWhatsAppReady?.(() => { setReady(true); setQr(null); setError(null); }) || (() => {});
    offError = window.electronAPI.onWhatsAppError?.((payload: any) => {
      setError(String(payload?.error || payload || "WhatsApp connection failed"));
    }) || (() => {});
    return () => { offQr(); offReady(); offError(); };
  }, []);

  if (!isDesktopPrintingAvailable()) return null;

  const start = async () => {
    if (!window.electronAPI?.initializeWhatsApp) return;
    setStarting(true);
    setError(null);
    try {
      const s = await window.electronAPI.initializeWhatsApp();
      setReady(!!s.ready);
      setQr(s.qr || null);
      if (!s.ready && !s.qr && s.error) setError(String(s.error));
    } catch (err: any) {
      setError(String(err?.message || err || "WhatsApp connection failed"));
    } finally {
      setStarting(false);
    }
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
          <div className="text-[11px] text-muted-foreground">The WhatsApp browser runs completely in the background.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {error && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md p-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">Connect once. LocalAuth keeps the session for future launches.</div>
            <Button size="sm" variant="outline" onClick={start} disabled={starting}>{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4 mr-1" />} {starting ? "Starting…" : error ? "Try again" : "Connect WhatsApp"}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
