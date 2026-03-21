async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to process snap media."));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

async function loadImageFromBlob(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode snap image."));
    };
    image.src = objectUrl;
  });
}

type CompressImageOptions = {
  maxBytes?: number;
  maxEdge?: number;
  filterCss?: string;
};

export async function compressImageBlob(
  blob: Blob,
  {
    maxBytes = 500 * 1024,
    maxEdge = 1440,
    filterCss = "none"
  }: CompressImageOptions = {}
) {
  const image = await loadImageFromBlob(blob);
  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;
  const initialScale = Math.min(1, maxEdge / Math.max(width, height));
  width = Math.max(1, Math.round(width * initialScale));
  height = Math.max(1, Math.round(height * initialScale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to prepare image compression.");
  }

  let quality = 0.9;
  let attempts = 0;
  let output = blob;

  while (attempts < 8) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.filter = filterCss;
    context.drawImage(image, 0, 0, width, height);
    output = await canvasToBlob(canvas, "image/jpeg", quality);

    if (output.size <= maxBytes) {
      break;
    }

    attempts += 1;
    if (attempts % 3 === 0) {
      width = Math.max(720, Math.round(width * 0.86));
      height = Math.max(960, Math.round(height * 0.86));
    }
    quality = Math.max(0.46, quality - 0.08);
  }

  return {
    blob: output.type ? output : new Blob([output], { type: "image/jpeg" })
  };
}

type GenerateThumbnailOptions = {
  maxEdge?: number;
  filterCss?: string;
};

export async function generateThumbnail(
  blob: Blob,
  { maxEdge = 320, filterCss = "none" }: GenerateThumbnailOptions = {}
) {
  if (blob.type.startsWith("image/")) {
    const image = await loadImageFromBlob(blob);
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to prepare snap thumbnail.");
    }

    canvas.width = width;
    canvas.height = height;
    context.filter = filterCss;
    context.drawImage(image, 0, 0, width, height);
    return canvasToBlob(canvas, "image/webp", 0.8);
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Unable to load snap video thumbnail."));
    });

    if (Number.isFinite(video.duration) && video.duration > 0.15) {
      await new Promise<void>((resolve) => {
        video.currentTime = Math.min(0.15, video.duration / 2);
        video.onseeked = () => resolve();
      });
    }

    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to create video thumbnail.");
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    return canvasToBlob(canvas, "image/webp", 0.8);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

type OptimizeVideoOptions = {
  maxBytes?: number;
};

export async function optimizeVideoBlob(
  blob: Blob,
  { maxBytes = 2 * 1024 * 1024 }: OptimizeVideoOptions = {}
) {
  if (blob.size > maxBytes) {
    throw new Error("Video is larger than 2 MB. Record a shorter snap.");
  }

  return { blob };
}
