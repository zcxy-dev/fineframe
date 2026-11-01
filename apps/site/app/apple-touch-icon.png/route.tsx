import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const dynamic = "force-static";

/**
 * The icon a phone puts on its home screen: the app's icon, 180 px and square, over its own
 * graphite so the phone's rounded mask finds no empty corners.
 */
export async function GET() {
  const svg = await readFile(join(process.cwd(), "public/icon.svg"));
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "linear-gradient(#3a3d44, #111215)",
      }}
    >
      <img
        src={`data:image/svg+xml;base64,${svg.toString("base64")}`}
        width={180}
        height={180}
        alt=""
      />
    </div>,
    { width: 180, height: 180 },
  );
}
