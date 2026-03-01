// api/agape/edit.js
// Vercel Serverless Function (Node.js) -> calls fal Nano Banana Pro (edit)
// Reference-first composition: when reference_image_url is provided, camera/framing MUST match reference.
// Product/label lock remains strict.

export const config = { runtime: "nodejs" };

const FAL_ENDPOINT = "https://fal.run/fal-ai/nano-banana-pro/edit";

// Official assets (ONLY these)
const ASSETS = {
  bottle_with_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_with_cap.png",
  bottle_without_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_without_cap.png",
  bottle_small_335ml: "https://sendmelab.com/itag/gpts/Bottle-Small.png",
};

// Allowed enums (defensive)
const ALLOWED_MODES = new Set(["naturaleza", "spot", "corporativo", "caribe", "publicitario"]);
const ALLOWED_SKUS = new Set(["600ml", "335ml"]);
const ALLOWED_ASPECTS = new Set(["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"]);
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
  // 335ml only exists with cap (asset reality)
  if (sku === "335ml") return ASSETS.bottle_small_335ml;
  return tapa ? ASSETS.bottle_with_cap_600ml : ASSETS.bottle_without_cap_600ml;
}

function modeStyle(mode = "") {
  switch ((mode || "").toLowerCase()) {
    case "naturaleza":
      return "Costa Rica lush tropical nature, documentary realism, fresh atmosphere, natural daylight, subtle mist.";
    case "spot":
      return "Premium advertising spot look, controlled key light, cinematic highlights, high-end beverage photography.";
    case "corporativo":
      return "Modern executive environment, clean architecture, refined materials, controlled natural daylight, minimalist premium style.";
    case "caribe":
      return "Costa Rica tropical beach at golden hour, calm ocean bokeh, wet sand, premium editorial lighting, serene luxury.";
    case "publicitario":
      return "Premium editorial beverage photography, high contrast when needed, brand-first but natural framing (unless reference overrides).";
    default:
      return "Premium editorial beverage photography, natural optical physics.";
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
- Agape must be the primary focal product.
`.trim();

const PRODUCT_RULES = `
PRODUCT CRITICAL:
- Do not modify bottle geometry, proportions, cap, label, or text.
- Preserve the product exactly (photorealistic).
- Natural optical physics, realistic clear plastic refraction.
- No external brands/logos.
`.trim();

// IMPORTANT: We RELAX "centered hero framing" in reference mode.
// We still keep label readable, but we do NOT force centered packshot.
const COMPOSITION_RULES_BASE = `
COMPOSITION:
- Bottle must be fully visible when possible.
- Label must be readable and sharp.
- Avoid fisheye/extreme distortion.
`.trim();

const COMPOSITION_RULES_REFERENCE = `
COMPOSITION (REFERENCE OVERRIDES DEFAULTS):
- DO NOT recenter the bottle if the reference is off-center.
- DO NOT clean up the framing into a packshot.
- Preserve asymmetry, dynamic cropping, and spontaneous framing if present.
- Bottle can be placed where the reference product is placed.
- If reference includes lifestyle energy, keep that energy (people/hand/setting) BUT keep Agape as the only branded bottle.
- Label must remain readable; if occlusion occurs, keep label mostly visible and sharp.
`.trim();

const REFERENCE_DOMINANCE = `
REFERENCE COMPOSITION DOMINANCE (MANDATORY):
The reference image composition has ABSOLUTE priority.

You MUST replicate EXACTLY:
- Camera angle, camera height, camera tilt
- Distance to subject (framing tightness)
- Subject scale within frame
- Cropping style and placement
- Lens compression / focal length feeling
- Depth of field style
- Light direction + rim highlights + contrast intensity

Do NOT:
- Recenter the bottle
- Improve symmetry
- Convert into centered commercial packshot
- Switch to hero frontal view
- Change perspective
`.trim();

// ---------- handler ----------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed", status: 405 });
  }

  try {
    // req.body can arrive as string
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

    const mode = clampEnumLower(body.mode, ALLOWED_MODES, "publicitario");
    const scene = clampString(body.scene, 650);
    const sku = clampEnumLower(body.sku, ALLOWED_SKUS, "600ml");

    let tapa = toBool(body.tapa, true);
    if (sku === "335ml") tapa = true;

    const aspect_ratio = clampEnumCaseSensitive(body.aspect_ratio, ALLOWED_ASPECTS, "9:16");
    const resolution = clampEnumCaseSensitive(body.resolution, ALLOWED_RESOLUTIONS, "1K");

    const reference_image_url = clampString(body.reference_image_url, 800);
    const hasRef = looksLikeUrl(reference_image_url);

    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) {
      return res.status(500).json({ ok: false, error: "missing_fal_key", status: 500 });
    }

    const bottleUrl = pickBottle({ sku, tapa });

    // Scene default
    const sceneLine =
      scene || (hasRef
        ? "Reinterpret the reference composition exactly, integrating the official Agape bottle asset."
        : "Create the best matching scene for the selected mode.");

    // Reference rules — NOTE: placed at END of prompt for highest priority
    const REF_RULES = hasRef
      ? `
${REFERENCE_DOMINANCE}

REFERENCE USAGE RULES:
- Use the reference ONLY for camera, framing, lighting direction, mood, and environment structure.
- Preserve dynamic lifestyle energy if present in reference (movement, crowd, hands, spontaneity).
- Do NOT copy brands/logos/text/faces from the reference.
- The ONLY branded bottle must be Agape (from the official asset).
- Keep the Agape label sharp and readable.
`.trim()
      : "";

    // Choose composition rules based on reference
    const compositionBlock = hasRef
      ? `${COMPOSITION_RULES_BASE}\n\n${COMPOSITION_RULES_REFERENCE}`
      : COMPOSITION_RULES_BASE;

    // ✅ CRITICAL CHANGE: Reference rules go LAST (strongest)
    const fullPrompt = `
${modeStyle(mode)}
Scene request: ${sceneLine}

${PRODUCT_RULES}
${LABEL_RULES}
${LABEL_INTEGRITY_LOCK}
${PRODUCT_HIERARCHY}
${compositionBlock}

${REF_RULES}
`.trim();

    // Order matters: reference first, then bottle asset
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

    // Always parse as text first (prevents HTML breaking tool)
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
        status: r.status,
        details: data,
      });
    }

    const rawUrl = data?.images?.[0]?.url || null;
    if (!rawUrl) {
      return res.status(502).json({
        ok: false,
        error: "no_image_returned",
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
    const message = err?.name === "AbortError" ? "Upstream timeout" : err?.message || "Unknown error";
    return res.status(500).json({ ok: false, error: "server_error", message, status: 500 });
  }
}
