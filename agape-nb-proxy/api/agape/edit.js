// api/agape/edit.js
// Vercel Serverless Function (Node.js) -> calls fal Nano Banana Pro (edit)
// Supports OPTIONAL reference_image_url to match camera angle/framing (no cloning)

export const config = { runtime: "nodejs" };

const FAL_ENDPOINT = "https://fal.run/fal-ai/nano-banana-pro/edit";

// Official assets (ONLY these)
const ASSETS = {
  bottle_with_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_with_cap.png",
  bottle_without_cap_600ml:
    "https://sendmelab.com/itag/gpts/bottle_without_cap.png",
  bottle_small_335ml: "https://sendmelab.com/itag/gpts/Bottle-Small.png",
};

// Allowed enums (defensive)
const ALLOWED_MODES = new Set([
  "naturaleza",
  "spot",
  "corporativo",
  "caribe",
  "publicitario",
]);

const ALLOWED_SKUS = new Set(["600ml", "335ml"]);

const ALLOWED_ASPECTS = new Set([
  "auto",
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
]);

const ALLOWED_RESOLUTIONS = new Set(["1K", "2K", "4K"]);

// ---------- helpers ----------
function isString(x) {
  return typeof x === "string";
}

function clampString(x, maxLen = 500) {
  if (!isString(x)) return "";
  const s = x.trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function clampEnum(x, allowed, fallback) {
  const v = clampString(x, 50).toLowerCase();
  return allowed.has(v) ? v : fallback;
}

function clampEnumCaseSensitive(x, allowed, fallback) {
  const v = clampString(x, 20);
  return allowed.has(v) ? v : fallback;
}

function toBool(x, fallback = true) {
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "string") {
    const v = x.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(v)) return true;
    if (["false", "0", "no", "n"].includes(v)) return false;
  }
  return fallback;
}

function looksLikeUrl(u) {
  if (!isString(u)) return false;
  const s = u.trim();
  return s.startsWith("https://") || s.startsWith("http://");
}

function pickBottle({ sku = "600ml", tapa = true }) {
  if (sku === "335ml") return ASSETS.bottle_small_335ml;
  return tapa ? ASSETS.bottle_with_cap_600ml : ASSETS.bottle_without_cap_600ml;
}

function modeStyle(mode = "") {
  switch ((mode || "").toLowerCase()) {
    case "naturaleza":
      return "Costa Rica lush tropical nature, documentary realism, fresh atmosphere, natural daylight, subtle mist.";
    case "spot":
      return "Premium advertising spot look, controlled key light, cinematic highlights, clean composition, high-end beverage photography.";
    case "corporativo":
      return "Modern executive environment, clean architecture, refined materials, controlled natural daylight, minimalist premium style.";
    case "caribe":
      return "Costa Rica tropical beach at golden hour, calm ocean bokeh, wet sand, premium editorial lighting, serene luxury.";
    case "publicitario":
      return "Hero product composition, refined commercial beverage photography, premium editorial look, clean brand-first framing.";
    default:
      return "Premium commercial beverage photography, clean product-first composition.";
  }
}

// stronger label constraints (prevents hallucinated retyping)
const LABEL_RULES = `
LABEL CRITICAL:
- Do NOT recreate typography.
- Do NOT retype or redraw any label text.
- Preserve the exact printed label from the input bottle asset image.
- No hallucinated text, no approximations, no altered units.
- Keep the label fully readable and sharp (no blur on label area).
`.trim();

const PRODUCT_RULES = `
PRODUCT CRITICAL:
Do not modify bottle geometry, proportions, label, or text.
Preserve the product exactly.
Photorealistic commercial beverage photography.
Natural optical physics.
Realistic clear plastic refraction.
Authentic daylight behavior.
No lava. No volcanic eruption. No exaggerated HDR. No 3D look. No external brands/logos.
`.trim();

function buildBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

async function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ---------- handler ----------
export default async function handler(req, res) {
  // Optional CORS (safe defaults)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // sanitize inputs
    const mode = clampEnum(body.mode, ALLOWED_MODES, "publicitario"); // lowercase
    const scene = clampString(body.scene, 650); // keep short-ish
    const sku = clampEnum(body.sku, ALLOWED_SKUS, "600ml"); // lowercase
    const tapa = toBool(body.tapa, true);
    const aspect_ratio = clampEnumCaseSensitive(body.aspect_ratio, ALLOWED_ASPECTS, "9:16");
    const resolution = clampEnumCaseSensitive(body.resolution, ALLOWED_RESOLUTIONS, "1K");

    // optional reference image (for matching camera/angle)
    const reference_image_url = clampString(body.reference_image_url, 800);
    const hasRef = looksLikeUrl(reference_image_url);

    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing FAL_KEY environment variable",
      });
    }

    const bottleUrl = pickBottle({ sku, tapa });

    const REF_RULES = hasRef
      ? `
REFERENCE MODE (composition only):
- Match the camera angle, framing, lens look (35/50/85mm feel), depth of field and bokeh of the reference image.
- Use the reference ONLY for composition/lighting/mood.
- Do NOT copy clothing, faces, brands, logos, text, or unique identifiers from the reference image.
- Create an original scene; the ONLY product is the Agape bottle asset (preserved exactly).
`.trim()
      : "";

    const fullPrompt = `
${modeStyle(mode)}
Scene request: ${scene || "Create the best matching scene for the selected mode."}

${REF_RULES}
${PRODUCT_RULES}
${LABEL_RULES}

COMPOSITION:
- Bottle must be fully visible.
- Label fully readable, sharp, not cropped, not warped.
- Avoid extreme fisheye/wide distortion.
`.trim();

    // IMPORTANT: order matters.
    // If hasRef: [reference, bottle] so model can follow camera take but keep bottle exact.
    // If no ref: [bottle] only.
    const image_urls = hasRef ? [reference_image_url, bottleUrl] : [bottleUrl];

    const falBody = {
      prompt: fullPrompt,
      image_urls,
      aspect_ratio,
      resolution,
      output_format: "png",
      safety_tolerance: "4",
      num_images: 1,
      // DO NOT set sync_mode (you asked not to use it)
    };

    const r = await fetchWithTimeout(
      FAL_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${FAL_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(falBody),
      },
      90000
    );

    let data = null;
    try {
      data = await r.json();
    } catch {
      data = { error: "Invalid JSON from upstream" };
    }

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: "fal_error",
        status: r.status,
        details: data,
      });
    }

    const rawUrl = data?.images?.[0]?.url || null;

    // Build proxy URL (lets ChatGPT embed reliably)
    const base = buildBaseUrl(req);
    const proxyUrl = rawUrl
      ? `${base}/api/agape/image?src=${encodeURIComponent(rawUrl)}`
      : null;

    // Render markdown: ONLY image markdown (your system prompt can print it exactly)
    const render_markdown =
      rawUrl ? `![Agape](${proxyUrl || rawUrl})` : null;

    const download_markdown = rawUrl ? `Download / open:\n${rawUrl}` : null;

    return res.status(200).json({
      ok: true,
      image_url: rawUrl,
      image_proxy_url: proxyUrl,
      render_markdown,
      download_markdown,
      mode, // lowercase
      sku, // lowercase
      tapa,
      aspect_ratio,
      resolution,
      reference_image_url: hasRef ? reference_image_url : null,
    });
  } catch (err) {
    const message =
      err?.name === "AbortError"
        ? "Upstream timeout"
        : err?.message || "Unknown error";

    return res.status(500).json({
      ok: false,
      error: "server_error",
      message,
    });
  }
}
