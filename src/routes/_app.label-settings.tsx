import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  DEFAULT_TSC_244_PRO, PrinterProfileConfig, tsplTestSample, tsplCalibrate,
  tsplPrintJob, printTsplDirect, Sensor, Rotation,
} from "@/lib/tspl";
import { Printer, Save, Trash2, Play, Ruler } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_app/label-settings")({ component: LabelSettings });

type ProfileRow = { id: string; name: string; config: PrinterProfileConfig; is_default: boolean; user_id: string | null };

function LabelSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<PrinterProfileConfig>(DEFAULT_TSC_244_PRO);
  const [profileName, setProfileName] = useState("TSC TTP-244 Pro (76mm x 2-up)");
  const [currentId, setCurrentId] = useState<string | null>(null);

  const { data: profiles = [] } = useQuery({
    queryKey: ["printer_profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("printer_profiles").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as ProfileRow[];
    },
  });

  useEffect(() => {
    const def = profiles.find(p => p.is_default);
    if (def && !currentId) { setCurrentId(def.id); setCfg(def.config); setProfileName(def.name); }
  }, [profiles, currentId]);

  const set = <K extends keyof PrinterProfileConfig>(k: K, v: PrinterProfileConfig[K]) =>
    setCfg(prev => ({ ...prev, [k]: v }));

  const numField = (k: keyof PrinterProfileConfig, label: string, extra?: { min?: number; max?: number; step?: number }) => (
    <Field label={label}>
      <Input type="number" min={extra?.min} max={extra?.max} step={extra?.step ?? 1}
        value={cfg[k] as number}
        onChange={e => set(k, (Number(e.target.value) || 0) as any)} />
    </Field>
  );

  const saveProfile = async () => {
    if (!profileName.trim()) return toast.error("Give the profile a name");
    if (currentId) {
      const { error } = await supabase.from("printer_profiles").update({ name: profileName, config: cfg as any }).eq("id", currentId);
      if (error) return toast.error(error.message);
    } else {
      const { data, error } = await supabase.from("printer_profiles")
        .insert({ name: profileName, config: cfg as any, user_id: user?.id, is_default: profiles.length === 0 })
        .select().single();
      if (error) return toast.error(error.message);
      setCurrentId(data!.id);
    }
    toast.success("Profile saved");
    qc.invalidateQueries({ queryKey: ["printer_profiles"] });
  };

  const setDefault = async () => {
    if (!currentId) return toast.error("Save profile first");
    await supabase.from("printer_profiles").update({ is_default: false }).neq("id", currentId);
    await supabase.from("printer_profiles").update({ is_default: true }).eq("id", currentId);
    qc.invalidateQueries({ queryKey: ["printer_profiles"] });
    toast.success("Set as default");
  };

  const deleteProfile = async () => {
    if (!currentId) return;
    if (!confirm("Delete this profile?")) return;
    await supabase.from("printer_profiles").delete().eq("id", currentId);
    setCurrentId(null); setCfg(DEFAULT_TSC_244_PRO); setProfileName("New profile");
    qc.invalidateQueries({ queryKey: ["printer_profiles"] });
  };

  const testPrint = async () => {
    try {
      await printTsplDirect(tsplTestSample(cfg), "test-print.prn");
      toast.success("Test label sent to the selected printer");
    } catch (e: any) { toast.error(e?.message || "Test print failed"); }
  };
  const calibrate = async () => {
    try {
      await printTsplDirect(tsplCalibrate(cfg), "calibrate.prn");
      toast.success("Calibration command sent to the selected printer");
    } catch (e: any) { toast.error(e?.message || "Calibration failed"); }
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Label Print Settings</h1>
          <p className="text-sm text-muted-foreground">TSC TTP-244 Pro · TSPL / TSPL2 · 203 dpi · 76 mm roll</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={calibrate}><Ruler className="h-3.5 w-3.5 mr-1" /> Calibrate</Button>
          <Button variant="outline" onClick={testPrint}><Play className="h-3.5 w-3.5 mr-1" /> Test print</Button>
          <Button onClick={saveProfile}><Save className="h-3.5 w-3.5 mr-1" /> Save profile</Button>
        </div>
      </div>

      {/* Profiles bar */}
      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <Label className="text-xs uppercase">Profiles</Label>
        <Select value={currentId ?? "new"} onValueChange={v => {
          if (v === "new") { setCurrentId(null); setCfg(DEFAULT_TSC_244_PRO); setProfileName("New profile"); return; }
          const p = profiles.find(x => x.id === v);
          if (p) { setCurrentId(p.id); setCfg(p.config); setProfileName(p.name); }
        }}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select profile" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="new">+ New profile</SelectItem>
            {profiles.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}{p.is_default ? " · default" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input className="w-64" value={profileName} onChange={e => setProfileName(e.target.value)} />
        <div className="flex-1" />
        {currentId && <Button size="sm" variant="outline" onClick={setDefault}>Set default</Button>}
        {currentId && <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteProfile}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* CONFIG */}
        <Card className="p-5 space-y-4">
          <SectionTitle icon={<Printer className="h-4 w-4" />}>Media & layout</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {numField("paperWidthMm", "Paper width (mm)", { min: 20, max: 120 })}
            {numField("paperHeightMm", "Paper height (mm)", { min: 10, max: 300 })}
            {numField("labelWidthMm", "Label width (mm)", { min: 5, max: 120 })}
            {numField("labelHeightMm", "Label height (mm)", { min: 5, max: 300 })}
            {numField("columns", "Columns", { min: 1, max: 6 })}
            {numField("copies", "Copies", { min: 1, max: 99 })}
            {numField("hGapMm", "Horizontal gap (mm)", { min: 0, step: 0.5 })}
            {numField("vGapMm", "Vertical gap (mm)", { min: 0, step: 0.5 })}
            {numField("leftMarginMm", "Left margin (mm)", { min: 0, step: 0.5 })}
            {numField("topMarginMm", "Top margin (mm)", { min: 0, step: 0.5 })}
          </div>

          <SectionTitle icon={<Printer className="h-4 w-4" />}>Printer</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Print density (0–15)">
              <Input type="number" min={0} max={15} value={cfg.density} onChange={e => set("density", Number(e.target.value) || 0)} />
            </Field>
            <Field label="Print speed (ips, 1–6)">
              <Input type="number" min={1} max={6} value={cfg.speed} onChange={e => set("speed", Number(e.target.value) || 1)} />
            </Field>
            <Field label="Sensor">
              <Select value={cfg.sensor} onValueChange={v => set("sensor", v as Sensor)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GAP">Gap</SelectItem>
                  <SelectItem value="BLINE">Black mark</SelectItem>
                  <SelectItem value="CONTINUOUS">Continuous</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Rotation">
              <Select value={String(cfg.rotation)} onValueChange={v => set("rotation", Number(v) as Rotation)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0°</SelectItem>
                  <SelectItem value="90">90°</SelectItem>
                  <SelectItem value="180">180°</SelectItem>
                  <SelectItem value="270">270°</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p><b>How printing works:</b> on the Windows desktop app, TSPL/.PRN is sent directly to the <b>Barcode label printer selected in Settings</b>. No USB pairing is required.</p>
            <p>Use <b>Test print</b> to verify the selected printer and <b>Calibrate</b> after changing label stock.</p>
          </div>
        </Card>

        {/* PREVIEW */}
        <Card className="p-5 space-y-3">
          <SectionTitle icon={<Ruler className="h-4 w-4" />}>Live preview (auto-centered)</SectionTitle>
          <LabelPreview cfg={cfg} />
          <SampleInputs cfg={cfg} />
        </Card>
      </div>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 font-display font-semibold text-sm">{icon}{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>{children}</div>;
}

function LabelPreview({ cfg }: { cfg: PrinterProfileConfig }) {
  const scale = 4; // px per mm
  const totalRowWidth = cfg.columns * cfg.labelWidthMm + (cfg.columns - 1) * cfg.hGapMm;
  const leftPad = Math.max(0, (cfg.paperWidthMm - totalRowWidth) / 2);
  const rows = 3;
  const totalHeight = rows * cfg.labelHeightMm + (rows - 1) * cfg.vGapMm + cfg.topMarginMm * 2;
  return (
    <div className="overflow-auto rounded border bg-white p-2">
      <svg width={cfg.paperWidthMm * scale} height={totalHeight * scale} className="mx-auto block">
        <rect x={0} y={0} width={cfg.paperWidthMm * scale} height={totalHeight * scale} fill="#fafafa" stroke="#d4d4d8" />
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cfg.columns }).map((_, c) => {
            const x = (leftPad + c * (cfg.labelWidthMm + cfg.hGapMm)) * scale;
            const y = (cfg.topMarginMm + r * (cfg.labelHeightMm + cfg.vGapMm)) * scale;
            return (
              <g key={`${r}-${c}`}>
                <rect x={x} y={y} width={cfg.labelWidthMm * scale} height={cfg.labelHeightMm * scale}
                  fill="#fff" stroke="#111" strokeWidth={1} />
                <text x={x + 6} y={y + 16} fontSize={10} fontWeight={700}>SAMPLE</text>
                <text x={x + 6} y={y + 30} fontSize={8}>SKU-{r}{c}</text>
                <text x={x + 6} y={y + 44} fontSize={11} fontWeight={800}>₹199</text>
                <rect x={x + 6} y={y + cfg.labelHeightMm * scale - 26} width={cfg.labelWidthMm * scale - 12} height={16} fill="url(#stripes)" />
              </g>
            );
          })
        )}
        <defs>
          <pattern id="stripes" width="3" height="16" patternUnits="userSpaceOnUse">
            <rect width="1.5" height="16" fill="#111" />
          </pattern>
        </defs>
      </svg>
      <div className="text-[10px] text-muted-foreground text-center mt-1">
        {cfg.paperWidthMm}mm roll · {cfg.columns}×{cfg.labelWidthMm}×{cfg.labelHeightMm}mm labels · scale {scale}px/mm
      </div>
    </div>
  );
}

