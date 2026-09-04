// AI + real database barcode/product enrichment.
//   1) Try Open Food Facts (free, no key, huge FMCG/grocery DB, worldwide + India)
//   2) Fall back to Lovable AI (Gemini) with strict validation:
//        - GST slab MUST be one of 0/5/12/18/28
//        - MRP > 0
//        - flag low-confidence responses as `needs_review`
//
// Response shape (both paths):
// {
//   ok: true,
//   source: "openfoodfacts" | "ai",
//   needs_review: boolean,          // true = show a warning, don't auto-save silently
//   suggestion: { name, brand?, category?, unit, hsn_code?, gst_rate, mrp, sale_price?, purchase_price?, confidence, notes? }
// }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_GST = [0, 5, 12, 18, 28];

function nearestGst(n: number): number {
  if (!Number.isFinite(n)) return 18;
  let best = 18, diff = Infinity;
  for (const v of VALID_GST) {
    const d = Math.abs(v - n);
    if (d < diff) { diff = d; best = v; }
  }
  return best;
}

function guessGstFromCategory(cat?: string): number {
  const c = (cat ?? "").toLowerCase();
  if (!c) return 18;
  if (/(milk|bread|atta|rice|wheat|flour|salt|fresh|vegetable|fruit)/.test(c)) return 0;
  if (/(sugar|tea|coffee|edible oil|spice|packaged food|snack|biscuit|namkeen|noodle|pasta|frozen)/.test(c)) return 5;
  if (/(butter|cheese|ghee|jam|sauce|ketchup|juice|dairy)/.test(c)) return 12;
  if (/(soap|shampoo|toothpaste|detergent|cosmetic|personal care|stationery|electronic|appliance|beverage|chocolate)/.test(c)) return 18;
  if (/(aerated|soft drink|cola|tobacco|luxury)/.test(c)) return 28;
  return 18;
}

function parseWeight(qty?: string): string | null {
  if (!qty) return null;
  const m = qty.replace(/\s+/g, "").toUpperCase().match(/(\d+(?:\.\d+)?)(G|KG|ML|L|LT|LTR)/);
  if (!m) return qty.toUpperCase();
  return `${m[1]}${m[2] === "LT" || m[2] === "LTR" ? "L" : m[2]}`;
}

async function lookupOpenFoodFacts(barcode: string) {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,categories,quantity,image_front_small_url,nutriscore_grade,countries_tags`;
    const r = await fetch(url, { headers: { "User-Agent": "MarginERP/1.0 (retail POS)" } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const name = p.product_name || p.brands || null;
    if (!name) return null;
    const brand = (p.brands || "").split(",")[0].trim() || undefined;
    const category = (p.categories || "").split(",").pop()?.trim() || undefined;
    const weight = parseWeight(p.quantity);
    const gst = guessGstFromCategory(category);
    return {
      name: [brand, p.product_name, p.quantity].filter(Boolean).join(" ").trim(),
      brand,
      category,
      unit: weight?.endsWith("L") || weight?.endsWith("ML") ? "LTR" : "PCS",
      hsn_code: undefined,
      gst_rate: gst,
      mrp: 0,               // OFF has no MRP; user fills in
      sale_price: 0,
      purchase_price: 0,
      weight,
      confidence: 0.92,
      notes: "Verified via Open Food Facts. Please set MRP & price.",
    };
  } catch {
    return null;
  }
}

async function lookupAI(barcode: string | undefined, hint: string | undefined, apiKey: string) {
  const system = `You are an Indian retail product database assistant. Given a barcode (EAN/UPC) and/or partial name, infer the MOST LIKELY retail product sold in Indian shops.

STRICT RULES:
- gst_rate MUST be exactly one of: 0, 5, 12, 18, 28 (Indian GST slabs).
- Only return details if you are reasonably confident. Set confidence 0..1 honestly.
  If you have NO idea what this barcode is, set confidence < 0.4 and put a generic placeholder name.
- MRP must be a realistic INR value (>0).
- Do NOT invent brand names for barcodes you don't recognise.`;
  const user = `Barcode: ${barcode ?? "(none)"}\nHint / partial name: ${hint ?? "(none)"}\nReturn your best guess. If unsure, say so via low confidence.`;

  const tools = [{
    type: "function",
    function: {
      name: "fillProduct",
      description: "Return inferred product details for an Indian retail SKU.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          brand: { type: "string" },
          category: { type: "string" },
          unit: { type: "string", description: "PCS, KG, LTR, PKT, BOX" },
          hsn_code: { type: "string" },
          gst_rate: { type: "number", enum: VALID_GST },
          mrp: { type: "number" },
          sale_price: { type: "number" },
          purchase_price: { type: "number" },
          weight: { type: "string", description: "e.g. 100G, 1KG, 250ML" },
          confidence: { type: "number" },
          notes: { type: "string" },
        },
        required: ["name", "unit", "gst_rate", "mrp", "confidence"],
        additionalProperties: false,
      },
    },
  }];

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      tools,
      tool_choice: { type: "function", function: { name: "fillProduct" } },
    }),
  });
  if (!aiRes.ok) throw new Error(`AI ${aiRes.status}: ${await aiRes.text()}`);
  const data = await aiRes.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("AI returned no tool call");
  let args: any = {};
  try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
  // Validate & clamp
  args.gst_rate = nearestGst(Number(args.gst_rate));
  args.mrp = Number(args.mrp) > 0 ? Number(args.mrp) : 0;
  args.confidence = Math.max(0, Math.min(1, Number(args.confidence) || 0));
  return args;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { barcode, hint } = await req.json();
    if (!barcode && !hint) {
      return Response.json({ error: "barcode or hint required" }, { status: 400, headers: cors });
    }

    // 1) Real database first
    if (barcode) {
      const off = await lookupOpenFoodFacts(String(barcode));
      if (off) {
        return Response.json({
          ok: true,
          source: "openfoodfacts",
          needs_review: false,
          suggestion: off,
        }, { headers: cors });
      }
    }

    // 2) AI fallback
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "AI key not configured" }, { status: 500, headers: cors });
    }
    const args = await lookupAI(barcode, hint, apiKey);
    return Response.json({
      ok: true,
      source: "ai",
      needs_review: args.confidence < 0.7 || !args.mrp,
      suggestion: args,
    }, { headers: cors });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500, headers: cors });
  }
});
