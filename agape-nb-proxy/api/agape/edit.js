// api/agape/edit.js
// Stable minimal version for ChatGPT Action compatibility

export const config = { runtime: "nodejs" };

const FAL_ENDPOINT = "https://fal.run/fal-ai/nano-banana-pro/edit";

const ASSETS = {
  bottle_with_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_with_cap.png",
  bottle_without_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_without_cap.png",
  bottle_small_335ml: "https://sendmelab.com/itag/gpts/Bottle-Small.png",
};

function pickBottle(sku, tapa) {
  if (sku === "335ml") return ASSETS.bottle_small_335ml;
  return tapa
    ? ASSETS.bottle_with_cap_600ml
    : ASSETS.bottle_without_cap_600ml;
}

function buildBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const mode = body.mode || "publicitario";
    const scene = body.scene || "Recreate reference composition exactly.";
    const sku = body.sku || "600ml";
    const tapa = body.tapa !== false;
    const aspect_ratio = body.aspect_ratio || "9:16";
    const resolution = body.resolution || "1K";
    const reference_image_url = body.reference_image_url || "";

    const bottleUrl = pickBottle(sku, tapa);

    const hasRef =
      reference_image_url &&
      (reference_image_url.startsWith("http://") ||
        reference_image_url.startsWith("https://"));

    const prompt = `
Premium editorial beverage photography.

${scene}

PRODUCT LOCK:
- Preserve bottle geometry and label exactly.
- Do NOT recreate typography.
- Keep blue butterfly, macaw, orchid and mountain logo visible.

REFERENCE DOMINANCE:
- Match camera angle, framing, lens, distance and lighting EXACTLY.
- Do NOT recenter.
- Do NOT clean composition.
- Preserve asymmetry and lifestyle energy.
`.trim();

    const image_urls = hasRef
      ? [reference_image_url, bottleUrl]
      : [bottleUrl];

    const falResponse = await fetch(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_urls,
        aspect_ratio,
        resolution,
        output_format: "png",
        num_images: 1,
      }),
    });

    const data = await falResponse.json();

    if (!falResponse.ok || !data?.images?.[0]?.url) {
      return res.status(500).json({ ok: false });
    }

    const rawUrl = data.images[0].url;
    const base = buildBaseUrl(req);
    const proxyUrl = `${base}/api/agape/image?src=${encodeURIComponent(
      rawUrl
    )}`;

    const render_markdown = `![Agape](${proxyUrl})`;
    const download_markdown = `Download:\n${rawUrl}`;

    // 🔥 MINIMAL RESPONSE (NO EXTRA FIELDS)
    return res.status(200).json({
      ok: true,
      render_markdown,
      download_markdown,
    });
  } catch (error) {
    return res.status(500).json({ ok: false });
  }
}
