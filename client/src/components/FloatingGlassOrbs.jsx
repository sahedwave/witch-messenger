import { useEffect, useRef } from "react";

const ORB_CONFIG = [
  { size: 110, x: 0.18, y: 0.26, vx: 1.24, vy: 0.92 },
  { size: 92, x: 0.44, y: 0.58, vx: -1.1, vy: 0.84 },
  { size: 128, x: 0.72, y: 0.34, vx: 0.86, vy: -0.98 },
  { size: 84, x: 0.58, y: 0.74, vx: -0.94, vy: -0.76 },
  { size: 104, x: 0.84, y: 0.66, vx: -1.18, vy: 0.8 }
];

export function FloatingGlassOrbs() {
  const arenaRef = useRef(null);
  const orbRefs = useRef([]);
  const simulationRef = useRef({
    frameId: 0,
    width: 0,
    height: 0,
    pointerActive: false,
    orbs: []
  });

  useEffect(() => {
    const arena = arenaRef.current;

    if (!arena) {
      return undefined;
    }

    function measureArena() {
      const bounds = arena.getBoundingClientRect();

      simulationRef.current.width = bounds.width;
      simulationRef.current.height = bounds.height;

      simulationRef.current.orbs = ORB_CONFIG.map((orb, index) => {
        const radius = orb.size / 2;
        const minX = radius;
        const maxX = Math.max(radius, bounds.width - radius);
        const minY = radius;
        const maxY = Math.max(radius, bounds.height - radius);

        return {
          id: index,
          radius,
          x: minX + (maxX - minX) * orb.x,
          y: minY + (maxY - minY) * orb.y,
          vx: orb.vx,
          vy: orb.vy
        };
      });

      renderOrbs();
    }

    function renderOrbs() {
      simulationRef.current.orbs.forEach((orb, index) => {
        const node = orbRefs.current[index];

        if (!node) {
          return;
        }

        node.style.width = `${orb.radius * 2}px`;
        node.style.height = `${orb.radius * 2}px`;
        node.style.transform = `translate3d(${orb.x - orb.radius}px, ${orb.y - orb.radius}px, 0)`;
      });
    }

    // Keep the motion simple and smooth: soft damping, wall bounce, and touch impulses.
    function step() {
      const state = simulationRef.current;
      const limitX = state.width;
      const limitY = state.height;

      state.orbs.forEach((orb) => {
        orb.x += orb.vx;
        orb.y += orb.vy;
        orb.vx *= 0.999;
        orb.vy *= 0.999;

        if (orb.x - orb.radius <= 0) {
          orb.x = orb.radius;
          orb.vx = Math.abs(orb.vx) * 0.98;
        } else if (orb.x + orb.radius >= limitX) {
          orb.x = limitX - orb.radius;
          orb.vx = -Math.abs(orb.vx) * 0.98;
        }

        if (orb.y - orb.radius <= 0) {
          orb.y = orb.radius;
          orb.vy = Math.abs(orb.vy) * 0.98;
        } else if (orb.y + orb.radius >= limitY) {
          orb.y = limitY - orb.radius;
          orb.vy = -Math.abs(orb.vy) * 0.98;
        }
      });

      renderOrbs();
      state.frameId = window.requestAnimationFrame(step);
    }

    function applyImpulse(clientX, clientY, scale = 1) {
      const bounds = arena.getBoundingClientRect();
      const x = clientX - bounds.left;
      const y = clientY - bounds.top;

      simulationRef.current.orbs.forEach((orb, index) => {
        const dx = orb.x - x;
        const dy = orb.y - y;
        const distance = Math.hypot(dx, dy);
        const reach = orb.radius + 84;

        if (distance > reach) {
          return;
        }

        const safeDistance = Math.max(distance, 1);
        const force = ((reach - safeDistance) / reach) * (2.8 + scale * 2.4);
        const impulseX = (dx / safeDistance) * force;
        const impulseY = (dy / safeDistance) * force;

        orb.vx += impulseX;
        orb.vy += impulseY;

        const node = orbRefs.current[index];
        if (node) {
          node.classList.remove("is-hit");
          void node.offsetWidth;
          node.classList.add("is-hit");
        }
      });
    }

    function handleHitAnimationEnd(event) {
      event.currentTarget.classList.remove("is-hit");
    }

    measureArena();
    step();

    const resizeObserver = new ResizeObserver(measureArena);
    resizeObserver.observe(arena);

    orbRefs.current.forEach((node) => node?.addEventListener("animationend", handleHitAnimationEnd));

    return () => {
      window.cancelAnimationFrame(simulationRef.current.frameId);
      resizeObserver.disconnect();
      orbRefs.current.forEach((node) => node?.removeEventListener("animationend", handleHitAnimationEnd));
    };
  }, []);

  function handleOrbHit(event) {
    const clientX = "clientX" in event ? event.clientX : event.touches?.[0]?.clientX;
    const clientY = "clientY" in event ? event.clientY : event.touches?.[0]?.clientY;

    if (typeof clientX !== "number" || typeof clientY !== "number") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    target.classList.remove("is-hit");
    void target.offsetWidth;
    target.classList.add("is-hit");

    const scale = event.type === "pointerdown" ? 1.28 : 1.05;
    const arena = arenaRef.current;

    if (!arena) {
      return;
    }

    const bounds = arena.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;

    simulationRef.current.orbs.forEach((orb) => {
      const dx = orb.x - x;
      const dy = orb.y - y;
      const distance = Math.hypot(dx, dy);
      const reach = orb.radius + 120;

      if (distance > reach) {
        return;
      }

      const safeDistance = Math.max(distance, 1);
      const force = ((reach - safeDistance) / reach) * (3.1 + scale * 1.9);
      orb.vx += (dx / safeDistance) * force;
      orb.vy += (dy / safeDistance) * force;
    });
  }

  return (
    <div ref={arenaRef} className="auth-orb-arena" aria-hidden="true">
      {ORB_CONFIG.map((orb, index) => (
        <button
          key={index}
          ref={(node) => {
            orbRefs.current[index] = node;
          }}
          type="button"
          className="auth-orb-ball"
          style={{ "--orb-size": `${orb.size}px` }}
          onPointerDown={handleOrbHit}
          onTouchStart={handleOrbHit}
          tabIndex={-1}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
