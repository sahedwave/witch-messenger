type Point = {
  x: number;
  y: number;
};

type DrawContext = {
  ctx: CanvasRenderingContext2D;
  landmarks: Point[];
  width: number;
  height: number;
  now: number;
};

type BeautyFilterConfig = {
  id: string;
  label: string;
  emoji: string;
  filter: string;
  skinTint: string;
  skinOpacity: number;
  blur: number;
  glow: number;
  blush?: {
    color: string;
    opacity: number;
    size: number;
  };
  lips?: {
    color: string;
    opacity: number;
    gloss: number;
  };
  eyes?: {
    highlight: number;
    lash: number;
  };
};

const FACE_OUTLINE_INDEXES = [
  10, 338, 297, 332, 284, 251, 389, 356,
  454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109, 10
];

const OUTER_LIP_INDEXES = [
  61, 146, 91, 181, 84, 17, 314, 405,
  321, 375, 291, 308, 324, 318, 402, 317,
  14, 87, 178, 88, 95, 78, 61
];

const LEFT_EYE_LINE = [33, 160, 158, 133];
const RIGHT_EYE_LINE = [362, 385, 387, 263];

export const AR_FILTERS = [
  {
    id: "none",
    label: "None",
    emoji: "○",
    filter: "none",
    skinTint: "#ffffff",
    skinOpacity: 0,
    blur: 0,
    glow: 0
  },
  {
    id: "porcelain",
    label: "Porcelain",
    emoji: "🤍",
    filter: "brightness(1.08) saturate(0.9) contrast(0.98)",
    skinTint: "#fff4ef",
    skinOpacity: 0.18,
    blur: 14,
    glow: 0.18,
    lips: { color: "#f2a8b8", opacity: 0.16, gloss: 0.08 },
    eyes: { highlight: 0.12, lash: 0.04 }
  },
  {
    id: "rosy-lips",
    label: "Rosy Lips",
    emoji: "🌷",
    filter: "brightness(1.02) saturate(1.06)",
    skinTint: "#fff6f6",
    skinOpacity: 0.03,
    blur: 4,
    glow: 0.04,
    lips: { color: "#f06b9c", opacity: 0.42, gloss: 0.12 }
  },
  {
    id: "red-lipstick",
    label: "Red Lipstick",
    emoji: "💋",
    filter: "contrast(1.04) saturate(1.08)",
    skinTint: "#fff4f3",
    skinOpacity: 0.04,
    blur: 4,
    glow: 0.05,
    lips: { color: "#cf2246", opacity: 0.64, gloss: 0.14 },
    eyes: { highlight: 0.06, lash: 0.06 }
  },
  {
    id: "pink-makeup",
    label: "Pink Makeup",
    emoji: "🎀",
    filter: "brightness(1.06) saturate(1.08)",
    skinTint: "#fff1f6",
    skinOpacity: 0.08,
    blur: 8,
    glow: 0.09,
    blush: { color: "#ff7cb7", opacity: 0.22, size: 1 },
    lips: { color: "#ef6fa5", opacity: 0.36, gloss: 0.12 },
    eyes: { highlight: 0.08, lash: 0.05 }
  },
  {
    id: "soft-beauty",
    label: "Soft Beauty",
    emoji: "☁",
    filter: "brightness(1.05) saturate(0.98) contrast(0.97)",
    skinTint: "#fff7f4",
    skinOpacity: 0.14,
    blur: 16,
    glow: 0.1,
    lips: { color: "#eaa2ae", opacity: 0.14, gloss: 0.07 },
    eyes: { highlight: 0.1, lash: 0.03 }
  },
  {
    id: "glow",
    label: "Glow",
    emoji: "✨",
    filter: "brightness(1.08) saturate(1.02) contrast(1.01)",
    skinTint: "#fff7eb",
    skinOpacity: 0.1,
    blur: 10,
    glow: 0.24,
    lips: { color: "#ef9aa7", opacity: 0.16, gloss: 0.18 },
    eyes: { highlight: 0.16, lash: 0.04 }
  },
  {
    id: "blush",
    label: "Blush",
    emoji: "🌸",
    filter: "brightness(1.03) saturate(1.06)",
    skinTint: "#fff5f5",
    skinOpacity: 0.03,
    blur: 4,
    glow: 0.04,
    blush: { color: "#ff6b87", opacity: 0.28, size: 1.04 },
    lips: { color: "#e58a9a", opacity: 0.14, gloss: 0.06 }
  },
  {
    id: "doll-beauty",
    label: "Doll Beauty",
    emoji: "🪆",
    filter: "brightness(1.1) saturate(1.02) contrast(1)",
    skinTint: "#fff2f4",
    skinOpacity: 0.18,
    blur: 16,
    glow: 0.16,
    blush: { color: "#ff7aa8", opacity: 0.24, size: 1.06 },
    lips: { color: "#ec6c98", opacity: 0.38, gloss: 0.16 },
    eyes: { highlight: 0.2, lash: 0.08 }
  },
  {
    id: "k-beauty",
    label: "K-Beauty",
    emoji: "💮",
    filter: "brightness(1.08) saturate(0.98) contrast(1)",
    skinTint: "#fff4fb",
    skinOpacity: 0.16,
    blur: 14,
    glow: 0.14,
    blush: { color: "#ff94b8", opacity: 0.18, size: 0.92 },
    lips: { color: "#ff84aa", opacity: 0.3, gloss: 0.14 },
    eyes: { highlight: 0.12, lash: 0.04 }
  },
  {
    id: "natural-makeup",
    label: "Natural Makeup",
    emoji: "🌿",
    filter: "brightness(1.03) contrast(1.01) saturate(1.02)",
    skinTint: "#fff6f2",
    skinOpacity: 0.08,
    blur: 8,
    glow: 0.08,
    blush: { color: "#ef8d92", opacity: 0.12, size: 0.9 },
    lips: { color: "#d8858d", opacity: 0.18, gloss: 0.08 },
    eyes: { highlight: 0.08, lash: 0.03 }
  }
] as const satisfies readonly BeautyFilterConfig[];

