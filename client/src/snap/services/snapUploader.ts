const SNAP_UPLOAD_ENDPOINT = import.meta.env.VITE_SNAP_UPLOAD_ENDPOINT || "";

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to prepare snap data."));
    reader.readAsDataURL(blob);
  });
}

type UploadSnapAssetInput = {
  file: Blob;
  thumbnail: Blob | null;
  fileName: string;
  thumbnailName: string;
  mimeType: string;
};

export async function uploadSnapAsset({
  file,
  thumbnail,
  fileName,
  thumbnailName,
  mimeType
}: UploadSnapAssetInput) {
  if (!SNAP_UPLOAD_ENDPOINT) {
    return {
      mediaUrl: await blobToDataUrl(file),
      thumbnailUrl: thumbnail ? await blobToDataUrl(thumbnail) : null
    };
  }

  const formData = new FormData();
  formData.append("file", file, fileName);
  if (thumbnail) {
    formData.append("thumbnail", thumbnail, thumbnailName);
  }
  formData.append("mimeType", mimeType);

  const response = await fetch(SNAP_UPLOAD_ENDPOINT, {
    method: "POST",
    body: formData
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.mediaUrl) {
    throw new Error(payload.message || "Snap upload failed.");
  }

  return {
    mediaUrl: payload.mediaUrl,
    thumbnailUrl: payload.thumbnailUrl || null
  };
}
