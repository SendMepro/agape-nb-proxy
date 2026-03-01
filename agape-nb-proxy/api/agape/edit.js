// api/agape/edit.js
// Vercel Serverless Function (Node.js) -> calls fal Nano Banana Pro (edit)
// Supports OPTIONAL reference_image_url to match camera angle/framing (no cloning)

export const config = { runtime: "nodejs" };

const FAL_ENDPOINT = "https://fal.run/fal-ai/nano-banana-pro/edit";

// Official assets (ONLY these)
const ASSETS = {
  bottle_with_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_with_cap.png",
  bottle_without_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_without_cap.png",
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

function clampString(x, maxLen = 800) {
  if (!isString(x)) return "";
  const s = x.trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function clampEnumLower(x, allowed, fallback) {
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
  // 335ml only exists with cap
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

function buildBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

async function fetchWithTimeout(url, options, timeoutMs = 90000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ---------- prompt locks ----------
const LABEL_RULES = `
LABEL CRITICAL:
- Do NOT recreate typography.
- Do NOT retype or redraw any label text.
- Preserve the exact printed label from the input bottle asset image.
- No hallucinated text, no approximations, no altered units.
- Keep the label fully readable and sharp (no blur on label area).
`.trim();

const LABEL_INTEGRITY_LOCK = `
LABEL INTEGRITY LOCK:
- Keep ALL label illustrations exactly as printed on the input asset.
- Mandatory: blue butterfly (upper-left), red macaw, pink orchid, mountain-drop logo.
- Do NOT remove, simplify, restyle, or omit any printed illustration.
`.trim();

const PRODUCT_HIERARCHY = `
PRODUCT HIERARCHY:
- The Agape bottle is the ONLY branded beverage visible.
- No other water bottles or bottled beverages.
- Other drinks are allowed ONLY in neutral, unbranded glasses (no labels), and must stay secondary.
- Agape must be the sharpest, dominant focal point.
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

const COMPOSITION_RULES = `
COMPOSITION:
- Bottle must be fully visible.
- Label fully readable, sharp, not cropped, not warped.
- Avoid extreme fisheye/wide distortion.
- Keep bottle scale believable (no giant/miniature bottle unless user explicitly asks).
`.trim();

// ---------- handler ----------
export default async function handler(req, res) {
  // Optional CORS (safe defaults)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      message: "Method not allowed",
      status: 405,
    });
  }

  try {
    // ✅ FIX: req.body can arrive as a string in serverless/action calls
    const raw = req.body ?? {};
    const body =
      typeof raw === "string"
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return {};
            }
          })()
        : raw;

    // sanitize inputs
    const mode = clampEnumLower(body.mode, ALLOWED_MODES, "publicitario");
    const scene = clampString(body.scene, 650);
    const sku = clampEnumLower(body.sku, ALLOWED_SKUS, "600ml");

    // IMPORTANT: 335ml is cap-only. If user tries 335ml + tapa=false, force true.
    let tapa = toBool(body.tapa, true);
    if (sku === "335ml") tapa = true;

    const aspect_ratio = clampEnumCaseSensitive(
      body.aspect_ratio,
      ALLOWED_ASPECTS,
      "9:16"
    );
    const resolution = clampEnumCaseSensitive(
      body.resolution,
      ALLOWED_RESOLUTIONS,
      "1K"
    );

    // optional reference image (for matching camera/angle)
    const reference_image_url = clampString(body.reference_image_url, 800);
    const hasRef = looksLikeUrl(reference_image_url);

    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) {
      return res.status(500).json({
        ok: false,
        error: "missing_fal_key",
        message: "Missing FAL_KEY environment variable",
        status: 500,
      });
    }

    const bottleUrl = pickBottle({ sku, tapa });

    const REF_RULES = hasRef
      ? `
REFERENCE MODE (composition only):
- Match the camera angle, framing, lens look, depth of field and bokeh of the reference image.
- Use the reference ONLY for composition/lighting/mood.
- Do NOT copy clothing, faces, brands, logos, text, or unique identifiers from the reference.
- Create an original scene; the ONLY branded product is the Agape bottle asset (preserved exactly).
`.trim()
      : "";

    const fullPrompt = `
${modeStyle(mode)}
Scene request: ${scene || "Create the best matching scene for the selected mode."}

${REF_RULES}
${PRODUCT_RULES}
${LABEL_RULES}
${LABEL_INTEGRITY_LOCK}
${PRODUCT_HIERARCHY}
${COMPOSITION_RULES}
`.trim();

    // If hasRef: [reference, bottle] so model follows camera take but keeps bottle exact.
    const image_urls = hasRef ? [reference_image_url, bottleUrl] : [bottleUrl];

    const falBody = {
      prompt: fullPrompt,
      image_urls,
      aspect_ratio,
      resolution,
      output_format: "png",
      safety_tolerance: "4",
      num_images: 1,
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

    // ✅ Always parse as text first, then JSON (prevents HTML/non-JSON breaking your tool)
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: "fal_error",
        message: "Upstream (fal) returned an error",
        status: r.status,
        details: data,
      });
    }

    const rawUrl = data?.images?.[0]?.url || null;

    if (!rawUrl) {
      return res.status(502).json({
        ok: false,
        error: "no_image_returned",
        message: "fal returned no images",
        status: 502,
        details: data,
      });
    }

    const base = buildBaseUrl(req);
    const proxyUrl = `${base}/api/agape/image?src=${encodeURIComponent(rawUrl)}`;

    const render_markdown = `![Agape](${proxyUrl || rawUrl})`;
    const download_markdown = `Download / open:\n${rawUrl}`;

    return res.status(200).json({
      ok: true,
      image_url: rawUrl,
      image_proxy_url: proxyUrl,
      render_markdown,
      download_markdown,
      mode,
      sku,
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
      status: 500,
    });
  }
}
