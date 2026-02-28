export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const src = req.query?.src;
    if (!src || typeof src !== "string") return res.status(400).send("Missing src");

    const u = new URL(src);
    const allowed = ["fal.media", "v3b.fal.media", "storage.googleapis.com"];
    if (!allowed.some((d) => u.hostname.endsWith(d))) return res.status(403).send("Host not allowed");

    const r = await fetch(src, { redirect: "follow" });
    if (!r.ok) return res.status(502).send("Upstream failed");

    res.setHeader("Content-Type", r.headers.get("content-type") || "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Disposition", "inline");

    const buf = Buffer.from(await r.arrayBuffer());
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).send("Server error");
  }
}
