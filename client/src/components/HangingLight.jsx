import { useEffect, useRef } from "react";

const DEFAULT_LIGHT = {
  yaw: 0.34,
  pitch: -0.08,
  yawVelocity: 0,
  pitchVelocity: 0,
  dragging: false,
  dragYawOffset: 0,
  dragPitchOffset: 0,
  lastYaw: 0.34,
  lastPitch: -0.08,
  lastTime: 0
};

const BULB_SIZE = 60;
const BULB_ATTACH_OFFSET = BULB_SIZE - 2;

export function HangingLight({ surfaceRef }) {
  const frameRef = useRef(0);
  const armRef = useRef(null);
  const bulbRef = useRef(null);
  const glowRef = useRef(null);
  const ropeRef = useRef(null);
  const simulationRef = useRef({
    ...DEFAULT_LIGHT,
    anchorX: 0,
    anchorY: 0,
    length: 220
  });

  useEffect(() => {
    const surface = surfaceRef.current;

    if (!surface) {
      return undefined;
    }

    const state = simulationRef.current;
    let previousTime = performance.now();

    function measure() {
      const bounds = surface.getBoundingClientRect();
      const compact = bounds.width < 720;

      state.anchorX = compact
        ? Math.max(bounds.width - 118, bounds.width * 0.7)
        : Math.min(Math.max(bounds.width * 0.8, bounds.width - 320), bounds.width - 170);
      state.anchorY = compact ? -2 : -8;
      state.length = compact
        ? Math.min(Math.max(bounds.height * 0.24, 166), 210)
        : Math.min(Math.max(bounds.height * 0.34, 190), 248);
    }

    function updateLighting(bounds) {
      const horizontal = Math.sin(state.yaw) * Math.cos(state.pitch);
      const vertical = Math.cos(state.yaw) * Math.cos(state.pitch);
      const depth = Math.sin(state.pitch);
      const bulbX = state.anchorX + horizontal * state.length;
      const bulbY = state.anchorY + vertical * state.length;
      const intensity =
        0.15 +
        Math.min(
          Math.abs(state.yawVelocity) * 0.04 +
            Math.abs(state.pitchVelocity) * 0.04 +
            Math.abs(depth) * 0.1,
          0.2
        );

      surface.style.setProperty("--light-x", `${(bulbX / bounds.width) * 100}%`);
      surface.style.setProperty("--light-y", `${(bulbY / bounds.height) * 100}%`);
      surface.style.setProperty("--light-alpha", intensity.toFixed(3));
      surface.style.setProperty("--light-card-alpha", (intensity * 0.82).toFixed(3));
    }

    function render() {
      const bounds = surface.getBoundingClientRect();
      const horizontal = Math.sin(state.yaw) * Math.cos(state.pitch);
      const vertical = Math.cos(state.yaw) * Math.cos(state.pitch);
      const depth = Math.sin(state.pitch);
      const bulbX = state.anchorX + horizontal * state.length;
      const bulbY = state.anchorY + vertical * state.length;

      if (armRef.current) {
        armRef.current.style.left = `${state.anchorX}px`;
        armRef.current.style.top = `${state.anchorY}px`;
        armRef.current.style.height = `${state.length}px`;
        armRef.current.style.transform = `rotateZ(${-state.yaw}rad) rotateX(${state.pitch * 0.9}rad)`;
      }

      if (ropeRef.current) {
        const ropeEndY = state.length - BULB_ATTACH_OFFSET;
        const bend = Math.max(
          Math.min(state.yawVelocity * 10 + state.pitch * 22 + state.yaw * 6, 20),
          -20
        );
        const controlOneX = 48 + bend * 0.28;
        const controlTwoX = 48 + bend;
        ropeRef.current.setAttribute(
          "d",
          `M 48 0 C ${controlOneX} ${ropeEndY * 0.26}, ${controlTwoX} ${ropeEndY * 0.68}, 48 ${ropeEndY}`
        );
      }

      if (bulbRef.current) {
        const scale = 1 + depth * 0.08;
        bulbRef.current.style.transform = `translateX(-50%) translateZ(${depth * 42}px) scale(${scale})`;
      }

      if (glowRef.current) {
        glowRef.current.style.transform = `translate3d(${bulbX - 130}px, ${bulbY - 108}px, ${depth * 32}px) scale(${1 + depth * 0.12})`;
      }

      updateLighting(bounds);
    }

    function step(now) {
      const delta = Math.min((now - previousTime) / 1000, 0.03);
      previousTime = now;

      if (!state.dragging) {
        const gravity = 15.5;
        const damping = 0.992;
        const normalizedLength = Math.max(state.length / 180, 0.95);
        const yawAcceleration = -(gravity / normalizedLength) * Math.sin(state.yaw) * (1 - Math.min(Math.abs(state.pitch), 0.65) * 0.25);
        const pitchAcceleration =
          -(gravity / normalizedLength) * Math.sin(state.pitch) * 0.9 +
          state.yawVelocity * 0.06 * Math.sin(state.yaw);

        state.yawVelocity += yawAcceleration * delta;
        state.pitchVelocity += pitchAcceleration * delta;
        state.yawVelocity *= Math.pow(damping, delta * 60);
        state.pitchVelocity *= Math.pow(damping, delta * 60);
        state.yaw += state.yawVelocity * delta;
        state.pitch += state.pitchVelocity * delta;
        state.yaw = Math.max(Math.min(state.yaw, 1.28), -1.28);
        state.pitch = Math.max(Math.min(state.pitch, 0.72), -0.72);

        if (
          Math.abs(state.yawVelocity) < 0.006 &&
          Math.abs(state.pitchVelocity) < 0.006 &&
          Math.abs(state.yaw) < 0.006 &&
          Math.abs(state.pitch) < 0.006
        ) {
          state.yaw *= 0.98;
          state.pitch *= 0.98;
          state.yawVelocity = 0;
          state.pitchVelocity = 0;
        }
      }

      render();
      frameRef.current = window.requestAnimationFrame(step);
    }

    function swingFromClient(clientX, clientY) {
      const bounds = surface.getBoundingClientRect();
      const x = clientX - bounds.left;
      const y = clientY - bounds.top;
      const normalizedX = (x - state.anchorX) / (state.length * 0.86);
      const normalizedY = (y - (state.anchorY + state.length * 0.5)) / (state.length * 0.88);

      return {
        yaw: Math.max(Math.min(normalizedX, 1.15), -1.15),
        pitch: Math.max(Math.min(-normalizedY, 0.7), -0.7)
      };
    }

    function handlePointerMove(event) {
      if (!state.dragging) {
        return;
      }

      const now = performance.now();
      const nextSwing = swingFromClient(event.clientX, event.clientY);
      const elapsed = Math.max(now - state.lastTime, 16) / 1000;

      state.yaw = Math.max(Math.min(nextSwing.yaw - state.dragYawOffset, 1.28), -1.28);
      state.pitch = Math.max(Math.min(nextSwing.pitch - state.dragPitchOffset, 0.72), -0.72);
      state.yawVelocity = (state.yaw - state.lastYaw) / elapsed;
      state.pitchVelocity = (state.pitch - state.lastPitch) / elapsed;
      state.lastYaw = state.yaw;
      state.lastPitch = state.pitch;
      state.lastTime = now;
    }

    function handlePointerUp(event) {
      if (!state.dragging) {
        return;
      }

      state.dragging = false;
      bulbRef.current?.releasePointerCapture?.(event.pointerId);
    }

    function handlePointerDown(event) {
      event.preventDefault();
      event.stopPropagation();

      state.dragging = true;
      state.lastTime = performance.now();
      state.lastYaw = state.yaw;
      state.lastPitch = state.pitch;
      const nextSwing = swingFromClient(event.clientX, event.clientY);
      state.dragYawOffset = nextSwing.yaw - state.yaw;
      state.dragPitchOffset = nextSwing.pitch - state.pitch;
      bulbRef.current?.setPointerCapture?.(event.pointerId);
    }

    const resizeObserver = new ResizeObserver(() => {
      measure();
      render();
    });

    measure();
    render();
    resizeObserver.observe(surface);
    frameRef.current = window.requestAnimationFrame(step);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    bulbRef.current?.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      bulbRef.current?.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [surfaceRef]);

  return (
    <>
      <div className="auth-light-ambient" aria-hidden="true" />
      <div className="auth-hanging-light" aria-hidden="true">
        <div ref={armRef} className="auth-hanging-light-arm">
          <span className="auth-hanging-light-anchor" />
          <svg className="auth-hanging-light-cord" viewBox="0 0 96 260" preserveAspectRatio="none">
            <path ref={ropeRef} className="auth-hanging-light-cord-path" />
          </svg>
          <button ref={bulbRef} type="button" className="auth-hanging-light-bulb" tabIndex={-1}>
            <span className="auth-hanging-light-core" />
            <span className="auth-hanging-light-cap" />
          </button>
        </div>
        <span ref={glowRef} className="auth-hanging-light-glow" />
      </div>
    </>
  );
}
