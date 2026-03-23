import { useEffect, useRef } from "react";

export function GlassRippleSurface({ title, description }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);
  const ripplesRef = useRef([]);
  const reducedMotionRef = useRef(false);
  const pointerRef = useRef({
    active: false,
    pressed: false,
    x: 0.5,
    y: 0.5,
    lastSpawnAt: 0,
    ambientAt: 0
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let resizeObserver;
    let previousFrameTime = performance.now();
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function pushRipple(x, y, overrides = {}) {
      ripplesRef.current.push({
        x,
        y,
        radius: overrides.radius ?? 14,
        velocity: overrides.velocity ?? 140 + Math.random() * 40,
        age: 0,
        lifetime: overrides.lifetime ?? 1.65,
        strength: overrides.strength ?? 1
      });
    }

    function resizeCanvas() {
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.max(bounds.width, 1);
      const nextHeight = Math.max(bounds.height, 1);
      const dpr = window.devicePixelRatio || 1;

      width = nextWidth;
      height = nextHeight;

      canvas.width = Math.round(nextWidth * dpr);
      canvas.height = Math.round(nextHeight * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawSurface(now) {
      context.clearRect(0, 0, width, height);

      const surfaceGradient = context.createLinearGradient(0, 0, width, height);
      surfaceGradient.addColorStop(0, "rgba(255, 255, 255, 0.14)");
      surfaceGradient.addColorStop(0.48, "rgba(255, 255, 255, 0.03)");
      surfaceGradient.addColorStop(1, "rgba(102, 179, 255, 0.09)");
      context.fillStyle = surfaceGradient;
      context.fillRect(0, 0, width, height);

      const shimmer = context.createLinearGradient(0, 0, width, height);
      const shimmerOffset = (Math.sin(now / 2200) + 1) / 2;
      shimmer.addColorStop(0, "rgba(255, 255, 255, 0)");
      shimmer.addColorStop(Math.max(0.18, shimmerOffset - 0.18), "rgba(255, 255, 255, 0)");
      shimmer.addColorStop(shimmerOffset, "rgba(255, 255, 255, 0.08)");
      shimmer.addColorStop(Math.min(0.88, shimmerOffset + 0.18), "rgba(255, 255, 255, 0)");
      shimmer.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = shimmer;
      context.fillRect(0, 0, width, height);

      const pointer = pointerRef.current;
      if (pointer.active) {
        const glow = context.createRadialGradient(
          pointer.x * width,
          pointer.y * height,
          0,
          pointer.x * width,
          pointer.y * height,
          width * 0.24
        );
        glow.addColorStop(0, "rgba(115, 255, 245, 0.22)");
        glow.addColorStop(0.45, "rgba(65, 150, 255, 0.1)");
        glow.addColorStop(1, "rgba(65, 150, 255, 0)");
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      }
    }

    function drawRipples(deltaSeconds) {
      // Keep a lightweight list of live waves so the surface can handle many
      // taps without any React re-renders during the animation loop.
      ripplesRef.current = ripplesRef.current.filter((ripple) => ripple.age < ripple.lifetime);

      ripplesRef.current.forEach((ripple) => {
        ripple.age += deltaSeconds;
        ripple.radius += ripple.velocity * deltaSeconds;

        const fade = 1 - ripple.age / ripple.lifetime;
        const centerX = ripple.x * width;
        const centerY = ripple.y * height;
        const maxAlpha = 0.42 * ripple.strength * fade;

        for (let ring = 0; ring < 3; ring += 1) {
          const ringRadius = ripple.radius - ring * 18;

          if (ringRadius <= 0) {
            continue;
          }

          context.beginPath();
          context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
          context.lineWidth = 1.3 + ring * 0.3;
          context.strokeStyle = `rgba(255, 255, 255, ${maxAlpha / (ring + 1)})`;
          context.shadowBlur = 12;
          context.shadowColor = `rgba(101, 236, 223, ${0.16 * fade})`;
          context.stroke();

          context.beginPath();
          context.arc(centerX, centerY, ringRadius + 2.5, 0, Math.PI * 2);
          context.lineWidth = 0.8;
          context.strokeStyle = `rgba(83, 228, 224, ${0.14 * fade})`;
          context.shadowBlur = 0;
          context.stroke();
        }
      });

      context.shadowBlur = 0;
    }

    function maybeSpawnAmbientRipple(now) {
      if (reducedMotionRef.current || pointerRef.current.active) {
        return;
      }

      if (now - pointerRef.current.ambientAt < 2600) {
        return;
      }

      pointerRef.current.ambientAt = now;
      pushRipple(0.22 + Math.random() * 0.56, 0.28 + Math.random() * 0.44, {
        radius: 18,
        velocity: 120 + Math.random() * 25,
        lifetime: 1.85,
        strength: 0.5
      });
    }

    function animate(now) {
      const deltaSeconds = Math.min((now - previousFrameTime) / 1000, 0.03);
      previousFrameTime = now;

      drawSurface(now);
      maybeSpawnAmbientRipple(now);
      drawRipples(deltaSeconds);

      frameRef.current = window.requestAnimationFrame(animate);
    }

    resizeCanvas();
    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameRef.current);
      resizeObserver?.disconnect();
    };
  }, []);

  function updatePointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const normalizedX = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
    const normalizedY = Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1);

    pointerRef.current.x = normalizedX;
    pointerRef.current.y = normalizedY;
    pointerRef.current.active = true;

    if (pointerRef.current.pressed) {
      const now = performance.now();
      if (now - pointerRef.current.lastSpawnAt > 120) {
        pointerRef.current.lastSpawnAt = now;
        ripplesRef.current.push({
          x: normalizedX,
          y: normalizedY,
          radius: 14,
          velocity: 135 + Math.random() * 45,
          age: 0,
          lifetime: 1.55,
          strength: 0.9
        });
      }
    }
  }

  function handlePointerDown(event) {
    updatePointer(event);
    pointerRef.current.pressed = true;
    pointerRef.current.lastSpawnAt = performance.now();

    // Start each interaction with a stronger ring so the glass feels responsive.
    ripplesRef.current.push({
      x: pointerRef.current.x,
      y: pointerRef.current.y,
      radius: 10,
      velocity: 172,
      age: 0,
      lifetime: 1.9,
      strength: 1.25
    });
  }

  function handlePointerMove(event) {
    updatePointer(event);
  }

  function handlePointerLeave() {
    pointerRef.current.active = false;
    pointerRef.current.pressed = false;
  }

  function handlePointerUp() {
    pointerRef.current.pressed = false;
  }

  return (
    <div
      className="auth-pond"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas ref={canvasRef} className="auth-pond-canvas" />
      <div className="auth-pond-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}
