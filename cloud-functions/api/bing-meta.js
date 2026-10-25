import { ensureBingImages, readBingList } from "./_bing.js";

export async function onRequestGet() {
  let list = null;

  try {
    list = await readBingList();
    if (!list?.items?.length) {
      await ensureBingImages();
      list = await readBingList();
    }
  } catch (error) {
    console.error("Failed to read Bing image list", error);
  }

  if (!list?.items?.length) {
    return new Response(JSON.stringify({ error: "Bing wallpaper is not ready" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(
    JSON.stringify({
      count: list.items.length,
      updatedAt: list.updatedAt,
      images: list.items.map((item) => ({
        date: item.date,
        copyright: item.copyright || "",
        title: item.title || "",
        image: `/api/bing-image?d=${encodeURIComponent(item.date)}`,
      })),
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
