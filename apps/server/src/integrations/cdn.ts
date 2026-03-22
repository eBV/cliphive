/**
 * Cloudflare CDN utilities — cache purge and URL construction.
 */
import axios from "axios";
import { config } from "../config.js";

const CF_ACCOUNT_ID = config.CLOUDFLARE_ZONE_ID;
const CF_API_TOKEN = config.CLOUDFLARE_API_TOKEN;
const CDN_BASE_URL = config.CDN_BASE_URL;

/**
 * Purge specific URLs from Cloudflare cache.
 */
export async function purgeUrls(urls: string[]): Promise<void> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return; // Skip in dev

  await axios.post(
    `https://api.cloudflare.com/client/v4/zones/${CF_ACCOUNT_ID}/purge_cache`,
    { files: urls },
    { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
  );
}

/**
 * Purge a single render key from CDN cache.
 */
export async function purgeRender(s3Key: string): Promise<void> {
  const url = `${CDN_BASE_URL}/${s3Key}`;
  await purgeUrls([url]);
}

/**
 * Construct CDN URL for a renders bucket object.
 */
export function renderCdnUrl(s3Key: string): string {
  return `${CDN_BASE_URL}/${s3Key}`;
}
