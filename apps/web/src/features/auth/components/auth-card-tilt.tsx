"use client";

// Inclinacao 3d suave do card em relacao ao cursor (mockup aprovado).
// Puramente decorativo: desliga em prefers-reduced-motion e nao interfere
// no formulario (so aplica transform no wrapper).

import * as React from "react";

export function AuthCardTilt({ children }: { children: React.ReactNode }) {
  const tiltRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const tilt = tiltRef.current;

    if (!tilt) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let rx = 0;
    let ry = 0;
    let trx = 0;
    let tRy = 0;
    let raf = 0;

    const onMove = (event: PointerEvent) => {
      const px = event.clientX / window.innerWidth;
      const py = event.clientY / window.innerHeight;
      tRy = (px - 0.5) * 7;
      trx = -(py - 0.5) * 6;
    };

    const onLeave = () => {
      trx = 0;
      tRy = 0;
    };

    const loop = () => {
      rx += (trx - rx) * 0.08;
      ry += (tRy - ry) * 0.08;
      tilt.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className="osher-tilt" ref={tiltRef}>
      {children}
    </div>
  );
}

export default AuthCardTilt;
