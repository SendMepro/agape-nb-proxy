// api/agape/edit.js

export const config = {
  runtime: "nodejs",
};

const FAL_ENDPOINT = "https://fal.run/fal-ai/nano-banana-pro/edit";

const ASSETS = {
  bottle_with_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_with_cap.png",
  bottle_without_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_without_cap.png",
  bottle_small_335ml: "https://sendmelab.com/itag/gpts/Bottle-Small.png",
};

function pickBottle({ sku = "600ml", tapa = true }) {
  if (sku === "335ml") return ASSETS.bottle_small_335ml;
  return tapa ? ASSETS.bottle_with_cap_600ml : ASSETS.bottle_without_cap_600ml;
}

function modeStyle(mode = "") {
  switch (mode.toLowerCase()) {
    case "naturaleza":
      return "documentary tropical nature, real Costa Rica, natural daylight, authentic textures, no dramatization";
    case "spot":
      return "clean commercial spot look, controlled lighting, premium but realistic, simple composition";
    case "corporativo":
      return "corporate minimal look, clean background, sober premium lighting, institutional style";
    case "caribe":
      return "fresh Caribbean natural look, bright but real light, turquoise ocean bokeh, no resort glam exaggeration";
    case "publicitario":
      return "advertising hero product composition, poster-like framing, product dominant, realistic";
    default:
      return "natural realistic lifestyle, documentary look, real light";
  }
}

function buildFalPrompt({ mode, scene }) {
  const productLock = `
Do not modify bottle geometry, proportions, label, or text. Preserve the product exactly.
Do not warp the bottle. Do not change the cap. Do not invent logos. Do not alter typography.
Photorealistic commercial beverage photography. Natural optical physics.
Realistic plastic refraction and reflections. Real condensation droplets.
Authentic daylight behavior. No HDR exaggeration. No volumetric rays. No 3D render look.
No volcano eruption, no lava, no catastrophes. No external brands or logos.
`;

  const style = modeStyle(mode);
  const userScene = (scene || "").trim() || "real Costa Rica environment, tasteful composition, natural light";

  return `
${productLock}

Scene direction:
${style}.
${userScene}.

Camera:
real camera feel, realistic depth of field, natural bokeh, subtle color grading.

Product framing:
hero product, readable label, correct proportions, realistic scale.
`.trim();
}

export default async function handler(req, res) {
  // CORS (por si lo pruebas desde web)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) return res.status(500).json({ ok: false, error: "Missing FAL_KEY on Vercel env" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      mode = "naturaleza",
      scene = "",
      sku = "600ml",           // "600ml" | "335ml"
      tapa = true,             // true | false
      aspect_ratio = "9:16",
      resolution = "1K",       // "1K" | "2K" | "4K"
      output_format = "png",
      safety_tolerance = "4",
    } = body || {};

    const bottleUrl = pickBottle({ sku, tapa });
    const prompt = buildFalPrompt({ mode, scene });

    const falBody = {
      prompt,
      image_urls: [bottleUrl],
      num_images: 1,
      aspect_ratio,
      output_format,
      safety_tolerance: String(safety_tolerance),
      resolution,
      // NO sync_mode -> evita ResponseTooLargeError
    };

    const r = await fetch(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(falBody),
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: "fal_error",
        status: r.status,
        details: data,
      });
    }

    return res.status(200).json({
      ok: true,
      image_url: data?.images?.[0]?.url || null,
      mode,
      sku,
      tapa,
      aspect_ratio,
      resolution,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", message: e?.message || String(e) });
  }
}