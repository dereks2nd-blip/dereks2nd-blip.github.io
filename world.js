// Drives the persistent world behind the page.
//
// One fixed ASCII scene sits behind every section, and scroll position moves
// the camera through it: the page opens above a floating island in daylight and
// descends down a stone shaft as you read. The sky layer, the ink color and the
// render density are all tied to the same scroll progress, so the descent reads
// as one continuous move rather than a set of separate effects.

import {
  createAsciiScene, SUBJECTS, buildIsland, buildShaft,
  buildCabbage, buildTorus, prefersReducedMotion,
  clamp, lerp, mixHex, RAMP_FINE, RAMP_BOLD,
} from "./ascii.js";
import { initKinetic, revealHeroName } from "./kinetic.js";

initKinetic();

// script.js runs the world-gen intro and fires this once the curtain lifts, so
// the name animation plays against the hero instead of behind the overlay.
window.addEventListener("hero:reveal", revealHeroName);

/* ---------- Scroll progress ---------- */

// Smoothed so a trackpad flick glides the camera instead of snapping it.
let scrollTarget = 0;
let scrollEased = 0;

const readScroll = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  scrollTarget = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
};
window.addEventListener("scroll", readScroll, { passive: true });
window.addEventListener("resize", readScroll);
readScroll();
scrollEased = scrollTarget;

const sky = document.getElementById("sky");

/* ---------- The world ---------- */

const canvas = document.getElementById("site-canvas");
if (canvas) {
  try {
    const DAYLIGHT_INK = "#26331a";
    const TORCH_INK = "#ffb347";
    let lastInkStep = -1;

    const scene = createAsciiScene({
      container: canvas,
      charSet: RAMP_FINE,
      // Small cells: on a 1265px viewport this is roughly 210x66 characters.
      // Affordable now that rows are painted to canvas rather than built as
      // DOM text, and the fine grid is what makes the geometry legible.
      fontSize: 10,
      color: DAYLIGHT_INK,
      fov: 55,
      drag: true,
      build: buildIsland,
      onFrame({ camera, pivot, setColor, state, delta }) {
        // Heavier smoothing than feels necessary on paper: the descent should
        // glide behind the reader, not track the scrollbar frame for frame.
        scrollEased += (scrollTarget - scrollEased) * 0.045;
        const p = scrollEased;

        // Spiral descent: the camera swings around the axis while dropping, so
        // the walls slide past instead of sitting still.
        const angle = p * 2.4 + state.dragYaw;
        // The walls close in late, so the shaft tightens as you reach the
        // bottom of the page rather than immediately after the hero. Starting
        // tighter keeps the island large enough to read as an island.
        const radius = lerp(12.5, 5.5, clamp(p * 1.05, 0, 1));
        const camY = lerp(5, -40, p);

        camera.position.set(
          Math.sin(angle) * radius,
          camY,
          Math.cos(angle) * radius
        );
        // Aiming below the camera keeps the island framed at the top and sells
        // the downward travel once the shaft closes in.
        camera.lookAt(0, camY - 4 + state.dragPitch * 8, 0);

        if (!prefersReducedMotion) pivot.rotation.y += delta * 0.25;

        // Daylight ink turns to torchlight gradually across most of the page,
        // so the world keeps resolving the further down you read. These are
        // quantised and only written on change: assigning styles every frame
        // dirties layout for no visible gain.
        const inkT = clamp(p * 1.25, 0, 1);
        const step = Math.round(inkT * 40);
        if (step !== lastInkStep) {
          lastInkStep = step;
          const t = step / 40;
          setColor(mixHex(DAYLIGHT_INK, TORCH_INK, t));
          canvas.style.opacity = lerp(0.45, 0.82, t);
          if (sky) sky.style.opacity = String(1 - clamp(p * 1.15, 0, 1));
        }
      },
    });

    // The shaft is static scenery, so it lives on the scene rather than the
    // pivot — swapping the floating subject must not delete the walls.
    scene.scene.add(buildShaft());

    const picker = document.getElementById("world-picker");
    if (picker) {
      picker.hidden = false;
      picker.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-subject]");
        if (!btn || !SUBJECTS[btn.dataset.subject]) return;
        scene.setSubject(SUBJECTS[btn.dataset.subject]);
        picker.querySelectorAll("[data-subject]").forEach((b) => {
          b.classList.toggle("selected", b === btn);
          b.setAttribute("aria-pressed", String(b === btn));
        });
      });
    }
  } catch (err) {
    console.error("World scene failed:", err);
    canvas.remove();
    if (sky) sky.style.opacity = "1";
    document.body.classList.add("no-world");
  }
}

/* ---------- Project card thumbnails ---------- */

const THUMBS = { cabbage: buildCabbage, torus: buildTorus };

document.querySelectorAll("[data-thumb]").forEach((el) => {
  const build = THUMBS[el.dataset.thumb];
  if (!build) return;
  try {
    createAsciiScene({
      container: el,
      build,
      charSet: RAMP_BOLD,
      color: "#6fd8e0",
      fontSize: 8,
      fov: 45,
      autoRotate: true,
      autoRotateSpeed: 0.7,
      onFrame({ camera }) {
        camera.position.set(0, 2.5, 9);
        camera.lookAt(0, 0, 0);
      },
    });
  } catch (err) {
    console.error("Card thumbnail failed:", err);
    el.remove();
  }
});
