export const config = { runtime: "nodejs" };

import sharp from "sharp";

export default async function handler(req, res) {
  try {
    const src = req.query?.src;
    if (!src || typeof src !== "string") return res.status(400).send("Missing src");

    const u = new URL(src);
    const allowed = ["fal.media", "v3b.fal.media", "storage.googleapis.com"];
    if (!allowed.some((d) => u.hostname.endsWith(d))) return res.status(403).send("Host not allowed");

    const r = await fetch(src, { redirect: "follow" });
    if (!r.ok) return res.status(502).send("Upstream failed");

    const input = Buffer.from(await r.arrayBuffer());

    // Resize to 300px width (keeps aspect ratio)
    const out = await sharp(input)
      .resize({ width: 300, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();

    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    return res.status(200).send(out);
  } catch (e) {
    return res.status(500).send("Server error");
  }
}
