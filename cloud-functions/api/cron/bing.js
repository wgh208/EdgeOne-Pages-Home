import { ensureBingImages } from "../_bing.js";

export async function onRequestPost() {
  try {
    const result = await ensureBingImages();
    console.info(
      JSON.stringify({
        event: "bing_wallpaper_cron",
        updated: result.updated,
        count: result.count,
        dates: result.dates,
        errors: result.errors,
      }),
    );

    return new Response(
      JSON.stringify({
        ok: true,
        updated: result.updated,
        count: result.count,
        dates: result.dates,
        errors: result.errors,
      }),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Bing wallpaper cron failed", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: String(error?.message || error),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
