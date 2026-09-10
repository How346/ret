import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useStoreSettings } from "@/hooks/use-store-settings";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Printer, Store, Upload, User, Building2, HardDrive, FolderOpen, DownloadCloud, RotateCcw, KeyRound, MessageCircle, Loader2, Copy, ShieldCheck, ShieldAlert } from "lucide-react";
import { printReceipt } from "@/lib/print-receipt";
import {
  isDesktopPrintingAvailable,
  listPrinters,
  getPrinterPrefs,
  setReceiptPrinter,
  setLabelPrinter,
  setSilentPrint,
  type PrinterInfo,
} from "@/lib/printer-prefs";
import { openWhatsAppWeb } from "@/lib/whatsapp-send";
import { WhatsAppQrPanel } from "@/components/whatsapp-qr-panel";
import { backupSupported, pickBackupFolder, getSavedFolder, forgetFolder, runBackup, restoreBackup } from "@/lib/local-backup";
import { useMyLicense, licenseStatus, redeemLicenseKey } from "@/hooks/use-license";
import { useQueryClient as useQC2 } from "@tanstack/react-query";
import { getFontScale, setFontScale } from "@/lib/ui-preferences";



export const Route = createFileRoute("/_app/settings")({ component: Settings });

function Settings() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const { data: settings } = useStoreSettings();
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerPrefs, setPrinterPrefs] = useState(getPrinterPrefs());
  const [waConnecting, setWaConnecting] = useState(false);
  const desktopPrinting = isDesktopPrintingAvailable();
  const [fontScale, setFontScaleState] = useState(() => getFontScale());

  useEffect(() => { if (settings) setForm({ ...settings }); }, [settings]);
  useEffect(() => {
    if (!desktopPrinting) return;
    listPrinters().then(setPrinters);
  }, [desktopPrinting]);

  if (!form) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    const { id, created_at, updated_at, ...rest } = form;
    const { error } = await supabase.from("store_settings").update(rest).eq("id", id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
    qc.invalidateQueries({ queryKey: ["store_settings"] });
  };

  const uploadLogo = async (file: File) => {
    const ext = file.name.split(".").pop();
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("store-assets").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data: pub } = supabase.storage.from("store-assets").getPublicUrl(path);
    set({ logo_url: pub.publicUrl });
    toast.success("Logo uploaded — remember to save");
  };

  const testPrint = () => {
    printReceipt({
      invoiceNo: "TEST-0001",
      cart: [
        { name: "Sample Item A", qty: 2, price: 150, discount: 0, gst_rate: 18, hsn_code: "1234" },
        { name: "Sample Item B", qty: 1, price: 75, discount: 5, gst_rate: 5 },
      ],
      totals: { subtotal: 318.64, cgst: 28.18, sgst: 28.18, total: 375 },
      payment: { cash: 375, card: 0, upi: 0 },
      settings: form,
    });
  };

  // All roles (admin / manager / cashier) can edit shop & print settings.
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Shop profile, printing, and account · signed in as <b className="uppercase">{role}</b></p>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
      </div>

      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="appearance"><span className="mr-1">Aa</span> Appearance</TabsTrigger>
          <TabsTrigger value="shop"><Store className="h-3.5 w-3.5 mr-1" /> Shop</TabsTrigger>
          <TabsTrigger value="print"><Printer className="h-3.5 w-3.5 mr-1" /> Printing</TabsTrigger>
          <TabsTrigger value="whatsapp"><MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp</TabsTrigger>
          <TabsTrigger value="bank"><Building2 className="h-3.5 w-3.5 mr-1" /> Bank / UPI</TabsTrigger>
          <TabsTrigger value="data"><HardDrive className="h-3.5 w-3.5 mr-1" /> Store Data</TabsTrigger>
          <TabsTrigger value="license"><KeyRound className="h-3.5 w-3.5 mr-1" /> License</TabsTrigger>
          <TabsTrigger value="account"><User className="h-3.5 w-3.5 mr-1" /> Account</TabsTrigger>
        </TabsList>



        <TabsContent value="appearance" className="mt-4">
          <Card className="p-6 space-y-5">
            <div>
              <h2 className="font-semibold">Overall text size</h2>
              <p className="text-sm text-muted-foreground mt-1">Adjust the interface text and rem-based UI sizes across the whole software. This does not change printed receipt font size.</p>
            </div>
            <div className="rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">Application font size</div>
                  <div className="text-sm text-muted-foreground">{Math.round(fontScale * 100)}% of normal</div>
                </div>
                <div className="text-2xl font-semibold">Aa</div>
              </div>
              <input
                type="range" min="85" max="120" step="5" value={Math.round(fontScale * 100)}
                className="w-full accent-primary"
                onChange={e => { const v = setFontScale(Number(e.target.value) / 100); setFontScaleState(v); }}
              />
              <div className="flex justify-between text-xs text-muted-foreground"><span>85% Smaller</span><span>100% Default</span><span>120% Larger</span></div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              Changes apply immediately to navigation, POS, forms, tables, dialogs and other interface elements. Your existing POS layout is not changed.
            </div>
            <Button variant="outline" onClick={() => { const v = setFontScale(1); setFontScaleState(v); toast.success("Font size reset to 100%"); }}>Reset to 100%</Button>
          </Card>
        </TabsContent>

        <TabsContent value="shop" className="mt-4">
          <Card className="p-6 grid md:grid-cols-2 gap-4">
            <Field label="Shop name"><Input value={form.shop_name ?? ""} onChange={e => set({ shop_name: e.target.value })} /></Field>
            <Field label="GSTIN"><Input value={form.gstin ?? ""} onChange={e => set({ gstin: e.target.value.toUpperCase() })} placeholder="22AAAAA0000A1Z5" /></Field>
            <Field label="Phone"><Input value={form.phone ?? ""} onChange={e => set({ phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={form.email ?? ""} onChange={e => set({ email: e.target.value })} /></Field>
            <Field label="State"><Input value={form.state ?? ""} onChange={e => set({ state: e.target.value })} /></Field>
            <Field label="State code"><Input value={form.state_code ?? ""} onChange={e => set({ state_code: e.target.value })} placeholder="22" /></Field>
            <Field label="Address" className="md:col-span-2"><Textarea rows={2} value={form.address ?? ""} onChange={e => set({ address: e.target.value })} /></Field>
            <Field label="Invoice prefix"><Input value={form.invoice_prefix ?? "INV"} onChange={e => set({ invoice_prefix: e.target.value })} /></Field>
            <Field label="Logo">
              <div className="flex items-center gap-3">
                {form.logo_url && <img src={form.logo_url} alt="" className="h-10 w-auto rounded border border-border" />}
                <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer rounded-md border border-border px-3 h-9 hover:bg-accent">
                  <Upload className="h-3.5 w-3.5" /> Upload
                  <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                </label>
                {form.logo_url && <Button size="sm" variant="ghost" onClick={() => set({ logo_url: null })}>Remove</Button>}
              </div>
            </Field>
            <Field label="Invoice footer" className="md:col-span-2"><Textarea rows={2} value={form.invoice_footer ?? ""} onChange={e => set({ invoice_footer: e.target.value })} /></Field>
            <Field label="Terms (printed small)" className="md:col-span-2"><Textarea rows={2} value={form.terms ?? ""} onChange={e => set({ terms: e.target.value })} /></Field>
          </Card>
        </TabsContent>

        <TabsContent value="print" className="mt-4">
          <Card className="p-6 space-y-5">
            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Paper size">
                <Select value={form.paper_size} onValueChange={v => set({ paper_size: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58mm">58 mm thermal</SelectItem>
                    <SelectItem value="80mm">80 mm thermal</SelectItem>
                    <SelectItem value="A4">A4 paper</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Print copies">
                <Input type="number" min={1} max={5} value={form.print_copies}
                  onChange={e => set({ print_copies: Math.max(1, Number(e.target.value) || 1) })} />
              </Field>
              <Field label={`Receipt font size (${form.receipt_font_size ?? 12}px)`}>
                <Input type="range" min={8} max={18} step={1}
                  value={form.receipt_font_size ?? 12}
                  onChange={e => set({ receipt_font_size: Number(e.target.value) })} />
              </Field>
              <Field label="Bill number format">
                <Select value={form.bill_no_format ?? "short"} onValueChange={v => set({ bill_no_format: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short (B00001)</SelectItem>
                    <SelectItem value="full">Full (INV-2025-000001)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid md:grid-cols-4 gap-4 pt-2 border-t border-border">
              <Field label={`Top margin (${form.receipt_margin_top ?? 2} mm)`}>
                <Input type="number" min={0} max={30} step={0.5}
                  value={form.receipt_margin_top ?? 2}
                  onChange={e => set({ receipt_margin_top: Number(e.target.value) || 0 })} />
              </Field>
              <Field label={`Bottom margin (${form.receipt_margin_bottom ?? 2} mm)`}>
                <Input type="number" min={0} max={30} step={0.5}
                  value={form.receipt_margin_bottom ?? 2}
                  onChange={e => set({ receipt_margin_bottom: Number(e.target.value) || 0 })} />
              </Field>
              <Field label={`Left margin (${form.receipt_margin_left ?? 3} mm)`}>
                <Input type="number" min={0} max={30} step={0.5}
                  value={form.receipt_margin_left ?? 3}
                  onChange={e => set({ receipt_margin_left: Number(e.target.value) || 0 })} />
              </Field>
              <Field label={`Right margin (${form.receipt_margin_right ?? 3} mm)`}>
                <Input type="number" min={0} max={30} step={0.5}
                  value={form.receipt_margin_right ?? 3}
                  onChange={e => set({ receipt_margin_right: Number(e.target.value) || 0 })} />
              </Field>
              <Field label={`Line spacing (${form.receipt_line_height ?? 1.3})`}>
                <Input type="range" min={1} max={2} step={0.05}
                  value={form.receipt_line_height ?? 1.3}
                  onChange={e => set({ receipt_line_height: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <Toggle label="Show logo on bill" checked={form.show_logo} onChange={v => set({ show_logo: v })} />
              <Toggle label="Show GSTIN on bill" checked={form.show_gstin} onChange={v => set({ show_gstin: v })} />
              <Toggle label="Show footer / terms" checked={form.show_footer} onChange={v => set({ show_footer: v })} />
              <Toggle label="Auto-open print dialog after sale" checked={form.auto_print} onChange={v => set({ auto_print: v })} />
              <Toggle
                label="Show GST breakdown on bill (off = inclusive)"
                checked={form.show_gst_breakdown !== false}
                onChange={v => set({ show_gst_breakdown: v })}
              />
              <Toggle
                label="Print text in BOLD (darker/thicker)"
                checked={form.receipt_bold !== false}
                onChange={v => set({ receipt_bold: v })}
              />
            </div>
            <div className="pt-2 border-t border-border">
              <Button variant="outline" onClick={testPrint}><Printer className="h-3.5 w-3.5 mr-1" /> Print test receipt</Button>
              <p className="text-xs text-muted-foreground mt-2">
                Paper height auto-fits to content — your thermal printer will cut right after the last line, no wasted roll.
                When "Show GST breakdown" is off the bill prints "ALL ITEMS RATES GST INCLUSIVE" instead.
              </p>
            </div>

            {desktopPrinting && (
              <div className="rounded-md border border-border p-3 space-y-3">
                <div className="font-semibold flex items-center gap-1 text-sm"><Printer className="h-3.5 w-3.5" /> This computer's printers</div>
                <p className="text-xs text-muted-foreground">
                  These printer choices are saved on this PC only — set them separately on every till/computer.
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Invoice / receipt printer">
                    <Select
                      value={printerPrefs.receiptPrinter ?? "__ask__"}
                      onValueChange={(v) => {
                        const val = v === "__ask__" ? null : v;
                        setReceiptPrinter(val);
                        setPrinterPrefs((p) => ({ ...p, receiptPrinter: val }));
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ask__">Ask each time (show print dialog)</SelectItem>
                        {printers.map((p) => (
                          <SelectItem key={p.name} value={p.name}>
                            {p.displayName}{p.isDefault ? " (default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Barcode label printer">
                    <Select
                      value={printerPrefs.labelPrinter ?? "__ask__"}
                      onValueChange={(v) => {
                        const val = v === "__ask__" ? null : v;
                        setLabelPrinter(val);
                        setPrinterPrefs((p) => ({ ...p, labelPrinter: val }));
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ask__">Ask each time (show print dialog)</SelectItem>
                        {printers.map((p) => (
                          <SelectItem key={p.name} value={p.name}>
                            {p.displayName}{p.isDefault ? " (default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Toggle
                  label="Print silently — skip the dialog and print straight to the selected printer"
                  checked={printerPrefs.silent}
                  onChange={(v) => { setSilentPrint(v); setPrinterPrefs((p) => ({ ...p, silent: v })); }}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => listPrinters().then(setPrinters)}>Refresh printer list</Button>
                  {printers.length === 0 && (
                    <span className="text-xs text-muted-foreground">No printers detected — check Windows has a printer installed.</span>
                  )}
                </div>
              </div>
            )}
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
              <div className="font-semibold flex items-center gap-1"><Printer className="h-3.5 w-3.5" /> Epson / ESC-POS printer tips</div>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>In Windows printer preferences, set <b>Paper Source: Roll Paper</b> and <b>Paper Size: Roll Paper 80 × 297 mm</b> (or 58 mm).</li>
                <li>Enable <b>Cut paper after document</b> so the cutter triggers at end of bill.</li>
                <li>Set <b>Print density / darkness</b> to <b>Dark</b> or <b>+2</b> in driver utility — text is already rendered bold black for solid output.</li>
                <li>Disable browser headers/footers in the print dialog (More settings → uncheck Headers & footers, Margins: None).</li>
                <li>For Epson TM-T82 / TM-T20: install the <b>Epson Advanced Printer Driver (APD)</b> for best ESC/POS results.</li>
              </ul>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
              <div className="font-semibold flex items-center gap-1"><Printer className="h-3.5 w-3.5" /> TSC TTP-244 Pro label printer</div>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Install the <b>TSC Seagull / TSC Windows driver</b>. In Printing Preferences → Stock select <b>User defined</b> and set Width × Height to match your roll (e.g. 50 × 25 mm).</li>
                <li>Media type: <b>Labels with gaps</b> (gap 2–3 mm). Method: <b>Thermal Transfer</b> with ribbon, or <b>Direct Thermal</b> for blank rolls.</li>
                <li>Speed: 4 ips · Density: 8–12. Run <b>Calibrate Media</b> once after loading a new roll.</li>
                <li>In Products page, tick the items you want, click <b>Print Labels</b> and pick the same dimensions in the dialog.</li>
              </ul>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-4">
          <WhatsAppQrPanel />
          <Card className="p-6 space-y-4">
            <Toggle
              label="Enable WhatsApp bill sharing"
              checked={!!form.whatsapp_enabled}
              onChange={v => set({ whatsapp_enabled: v })}
            />
            <p className="text-xs text-muted-foreground -mt-2">
              When on, the POS payment screen shows a "Confirm & Send" button. It saves the sale, then
              opens a WhatsApp chat for the customer's number with a message pre-filled — on the desktop
              app the bill image is also copied to your clipboard, ready to paste (Ctrl+V) into the chat.
            </p>
            <div className="grid md:grid-cols-3 gap-4 pt-2 border-t border-border">
              <Field label="Default country code">
                <Input
                  value={form.whatsapp_country_code ?? "91"}
                  onChange={e => set({ whatsapp_country_code: e.target.value.replace(/[^\d]/g, "") })}
                  placeholder="91"
                  disabled={!form.whatsapp_enabled}
                />
              </Field>
              <Field label="Message template" className="md:col-span-2">
                <Textarea
                  rows={3}
                  value={form.whatsapp_message_template ?? ""}
                  onChange={e => set({ whatsapp_message_template: e.target.value })}
                  placeholder="Hi {customer}, thank you for shopping at {shop}! Your bill {invoice} of {total} is attached. Visit again!"
                  disabled={!form.whatsapp_enabled}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Placeholders: <code>{"{customer}"}</code>, <code>{"{shop}"}</code>, <code>{"{invoice}"}</code>, <code>{"{total}"}</code>.
              Numbers with 10 digits automatically get the country code above added in front.
            </p>
            {isDesktopPrintingAvailable() && (
              <div className="rounded-md border border-border p-3 space-y-2 pt-3 border-t">
                <div className="font-semibold flex items-center gap-1 text-sm"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp Web login</div>
                <p className="text-xs text-muted-foreground">
                  Sending opens WhatsApp Web in your computer's own default browser (Chrome, Edge,
                  Firefox — whichever you use) instead of inside this app. Log in there once by
                  scanning the QR code; your browser remembers it after that, same as any other site.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={waConnecting}
                  onClick={async () => {
                    setWaConnecting(true);
                    try {
                      const res = await openWhatsAppWeb();
                      if (!res.success) toast.error("Couldn't open WhatsApp Web");
                    } finally {
                      setWaConnecting(false);
                    }
                  }}
                >
                  {waConnecting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Open WhatsApp Web in browser (scan QR / login)
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="bank" className="mt-4">
          <Card className="p-6 grid md:grid-cols-2 gap-4">
            <Field label="Bank name"><Input value={form.bank_name ?? ""} onChange={e => set({ bank_name: e.target.value })} /></Field>
            <Field label="Account no."><Input value={form.bank_account ?? ""} onChange={e => set({ bank_account: e.target.value })} /></Field>
            <Field label="IFSC"><Input value={form.bank_ifsc ?? ""} onChange={e => set({ bank_ifsc: e.target.value.toUpperCase() })} /></Field>
            <Field label="UPI ID"><Input value={form.upi_id ?? ""} onChange={e => set({ upi_id: e.target.value })} placeholder="shop@upi" /></Field>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="mt-4">
          <StoreDataTab />
        </TabsContent>

        <TabsContent value="license" className="mt-4">
          <LicenseTab />
        </TabsContent>



        <TabsContent value="account" className="mt-4">
          <Card className="p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Email</span><span className="font-medium">{user?.email}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Role</span><span className="font-medium uppercase">{role}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">User ID</span><span className="font-mono text-xs">{user?.id}</span></div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-border px-3 h-10 cursor-pointer hover:bg-accent/50">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function StoreDataTab() {
  const supported = backupSupported();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "backup" | "restore">(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [autoDaily, setAutoDaily] = useState<boolean>(() => localStorage.getItem("merp-auto-backup") === "1");
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSavedFolder().then(h => setFolderName(h?.name ?? null));
  }, []);

  // Auto daily backup — fires at most once per calendar day, on app load,
  // when the setting is enabled and a folder is remembered.
  useEffect(() => {
    if (!autoDaily) return;
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem("merp-auto-backup-last") === today) return;
    (async () => {
      try {
        const h = await getSavedFolder();
        if (!h) return;
        await runBackup();
        localStorage.setItem("merp-auto-backup-last", today);
      } catch (e) {
        // silent — user will see the error on manual backup
      }
    })();
  }, [autoDaily]);

  const choose = async () => {
    try {
      const h = await pickBackupFolder();
      setFolderName(h.name);
      toast.success(`Backup folder set to "${h.name}"`);
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(e.message ?? "Could not open folder");
    }
  };

  const backupNow = async () => {
    setBusy("backup");
    try {
      const r = await runBackup();
      const total = Object.values(r.tables).reduce((a, b) => a + b, 0);
      setLastResult(`Saved ${total} rows to ${r.folder}/${r.file}`);
      toast.success("Backup complete");
    } catch (e: any) {
      toast.error(e.message ?? "Backup failed");
    } finally { setBusy(null); }
  };

  const doRestore = async (file: File) => {
    if (!confirm(`Restore data from "${file.name}"?\n\nExisting rows with the same ID will be OVERWRITTEN. New rows in the backup will be added. Rows only in the database will NOT be deleted.`)) return;
    setBusy("restore");
    try {
      const r = await restoreBackup(file);
      const total = Object.values(r).reduce((a, b) => a + b, 0);
      setLastResult(`Restored ${total} rows from ${file.name}`);
      toast.success("Restore complete — reload the page");
    } catch (e: any) {
      toast.error(e.message ?? "Restore failed");
    } finally { setBusy(null); }
  };

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h2 className="font-semibold flex items-center gap-2"><HardDrive className="h-4 w-4" /> Local backup — keep your shop data on this PC</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a folder on this computer. The app will save a full JSON snapshot of your products, sales, customers and settings there, so nothing is lost if the internet or cloud goes down.
        </p>
      </div>

      {!supported && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          Your browser does not support folder access. Please use <b>Google Chrome, Microsoft Edge or Brave</b> for local backups.
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <Card className="p-4 space-y-2">
          <div className="text-xs uppercase text-muted-foreground">Backup folder</div>
          <div className="font-mono text-sm truncate">{folderName ? `📁 ${folderName}` : "— not chosen —"}</div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" disabled={!supported} onClick={choose}>
              <FolderOpen className="h-3.5 w-3.5 mr-1" /> {folderName ? "Change" : "Choose folder"}
            </Button>
            {folderName && (
              <Button size="sm" variant="ghost" onClick={async () => { await forgetFolder(); setFolderName(null); }}>Forget</Button>
            )}
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="text-xs uppercase text-muted-foreground">Backup now</div>
          <div className="text-xs text-muted-foreground">Writes <span className="font-mono">margin-erp-YYYY-MM-DD.json</span> into the folder.</div>
          <Button size="sm" disabled={!folderName || busy !== null} onClick={backupNow}>
            <DownloadCloud className="h-3.5 w-3.5 mr-1" /> {busy === "backup" ? "Working…" : "Backup now"}
          </Button>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="text-xs uppercase text-muted-foreground">Restore from file</div>
          <div className="text-xs text-muted-foreground">Merges the JSON back. Existing rows with the same ID are overwritten.</div>
          <input ref={restoreRef} type="file" accept="application/json" hidden
            onChange={e => e.target.files?.[0] && doRestore(e.target.files[0])} />
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => restoreRef.current?.click()}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> {busy === "restore" ? "Working…" : "Choose file…"}
          </Button>
        </Card>
      </div>

      <Toggle
        label="Auto-backup once a day when I open the app"
        checked={autoDaily}
        onChange={(v) => { setAutoDaily(v); localStorage.setItem("merp-auto-backup", v ? "1" : "0"); }}
      />

      {lastResult && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">{lastResult}</div>
      )}

      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
        <div className="font-semibold">How this works</div>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Your data still lives in the cloud so bills and stock sync across devices.</li>
          <li>Every backup writes to <span className="font-mono">&lt;your folder&gt;/MarginERP-Backups/</span>. Old snapshots are kept — safe to copy to a pen-drive.</li>
          <li>A double-clickable <span className="font-mono">Open Backup Folder.bat</span> is placed inside so you can jump to it from Windows.</li>
          <li>Browsers don't allow websites to write to arbitrary Windows paths silently — that's why we ask you to pick the folder once.</li>
        </ul>
      </div>
    </Card>
  );
}


function formatLicenseDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function LicenseTab() {
  const { user } = useAuth();
  const { data: license } = useMyLicense();
  const status = licenseStatus(license);
  const qc = useQC2();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [hwid, setHwid] = useState("");
  const [offlineLicense, setOfflineLicense] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const offline = !!window.electronAPI?.getLicenseStatus;

  useEffect(() => {
    if (!offline) return;
    window.electronAPI!.getHWID().then(r => setHwid(r.hwid)).catch(() => {});
    window.electronAPI!.getLicenseStatus().then(setOfflineLicense).catch(() => {});
  }, [offline]);

  const copyHwid = async () => {
    if (!hwid) return;
    await navigator.clipboard.writeText(hwid);
    toast.success("HWID copied");
  };

  const uploadOfflineLicense = async (file: File) => {
    if (!window.electronAPI?.installLicense) return;
    setBusy(true);
    try {
      const result = await window.electronAPI.installLicense(await file.text());
      if (!result.valid) throw new Error(result.reason || "Invalid license");
      setOfflineLicense(result);
      await qc.invalidateQueries({ queryKey: ["my-license"] });
      toast.success("License activated successfully");
    } catch (e: any) {
      toast.error(e?.message || "Invalid license file");
    } finally {
      setBusy(false);
    }
  };

  const removeOfflineLicense = async () => {
    if (!window.electronAPI?.removeLicense) return;
    if (!confirm("Remove the license from this computer?")) return;
    await window.electronAPI.removeLicense();
    setOfflineLicense({ valid: false, reason: "none" });
    await qc.invalidateQueries({ queryKey: ["my-license"] });
    toast.success("License removed");
  };

  const activateOnline = async () => {
    if (!user || !key.trim()) return;
    setBusy(true);
    try {
      await redeemLicenseKey(key, user.id);
      toast.success("License activated");
      qc.invalidateQueries({ queryKey: ["my-license"] });
      setKey("");
    } catch (e: any) { toast.error(e.message ?? "Invalid key"); }
    finally { setBusy(false); }
  };

  if (offline) {
    const p = offlineLicense?.payload;
    const active = !!offlineLicense?.valid && !!p;
    return (
      <Card className="p-6 space-y-5">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4" /> Software license</h2>
          <p className="text-sm text-muted-foreground mt-1">Offline signed license for this Windows computer.</p>
        </div>

        <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs uppercase text-muted-foreground">Hardware ID (HWID)</Label>
            <Button variant="ghost" size="sm" onClick={copyHwid} disabled={!hwid}><Copy className="h-3.5 w-3.5 mr-1" /> Copy</Button>
          </div>
          <div className="rounded-lg bg-background border px-3 py-2 font-mono text-xs break-all select-all">{hwid || "Reading hardware ID…"}</div>
          <p className="text-xs text-muted-foreground">Give this HWID to your administrator. The generated licence.lic must be signed for this exact HWID.</p>
        </div>

        {active ? (
          <div className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> License Active</div>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Row2 label="License ID" value={<span className="font-mono text-xs">{p.licenseId}</span>} />
              <Row2 label="Plan" value={p.plan} />
              <Row2 label="Issued" value={formatLicenseDate(p.issuedAt)} />
              <Row2 label="Expires" value={formatLicenseDate(p.expiresAt)} />
              <Row2 label="Remaining" value={`${offlineLicense.daysLeft ?? 0} days`} />
              <Row2 label="Registered to" value={p.registeredTo || p.customerName || "—"} />
              <Row2 label="Signature" value={"Verified"} />
            </div>
            <Button variant="outline" className="text-destructive" onClick={removeOfflineLicense}>Remove License</Button>
          </div>
        ) : (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-destructive" /> License not active</div>
            <p className="text-xs text-muted-foreground mt-1">{offlineLicense?.reason && offlineLicense.reason !== "none" ? offlineLicense.reason : "Upload the signed licence.lic file generated for this HWID."}</p>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".lic,application/octet-stream,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadOfflineLicense(f); e.currentTarget.value = ""; }} />
        <Button className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" /> {busy ? "Verifying license…" : "Upload licence.lic"}
        </Button>
        <p className="text-xs text-muted-foreground">The license is verified locally using the built-in public key. No private key or license file is uploaded.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4" /> Software license</h2>
      {license ? (
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <Row2 label="Key" value={<span className="font-mono">{license.key}</span>} />
          <Row2 label="Plan" value={license.plan} />
          <Row2 label="Registered to" value={(user as any)?.user_metadata?.full_name || (user as any)?.email || "—"} />
          <Row2 label="Issued" value={formatLicenseDate(license.issued_at)} />
          <Row2 label="Expires" value={formatLicenseDate(license.expires_at)} />
          <Row2 label="Status" value={status.valid ? `Active · ${status.daysLeft} days left` : `Inactive (${status.reason})`} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No license bound to this account yet.</p>
      )}
      <div className="border-t pt-4 space-y-2">
        <Label className="text-xs uppercase text-muted-foreground">Enter renewal / new key</Label>
        <div className="flex gap-2">
          <Input placeholder="LMPOS-XXXX-XXXX-XXXX-XXXX" value={key} onChange={e => setKey(e.target.value.toUpperCase())} className="font-mono" />
          <Button onClick={activateOnline} disabled={busy || !key.trim()}>{busy ? "Activating…" : "Activate"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">Ask your admin to generate a key from the Admin Panel → Licenses.</p>
      </div>
    </Card>
  );
}

function Row2({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between border-b py-1.5"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>;
}
