import { describe, it, expect } from "vitest";
import {
  getSlotFinalVideoUrl,
  isFinalVideoCaptioned,
} from "@/lib/publications/finalVideo";

describe("getSlotFinalVideoUrl", () => {
  it("retourne null si pas de render ni captionJob", () => {
    expect(getSlotFinalVideoUrl({ render: null })).toBeNull();
  });

  it("retourne render.videoUrl si pas de captionJob", () => {
    expect(
      getSlotFinalVideoUrl({
        render: { videoUrl: "https://r2.example/render.mp4" },
      }),
    ).toBe("https://r2.example/render.mp4");
  });

  it("retourne render.videoUrl si captionJob pending (PROCESSING)", () => {
    expect(
      getSlotFinalVideoUrl({
        render: { videoUrl: "https://r2.example/render.mp4" },
        latestCaptionJob: {
          status: "PROCESSING",
          outputUrl: null,
        },
      }),
    ).toBe("https://r2.example/render.mp4");
  });

  it("retourne render.videoUrl si captionJob FAILED", () => {
    expect(
      getSlotFinalVideoUrl({
        render: { videoUrl: "https://r2.example/render.mp4" },
        latestCaptionJob: {
          status: "FAILED",
          outputUrl: null,
        },
      }),
    ).toBe("https://r2.example/render.mp4");
  });

  it("retourne captionJob.outputUrl si COMPLETED avec outputUrl", () => {
    expect(
      getSlotFinalVideoUrl({
        render: { videoUrl: "https://r2.example/render.mp4" },
        latestCaptionJob: {
          status: "COMPLETED",
          outputUrl: "https://r2.example/render-with-captions.mp4",
        },
      }),
    ).toBe("https://r2.example/render-with-captions.mp4");
  });

  it("retombe sur render.videoUrl si COMPLETED mais outputUrl null", () => {
    expect(
      getSlotFinalVideoUrl({
        render: { videoUrl: "https://r2.example/render.mp4" },
        latestCaptionJob: {
          status: "COMPLETED",
          outputUrl: null,
        },
      }),
    ).toBe("https://r2.example/render.mp4");
  });
});

describe("isFinalVideoCaptioned", () => {
  it("false si pas de captionJob", () => {
    expect(
      isFinalVideoCaptioned({ render: { videoUrl: "x" } }),
    ).toBe(false);
  });

  it("false si captionJob pas COMPLETED", () => {
    expect(
      isFinalVideoCaptioned({
        render: { videoUrl: "x" },
        latestCaptionJob: { status: "PROCESSING", outputUrl: null },
      }),
    ).toBe(false);
  });

  it("false si captionJob COMPLETED mais outputUrl null", () => {
    expect(
      isFinalVideoCaptioned({
        render: { videoUrl: "x" },
        latestCaptionJob: { status: "COMPLETED", outputUrl: null },
      }),
    ).toBe(false);
  });

  it("true si captionJob COMPLETED + outputUrl", () => {
    expect(
      isFinalVideoCaptioned({
        render: { videoUrl: "x" },
        latestCaptionJob: { status: "COMPLETED", outputUrl: "y" },
      }),
    ).toBe(true);
  });
});
