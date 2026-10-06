import { describe, it, expect } from "vitest";
import path from "path";
import { localPathForPublicUrl } from "@/lib/storage";

const UPLOADS = path.join(process.cwd(), "public", "uploads");

describe("localPathForPublicUrl", () => {
  it("résout une URL /uploads vers public/uploads, query retirée", () => {
    expect(localPathForPublicUrl("/uploads/abc123.mov")).toBe(path.join(UPLOADS, "abc123.mov"));
    expect(localPathForPublicUrl("/uploads/abc123.mp4?v=job42")).toBe(path.join(UPLOADS, "abc123.mp4"));
    expect(localPathForPublicUrl("/uploads/content-library/videos/x.mp4#t=3")).toBe(
      path.join(UPLOADS, "content-library", "videos", "x.mp4"),
    );
  });

  it("refuse tout ce qui n'est pas sous /uploads", () => {
    expect(localPathForPublicUrl("https://cdn.toolboximmo.com/content-library/videos/x.mp4")).toBeNull();
    expect(localPathForPublicUrl("/test-fixtures/video_1.mp4")).toBeNull();
    expect(localPathForPublicUrl("")).toBeNull();
  });

  it("refuse la traversée de dossier, encodée ou non", () => {
    expect(localPathForPublicUrl("/uploads/../.env")).toBeNull();
    expect(localPathForPublicUrl("/uploads/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(localPathForPublicUrl("/uploads/a b.mp4")).toBeNull();
  });
});
