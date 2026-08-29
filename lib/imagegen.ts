import OpenAI from "openai";

// In-app image generation. The codegen model references images by a stable path
// convention — /riff-gen/<kebab-description>.png — and the agent fills those in
// with real generated images after the code is written. This keeps generation
// out of the model's JSON payload (which would blow the token budget) while still
// letting a prompt like "a travel page with a hero photo of Iceland" end up with
// an actual photo on the page.
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

// Turn a /riff-gen/<slug>.png path into a human prompt for the image model.
export function promptFromSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\.(png|jpe?g|webp)$/i, "").trim();
}

// Find every /riff-gen/<slug>.<ext> referenced across a set of file contents.
export function findGenRefs(contents: string[]): string[] {
  const re = /\/riff-gen\/([A-Za-z0-9_-]+\.(?:png|jpe?g|webp))/g;
  const set = new Set<string>();
  for (const c of contents) { let m; while ((m = re.exec(c))) set.add(m[1]); }
  return [...set];
}

export function imageGenEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY && process.env.RIFF_IMAGEGEN !== "0";
}

// Generate a single image, returned as raw PNG bytes (base64-decoded).
export async function generateImage(prompt: string): Promise<Buffer> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // gpt-image-1 returns base64 by default (no response_format param, which the
  // current API rejects for dall-e-3 anyway).
  const r = await client.images.generate({
    model: MODEL,
    prompt: `${prompt}. High quality, clean, suitable as a website asset.`,
    size: "1024x1024",
    n: 1,
  });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("image model returned no data");
  return Buffer.from(b64, "base64");
}
