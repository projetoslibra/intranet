"use client";

// Fundo interativo do OSHER: glows em deriva + foco de luz que segue o cursor.
// Respeita prefers-reduced-motion (fica estatico, sem rAF).
//
// NOTA: o listener vai no `window`, nao no proprio root. O root tem
// pointer-events:none (para nao roubar cliques do formulario) e, por isso,
// nunca seria alvo de pointermove — o spotlight ficaria parado.

import * as React from "react";

export function AuthBackground() {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const spotRef = React.useRef<HTMLDivElement>(null);
  const glowsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    const spot = spotRef.current;
    const glows = glowsRef.current;

    if (!root || !spot || !glows) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let rect = root.getBoundingClientRect();
    let mx = rect.width / 2;
    let my = rect.height * 0.45;
    let sx = mx;
    let sy = my;
    let gx = 0;
    let gy = 0;
    let tgx = 0;
    let tgy = 0;
    let raf = 0;

    // Posicao inicial do spotlight (antes do primeiro movimento do mouse).
    spot.style.transform = `translate(${sx}px, ${sy}px)`;

    const onMove = (event: PointerEvent) => {
      mx = event.clientX - rect.left;
      my = event.clientY - rect.top;
      tgx = (mx / rect.width - 0.5) * 26;
      tgy = (my / rect.height - 0.5) * 22;
    };

    const onLeave = () => {
      tgx = 0;
      tgy = 0;
    };

    const onResize = () => {
      rect = root.getBoundingClientRect();
    };

    const loop = () => {
      sx += (mx - sx) * 0.12;
      sy += (my - sy) * 0.12;
      spot.style.transform = `translate(${sx}px, ${sy}px)`;
      gx += (tgx - gx) * 0.05;
      gy += (tgy - gy) * 0.05;
      glows.style.transform = `translate(${gx}px, ${gy}px)`;
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      ref={rootRef}
    >
      <div className="osher-bg-glows" ref={glowsRef}>
        <span className="osher-glow osher-glow--1" />
        <span className="osher-glow osher-glow--2" />
        <span className="osher-glow osher-glow--3" />
      </div>
      <div className="osher-spotlight" ref={spotRef} />
      <div className="osher-bg-grid" />
      <div className="osher-vignette" />
    </div>
  );
}

export default AuthBackground;
