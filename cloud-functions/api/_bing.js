import { getStore } from "@edgeone/pages-blob";

const STORE_NAME = "edgeone-pages-home-bing";
const LIST_KEY = "bing/list.json";
const IMAGE_PREFIX = "bing/";
const BING_API = "https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const KEEP_DAYS = 8;

let listCache = null;
let listCacheAt = 0;
let inflight = null;

function getBingStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function imageKey(date) {
  return `${IMAGE_PREFIX}${date}.jpg`;
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeBingDate(startdate) {
  if (typeof startdate !== "string" || !/^\d{8}$/.test(startdate)) return "";
  return `${startdate.slice(0, 4)}-${startdate.slice(4, 6)}-${startdate.slice(6, 8)}`;
}

async function fetchBingItems() {
  const response = await fetch(BING_API, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Bing API returned ${response.status}`);
  }

  const data = await response.json();
  const items = [];

  for (const item of Array.isArray(data?.images) ? data.images : []) {
    if (!item?.url) continue;
    const imageUrl = new URL(item.url, "https://cn.bing.com");
    if (!/(^|\.)bing\.com$/i.test(imageUrl.hostname)) continue;
    const date = normalizeBingDate(item.startdate);
    if (!isDate(date)) continue;
    items.push({
      date,
      copyright: item.copyright || "",
      title: item.title || "",
      imageUrl: imageUrl.toString(),
    });
  }

  const byDate = new Map();
  for (const item of items) byDate.set(item.date, item);
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function downloadBingImage(imageUrl) {
  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Accept: "image/jpeg,image/*;q=0.9",
      Referer: "https://cn.bing.com/",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`Bing image returned ${response.status}`);
  }

  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 10000) {
    throw new Error(`Bing image is too small: ${buffer.byteLength} bytes`);
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Bing image is too large: ${buffer.byteLength} bytes`);
  }

  return { buffer, contentType };
}

export async function readBingList() {
  if (listCache && Date.now() - listCacheAt < 60000) {
    return listCache;
  }
  const list = await getBingStore().get(LIST_KEY, { type: "json" });
  listCache = list;
  listCacheAt = Date.now();
  return list;
}

export async function readBingImage(date) {
  if (!isDate(date)) return null;
  return getBingStore().get(imageKey(date), { type: "arrayBuffer" });
}

async function doEnsureBingImages() {
  const store = getBingStore();

  const existing = (await store.get(LIST_KEY, { type: "json" })) || { items: [] };
  const existingByDate = new Map(
    (Array.isArray(existing.items) ? existing.items : [])
      .filter((item) => isDate(item.date))
      .map((item) => [item.date, item]),
  );

  const fresh = await fetchBingItems();
  const merged = new Map(existingByDate);
  for (const item of fresh) {
    merged.set(item.date, { ...(existingByDate.get(item.date) || {}), ...item });
  }

  const sorted = [...merged.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, KEEP_DAYS);

  const { blobs } = await store.list({ prefix: IMAGE_PREFIX });
  const existingKeys = new Set(blobs.map((blob) => blob.key));
  const missing = sorted.filter((item) => !existingKeys.has(imageKey(item.date)));

  const downloaded = new Map();
  const errors = [];

  const results = await Promise.allSettled(
    missing.map(async (item) => {
      const image = await downloadBingImage(item.imageUrl);
      await store.set(imageKey(item.date), image.buffer);
      return { date: item.date, contentType: image.contentType, bytes: image.buffer.byteLength };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      downloaded.set(result.value.date, result.value);
    } else {
      errors.push(String(result.reason?.message || result.reason));
    }
  }

  // 单张失败时再补一次，尽量保证至少 7 天
  for (const item of missing.filter((entry) => !downloaded.has(entry.date))) {
    try {
      const image = await downloadBingImage(item.imageUrl);
      await store.set(imageKey(item.date), image.buffer);
      downloaded.set(item.date, {
        date: item.date,
        contentType: image.contentType,
        bytes: image.buffer.byteLength,
      });
    } catch (error) {
      errors.push(`${item.date}: ${String(error?.message || error)}`);
    }
  }

  const finalItems = [];
  for (const item of sorted) {
    const key = imageKey(item.date);
    const download = downloaded.get(item.date);
    if (!existingKeys.has(key) && !download) continue;

    const previous = existingByDate.get(item.date) || {};
    finalItems.push({
      date: item.date,
      key,
      copyright: item.copyright || previous.copyright || "",
      title: item.title || previous.title || "",
      contentType: download?.contentType || previous.contentType || "image/jpeg",
      bytes: download?.bytes || previous.bytes || 0,
    });
  }

  if (finalItems.length === 0) {
    throw new Error("No Bing images available");
  }

  const list = {
    updatedAt: new Date().toISOString(),
    days: finalItems.length,
    items: finalItems,
  };
  await store.setJSON(LIST_KEY, list);

  // 旧版本保存的是 current.jpg / current.json，迁移后清理掉
  try {
    await store.delete("current.jpg");
    await store.delete("current.json");
  } catch {
    // 清理失败不影响本次结果
  }

  listCache = list;
  listCacheAt = Date.now();

  const keep = new Set(finalItems.map((item) => item.key));
  for (const blob of blobs) {
    if (blob.key !== LIST_KEY && !keep.has(blob.key)) {
      try {
        await store.delete(blob.key);
      } catch {
        // 清理失败不影响本次返回，下次运行会再尝试
      }
    }
  }

  return {
    updated: downloaded.size,
    count: finalItems.length,
    dates: finalItems.map((item) => item.date),
    errors,
  };
}

export function ensureBingImages() {
  if (!inflight) {
    inflight = doEnsureBingImages().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
