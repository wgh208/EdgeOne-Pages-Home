import { ensureBingImages, readBingImage, readBingList } from "./_bing.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("d");

  if (date) {
    if (!DATE_PATTERN.test(date)) {
      return new Response("Invalid date", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    let image = null;
    let meta = null;
    try {
      image = await readBingImage(date);
      const list = await readBingList();
      meta = list?.items?.find((item) => item.date === date) || null;
    } catch (error) {
      console.error("Failed to read Bing wallpaper from Blob", error);
    }

    if (!image) {
      return new Response("Bing wallpaper not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const etag = `"bing-${date}-${image.byteLength}"`;
    const headers = {
      "Content-Type": meta?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      ETag: etag,
      "X-Bing-Date": date,
    };

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(image, { headers });
  }

  let list = null;
  try {
    list = await readBingList();
  } catch (error) {
    console.error("Failed to read Bing image list", error);
  }

  if (!list?.items?.length) {
    try {
      await ensureBingImages();
      list = await readBingList();
    } catch (error) {
      console.error("Failed to initialize Bing images", error);
    }
  }

  if (!list?.items?.length) {
    return new Response("Bing wallpaper is not ready", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // 按日期从新到旧顺序轮换：cookie 记录上一次展示的日期
  const cookieHeader = request.headers.get("cookie") || "";
  const lastDateMatch = cookieHeader.match(/(?:^|;\s*)bing_image_date=(\d{4}-\d{2}-\d{2})/);
  const lastDate = lastDateMatch ? lastDateMatch[1] : "";
  let index = 0;

  if (lastDate) {
    const lastIndex = list.items.findIndex((item) => item.date === lastDate);
    if (lastIndex >= 0) {
      index = (lastIndex + 1) % list.items.length;
    }
  }

  const item = list.items[index];
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/api/bing-image?d=${encodeURIComponent(item.date)}`,
      "Cache-Control": "no-store",
      "Set-Cookie": `bing_image_date=${item.date}; Path=/; Max-Age=31536000; SameSite=Lax`,
      "X-Bing-Date": item.date,
      "X-Bing-Count": String(list.items.length),
      "X-Bing-Index": String(index),
    },
  });
}