export type ArFilterId = (typeof AR_FILTERS)[number]["id"];

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mix(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

function mixPoint(a: Point, b: Point, amount: number): Point {
  return {
    x: mix(a.x, b.x, amount),
    y: mix(a.y, b.y, amount)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((part) => `${part}${part}`).join("")
    : value;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  landmarks: Point[],
  indexes: number[],
  width: number,
  height: number
) {
  const first = landmarks[indexes[0]];
  if (!first) {
    return false;
  }

  ctx.beginPath();
  ctx.moveTo(first.x * width, first.y * height);

  indexes.slice(1).forEach((index) => {
    const point = landmarks[index];
    if (point) {
      ctx.lineTo(point.x * width, point.y * height);
    }
  });

  ctx.closePath();
  return true;
}

function withFaceClip(
  ctx: CanvasRenderingContext2D,
  landmarks: Point[],
  width: number,
  height: number,
  draw: () => void
) {
  ctx.save();
  if (!tracePolygon(ctx, landmarks, FACE_OUTLINE_INDEXES, width, height)) {
    ctx.restore();
    return;
  }
  ctx.clip();
  draw();
  ctx.restore();
}

function drawSoftSpot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  color: string,
  opacity: number
) {
  const radius = Math.max(radiusX, radiusY);
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, hexToRgba(color, opacity));
  gradient.addColorStop(0.45, hexToRgba(color, opacity * 0.45));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function getFaceMetrics(landmarks: Point[], width: number, height: number) {
  const forehead = landmarks[10];
  const chin = landmarks[152];
  const leftEdge = landmarks[234];
  const rightEdge = landmarks[454];
  const nose = landmarks[4];
  const leftEye = landmarks[159];
  const rightEye = landmarks[386];
  const upperLip = landmarks[13];

  const faceWidth = dist(leftEdge, rightEdge) * width;
  const faceHeight = dist(forehead, chin) * height;
  const center = mixPoint(forehead, chin, 0.48);
  const leftCheek = {
    x: mix(leftEdge.x, nose.x, 0.42),
    y: mix(leftEye.y, upperLip.y, 0.62)
  };
  const rightCheek = {
    x: mix(rightEdge.x, nose.x, 0.42),
    y: mix(rightEye.y, upperLip.y, 0.62)
  };

  return {
    forehead,
    chin,
    leftEdge,
    rightEdge,
    nose,
    leftEye,
    rightEye,
    upperLip,
    faceWidth,
    faceHeight,
    center,
    leftCheek,
    rightCheek
  };
}

function drawSkinFinish(drawContext: DrawContext, filter: BeautyFilterConfig) {
  if (!filter.skinOpacity && !filter.glow) {
    return;
  }

  const { ctx, landmarks, width, height } = drawContext;
  const metrics = getFaceMetrics(landmarks, width, height);

  withFaceClip(ctx, landmarks, width, height, () => {
    if (filter.skinOpacity > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.filter = filter.blur > 0 ? `blur(${filter.blur}px)` : "none";
      ctx.fillStyle = hexToRgba(filter.skinTint, filter.skinOpacity);
      ctx.beginPath();
      ctx.ellipse(
        metrics.center.x * width,
        metrics.center.y * height,
        metrics.faceWidth * 0.42,
        metrics.faceHeight * 0.54,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.filter = "none";
      ctx.fillStyle = hexToRgba("#fff9f5", filter.skinOpacity * 0.42);
      ctx.beginPath();
      ctx.ellipse(
        metrics.center.x * width,
        metrics.center.y * height - metrics.faceHeight * 0.03,
        metrics.faceWidth * 0.34,
        metrics.faceHeight * 0.44,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();
    }

    if (filter.glow > 0) {
      drawSoftSpot(
        ctx,
        metrics.forehead.x * width,
        metrics.forehead.y * height + metrics.faceHeight * 0.18,
        metrics.faceWidth * 0.18,
        metrics.faceHeight * 0.16,
        "#fff8f2",
        filter.glow * 0.75
      );
      drawSoftSpot(
        ctx,
        metrics.nose.x * width,
        metrics.nose.y * height,
        metrics.faceWidth * 0.12,
        metrics.faceHeight * 0.16,
        "#fff6ef",
        filter.glow * 0.58
      );
      drawSoftSpot(
        ctx,
        metrics.leftCheek.x * width,
        metrics.leftCheek.y * height,
        metrics.faceWidth * 0.16,
        metrics.faceHeight * 0.14,
        "#fff3f1",
        filter.glow * 0.4
      );
      drawSoftSpot(
        ctx,
        metrics.rightCheek.x * width,
        metrics.rightCheek.y * height,
        metrics.faceWidth * 0.16,
        metrics.faceHeight * 0.14,
        "#fff3f1",
        filter.glow * 0.4
      );
    }
  });
}

function drawBlush(drawContext: DrawContext, filter: BeautyFilterConfig) {
  if (!filter.blush) {
    return;
  }

  const { ctx, landmarks, width, height } = drawContext;
  const metrics = getFaceMetrics(landmarks, width, height);
  const radiusX = metrics.faceWidth * 0.16 * filter.blush.size;
  const radiusY = metrics.faceHeight * 0.11 * filter.blush.size;

  drawSoftSpot(
    ctx,
    metrics.leftCheek.x * width,
    metrics.leftCheek.y * height,
    radiusX,
    radiusY,
    filter.blush.color,
    filter.blush.opacity
  );
  drawSoftSpot(
    ctx,
    metrics.rightCheek.x * width,
    metrics.rightCheek.y * height,
    radiusX,
    radiusY,
    filter.blush.color,
    filter.blush.opacity
  );
}

function drawLipColor(drawContext: DrawContext, filter: BeautyFilterConfig) {
  if (!filter.lips) {
    return;
  }

  const { ctx, landmarks, width, height } = drawContext;
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];
  const lipLeft = landmarks[61];
  const lipRight = landmarks[291];

  if (!upperLip || !lowerLip || !lipLeft || !lipRight) {
    return;
  }

  ctx.save();
  if (!tracePolygon(ctx, landmarks, OUTER_LIP_INDEXES, width, height)) {
    ctx.restore();
    return;
  }

  const gradient = ctx.createLinearGradient(
    upperLip.x * width,
    upperLip.y * height,
    lowerLip.x * width,
    lowerLip.y * height
  );
  gradient.addColorStop(0, hexToRgba(filter.lips.color, filter.lips.opacity * 0.92));
  gradient.addColorStop(1, hexToRgba(filter.lips.color, filter.lips.opacity));
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.filter = "blur(1.5px)";
  ctx.strokeStyle = hexToRgba(filter.lips.color, filter.lips.opacity * 0.55);
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.filter = "none";

  if (filter.lips.gloss > 0) {
    const glossY = mix(upperLip.y, lowerLip.y, 0.4) * height;
    const glossGradient = ctx.createLinearGradient(
      lipLeft.x * width,
      glossY,
      lipRight.x * width,
      glossY
    );
    glossGradient.addColorStop(0, "rgba(255,255,255,0)");
    glossGradient.addColorStop(0.5, hexToRgba("#fff4f8", filter.lips.gloss));
    glossGradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = glossGradient;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mix(lipLeft.x, lipRight.x, 0.18) * width, glossY);
    ctx.quadraticCurveTo(
      mix(upperLip.x, lowerLip.x, 0.35) * width,
      glossY - 2,
      mix(lipLeft.x, lipRight.x, 0.82) * width,
      glossY
    );
    ctx.stroke();
  }

  ctx.restore();
}

function drawEyeFinish(drawContext: DrawContext, filter: BeautyFilterConfig) {
  if (!filter.eyes) {
    return;
  }

  const { ctx, landmarks, width, height } = drawContext;
  const metrics = getFaceMetrics(landmarks, width, height);

  [
    { center: metrics.leftEye, indexes: LEFT_EYE_LINE },
    { center: metrics.rightEye, indexes: RIGHT_EYE_LINE }
  ].forEach(({ center, indexes }) => {
    if (filter.eyes!.highlight > 0) {
      drawSoftSpot(
        ctx,
        center.x * width,
        center.y * height + metrics.faceHeight * 0.02,
        metrics.faceWidth * 0.09,
        metrics.faceHeight * 0.06,
        "#fff7ef",
        filter.eyes!.highlight
      );
    }

    if (filter.eyes!.lash > 0) {
      const start = landmarks[indexes[0]];
      const control = landmarks[indexes[1]];
      const end = landmarks[indexes[indexes.length - 1]];
      if (!start || !control || !end) {
        return;
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(start.x * width, start.y * height);
      ctx.quadraticCurveTo(
        control.x * width,
        control.y * height - metrics.faceHeight * 0.04,
        end.x * width,
        end.y * height
      );
      ctx.strokeStyle = hexToRgba("#4f3342", filter.eyes.lash);
      ctx.lineWidth = Math.max(1.5, metrics.faceWidth * 0.008);
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();
    }
  });
}

function drawBeautyFilter(drawContext: DrawContext, filter: BeautyFilterConfig) {
  drawSkinFinish(drawContext, filter);
  drawBlush(drawContext, filter);
  drawLipColor(drawContext, filter);
  drawEyeFinish(drawContext, filter);
}

export function drawArFilter(
  ctx: CanvasRenderingContext2D,
  keypoints: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  activeFilterId: ArFilterId,
  now = Date.now()
) {
  const landmarks = keypoints.map((point) => ({
    x: point.x / width,
    y: point.y / height
  }));

  if (landmarks.length < 455) {
    return;
  }

  const filter = AR_FILTERS.find((entry) => entry.id === activeFilterId) || AR_FILTERS[0];
  if (filter.id === "none") {
    return;
  }

  drawBeautyFilter(
    {
      ctx,
      landmarks,
      width,
      height,
      now
    },
    filter
  );
}
