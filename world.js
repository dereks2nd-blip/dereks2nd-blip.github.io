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
    // Camera bank, smoothed separately from the descent so it lags behind it.
    let rollEased = 0;
    // Drives the scale-in when the subject is swapped. Starts finished.
    let popT = 1;

    const scene = createAsciiScene({
      container: canvas,
      charSet: RAMP_FINE,
      // Small cells: on a 1265px viewport this is roughly 210x66 characters.
      // Affordable now that rows are painted to canvas rather than built as
      // DOM text, and the fine grid is what makes the geometry legible.
      fontSize: 10,
      // 1x. This layer covers the whole viewport, so it is by far the largest
      // thing being drawn; at 2x it cost 9ms a frame purely to paint. The grid
      // keeps exactly the same number of characters — each glyph is simply
      // rasterised once rather than twice over, which on a background sitting
      // at half opacity behind the content is not a difference you can see.
      maxDpr: 1,
      color: DAYLIGHT_INK,
      fov: 55,
      drag: true,
      // Half rate. Every frame of this costs a synchronous GPU->CPU readback,
      // which is a stall the CPU spends waiting rather than working, and it is
      // by far the most expensive thing on the page. The subject drifts at a
      // quarter radian a second and the descent is heavily smoothed, so there
      // is almost nothing here that 60fps resolves and 30 does not — while the
      // page's own scrolling and animation get the whole budget back.
      fps: 30,
      build: buildIsland,
      onFrame({ camera, pivot, setColor, state, delta, elapsed }) {
        // Heavier smoothing than feels necessary on paper: the descent should
        // glide behind the reader, not track the scrollbar frame for frame.
        const prevEased = scrollEased;
        // Scaled by delta rather than a flat per-frame fraction. A fixed 0.045
        // would ease half as fast the moment the frame rate is halved, so the
        // fps cap would visibly slow the descent instead of just drawing it
        // less often. The constant is chosen to reproduce the old 0.045 at 60.
        scrollEased += (scrollTarget - scrollEased) * Math.min(1, delta * 2.7);
        const p = scrollEased;
        // How fast the descent is actually travelling this frame. Taken from
        // the smoothed value rather than raw scroll, so it ramps up and coasts
        // down instead of spiking on every wheel notch.
        const vel = p - prevEased;

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

        if (!prefersReducedMotion) {
          // Bank into the descent. This has to come after lookAt, which writes
          // the entire orientation and would wipe a roll set before it. Eased
          // at a seventh of the gap so the camera leans in and rights itself
          // well after the scrolling stops, rather than snapping upright.
          rollEased += (clamp(vel * 30, -0.22, 0.22) - rollEased) * Math.min(1, delta * 4.2);
          camera.rotation.z += rollEased;

          // Idle drift, plus a kick proportional to how fast the page is
          // moving — the world spins up when you scroll and coasts back down.
          pivot.rotation.y += delta * 0.25 + vel * 9;

          // Never completely still. A slow float and two lazy out-of-phase
          // tilts, so the subject always looks suspended rather than mounted.
          pivot.position.y = Math.sin(elapsed * 0.7) * 0.45;
          pivot.rotation.x = Math.sin(elapsed * 0.43) * 0.06;
          pivot.rotation.z = Math.cos(elapsed * 0.31) * 0.04;

          // Scale-in after a subject swap, overshooting once before settling.
          if (popT < 1) {
            popT = Math.min(1, popT + delta * 2.6);
            const c1 = 1.70158;
            const c3 = c1 + 1;
            const eased = 1 + c3 * Math.pow(popT - 1, 3) + c1 * Math.pow(popT - 1, 2);
            pivot.scale.setScalar(0.25 + 0.75 * eased);
          }
        }

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
        // Restart the scale-in so a swap reads as the new subject arriving.
        popT = 0;
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

  // The camera orbits the model as the pointer crosses the card, so the
  // thumbnail is a real object being looked around rather than a looping
  // animation playing in a box. The whole card is the input surface, not just
  // the picture: the model should already be turning by the time the pointer
  // arrives at it, which is what ties it to the card's own tilt.
  const card = el.closest(".project-card") || el;
  const aim = { x: 0, y: 0, easedX: 0, easedY: 0 };

  if (!prefersReducedMotion) {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      aim.x = clamp((e.clientX - r.left) / r.width - 0.5, -0.5, 0.5);
      aim.y = clamp((e.clientY - r.top) / r.height - 0.5, -0.5, 0.5);
    }, { passive: true });

    // Drifts back to centre rather than freezing wherever the pointer left.
    card.addEventListener("pointerleave", () => {
      aim.x = 0;
      aim.y = 0;
    });
  }

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
      // A slow rotation in a 471x166 box. Two of these were costing a readback
      // each per frame for motion nobody can resolve at that size.
      fps: 24,
      onFrame({ camera, delta }) {
        // Eased so the camera trails the pointer instead of being welded to
        // it, which is what reads as weight. Delta-scaled for the same reason
        // the descent is: the trail should not lengthen when the rate drops.
        const k = Math.min(1, delta * 5.4);
        aim.easedX += (aim.x - aim.easedX) * k;
        aim.easedY += (aim.y - aim.easedY) * k;

        const yaw = aim.easedX * 1.7;
        const radius = 9;
        camera.position.set(
          Math.sin(yaw) * radius,
          2.5 + aim.easedY * 5.5,
          Math.cos(yaw) * radius
        );
        camera.lookAt(0, 0, 0);
      },
    });
  } catch (err) {
    console.error("Card thumbnail failed:", err);
    el.remove();
  }
});
