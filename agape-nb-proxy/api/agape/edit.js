// api/agape/edit.js

export const config = { runtime: "nodejs" };

const FAL_ENDPOINT = "https://fal.run/fal-ai/nano-banana-pro/edit";

const ASSETS = {
  bottle_with_cap_600ml:
    "https://sendmelab.com/itag/gpts/bottle_with_cap.png",
  bottle_without_cap_600ml:
    "https://sendmelab.com/itag/gpts/bottle_without_cap.png",
  bottle_small_335ml:
    "https://sendmelab.com/itag/gpts/Bottle-Small.png",
};

function pickBottle({ sku = "600ml", tapa = true }) {
  if (sku === "335ml") return ASSETS.bottle_small_335ml;
  return tapa
    ? ASSETS.bottle_with_cap_600ml
    : ASSETS.bottle_without_cap_600ml;
}

function modeStyle(mode = "") {
  switch (mode.toLowerCase()) {
    case "naturaleza":
      return "Lush tropical nature, natural light, fresh atmosphere.";
    case "spot":
      return "High-end commercial studio lighting, dramatic highlights.";
    case "corporativo":
      return "Modern executive environment, clean architecture, controlled daylight.";
    case "caribe":
      return "Golden hour tropical beach, calm ocean bokeh, wet sand, premium editorial lighting.";
    case "publicitario":
      return "Hero product composition, refined commercial beverage photography.";
    default:
      return "Premium commercial beverage photography.";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const {
      mode = "publicitario",
      scene = "",
      sku = "600ml",
      tapa = true,
      aspect_ratio = "9:16",
      resolution = "1K",
    } = req.body || {};

    const FAL_KEY = process.env.FAL_KEY;

    if (!FAL_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing FAL_KEY environment variable",
      });
    }

    const bottleUrl = pickBottle({ sku, tapa });

    const systemRules = `
Do not modify bottle geometry, proportions, label, or text.
Preserve the product exactly.
Photorealistic commercial beverage photography.
Natural optical physics.
Realistic plastic refraction.
Authentic daylight behavior.
No lava.
No volcanic eruption.
No exaggerated HDR.
No 3D look.
No external brands.
`.trim();

    const fullPrompt = `
${modeStyle(mode)}
${scene}
${systemRules}
`.trim();

    const falBody = {
      prompt: fullPrompt,
      image_urls: [bottleUrl],
      aspect_ratio,
      resolution,
      output_format: "png",
      safety_tolerance: "4",
      num_images: 1,
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

    const rawUrl = data?.images?.[0]?.url || null;

    // Construir dominio base actual (Vercel)
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const base = `${proto}://${host}`;

    const proxyUrl = rawUrl
      ? `${base}/api/agape/image?src=${encodeURIComponent(rawUrl)}`
      : null;

    const renderUrl = proxyUrl || rawUrl || "";

    const renderMarkdown = renderUrl
      ? `![Agape](${renderUrl})

Descargar / abrir:
${rawUrl || renderUrl}

Modo: ${mode}
SKU: ${sku}
Aspect ratio: ${aspect_ratio}
Resolución: ${resolution}
`
      : "No image generated.";

    const render = rawUrl
  ? `![Agape](${proxyUrl || rawUrl})`
  : null;

const download = rawUrl
  ? `Download / open:\n${rawUrl}`
  : null;

return res.status(200).json({
  ok: true,
  image_url: rawUrl,
  image_proxy_url: proxyUrl,
  render_markdown: render,
  download_markdown: download,
  mode,
  sku,
  tapa,
  aspect_ratio,
  resolution,
});
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: err.message,
    });
  }
}


