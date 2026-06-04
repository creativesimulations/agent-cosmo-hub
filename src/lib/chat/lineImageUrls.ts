const LINE_IMAGE_URL =
  /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?$/i;

/** Image URLs that appear alone on a line (e.g. QR image links from Hermes). */
export function extractLineImageUrls(content: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!LINE_IMAGE_URL.test(t) || seen.has(t)) continue;
    seen.add(t);
    urls.push(t);
  }
  return urls;
}