function SampleInputs({ cfg }: { cfg: PrinterProfileConfig }) {
  const [name, setName] = useState("Sample Product");
  const [sku, setSku] = useState("SKU-001");
  const [price, setPrice] = useState("199");
  const [batch, setBatch] = useState("B001");
  const [barcode, setBarcode] = useState("1234567890128");
  const [qr, setQr] = useState("");

  const printOne = () => {
    const items = Array.from({ length: cfg.columns }, () => ({ productName: name, sku, price, batch, barcode, qr }));
    printTsplDirect(tsplPrintJob(items, cfg), `labels-${sku}.prn`).then(() => toast.success("Sample labels sent to the selected printer")).catch((e: any) => toast.error(e?.message || "Label print failed"));
  };
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-xs font-semibold flex items-center gap-1"><Printer className="h-3.5 w-3.5" /> Print one test row</div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Product name" value={name} onChange={e => setName(e.target.value)} />
        <Input placeholder="SKU" value={sku} onChange={e => setSku(e.target.value)} />
        <Input placeholder="Price" value={price} onChange={e => setPrice(e.target.value)} />
        <Input placeholder="Batch no." value={batch} onChange={e => setBatch(e.target.value)} />
        <Input placeholder="Barcode (Code128)" value={barcode} onChange={e => setBarcode(e.target.value)} />
        <Input placeholder="QR (optional)" value={qr} onChange={e => setQr(e.target.value)} />
      </div>
      <Button size="sm" onClick={printOne}><Printer className="h-3.5 w-3.5 mr-1" /> Print sample</Button>
    </div>
  );
}
