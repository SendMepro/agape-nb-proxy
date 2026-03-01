// api/agape/edit.js
export const config = { runtime: "nodejs" };

const FAL_ENDPOINT = "https://fal.run/fal-ai/nano-banana-pro/edit";

const ASSETS = {
  bottle_with_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_with_cap.png",
  bottle_without_cap_600ml: "https://sendmelab.com/itag/gpts/bottle_without_cap.png",
  bottle_small_335ml: "https://sendmelab.com/itag/gpts/Bottle-Small.png",
};

function isUrl(s) {
  return typeof s === "string" && (s.startsWith("https://") || s.startsWith("http://"));
}

function pickBottle(sku, tapa) {
  if (sku === "335ml") return ASSETS.bottle_small_335ml; // cap-only asset
  return tapa ? ASSETS.bottle_with_cap_600ml : ASSETS.bottle_without_cap_600ml;
}

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

async function fetchTextJson(url, options) {
  const r = await fetch(url, options);
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { r, data };
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(405).send(JSON.stringify({ ok: false }));
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const FAL_KEY = process.env.FAL_KEY;

    if (!FAL_KEY) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(500).send(JSON.stringify({ ok: false, error: "missing_fal_key" }));
    }

    const sku = (body.sku === "335ml" ? "335ml" : "600ml");
    const tapa = body.tapa === false ? false : true;
    const aspect_ratio = typeof body.aspect_ratio === "string" ? body.aspect_ratio : "9:16";
    const resolution = typeof body.resolution === "string" ? body.resolution : "1K";
    const reference_image_url = typeof body.reference_image_url === "string" ? body.reference_image_url : "";

    const bottleUrl = pickBottle(sku, sku === "335ml" ? true : tapa);
    const hasRef = isUrl(reference_image_url);

    const scene = (typeof body.scene === "string" && body.scene.trim())
      ? body.scene.trim()
      : "Recreate the reference camera/framing/lighting exactly and integrate the official Agape bottle.";

    // Prompt: referencia manda (y NO packshot centrado)
    const prompt = `
${scene}

PRODUCT LOCK:
- Preserve bottle geometry and label exactly.
- Do NOT recreate typography or text.
- Keep label illustrations (blue butterfly, macaw, orchid, mountain-drop logo).

REFERENCE DOMINANCE (MANDATORY):
- Match camera angle, height, tilt, distance, cropping, lens feel, DOF, and lighting direction EXACTLY.
- Do NOT recenter. Do NOT improve symmetry. Do NOT convert to clean packshot.
- Preserve dynamic/asymmetric framing if present in the reference.
`.trim();

    const image_urls = hasRef ? [reference_image_url, bottleUrl] : [bottleUrl];

    const { r, data } = await fetchTextJson(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_urls,
        aspect_ratio,
        resolution,
        output_format: "png",
        num_images: 1,
        safety_tolerance: "4",
      }),
    });

    const rawUrl = data?.images?.[0]?.url || null;

    if (!r.ok || !rawUrl) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(502).send(JSON.stringify({
        ok: false,
        error: "upstream_failed",
        status: r.status,
        details: data
      }));
    }

    const proxy = `${baseUrl(req)}/api/agape/image?src=${encodeURIComponent(rawUrl)}`;

    // ✅ RESPUESTA MÍNIMA Y 100% PARSEABLE POR ACTIONS
    const out = {
      ok: true,
      render_markdown: `![Agape](${proxy})`,
      download_markdown: `Download:\n${rawUrl}`
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(JSON.stringify(out));
  } catch (e) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(500).send(JSON.stringify({ ok: false, error: "server_error" }));
  }
}
