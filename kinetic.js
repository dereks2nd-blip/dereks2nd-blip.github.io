// Motion layer: scroll reveals, the card materialize effect, the ASCII wave
// dividers, and the hero name.
//
// Everything here is an enhancement. The real text ships in the HTML and stays
// readable if this module never loads, so nothing is hidden until JS has
// actually taken ownership of it.

import { prefersReducedMotion } from "./ascii.js";

const GLYPHS = "!<>-_\\/[]{}=+*^?#%@$&0123456789";
const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

/* ---------- Scramble ---------- */

function scramble(el) {
  // Captured once and kept, so a re-entrant call can never mistake half-
  // scrambled glyphs for the original text.
  const text = el.dataset.scrambleText || el.textContent;
  el.dataset.scrambleText = text;

  if (prefersReducedMotion) {
    el.textContent = text;
    return;
  }
  if (el.dataset.scrambling === "true") return;
  el.dataset.scrambling = "true";

  const chars = [...text];
  // Driven by elapsed time on a timer rather than a frame count on rAF.
  // Frame-counting strands the text mid-scramble whenever frames stall — a
  // background tab throttles rAF to nothing and the label stays garbage.
  const settleAt = chars.map((_, i) => 110 + i * 45);
  const total = Math.max(...settleAt) + 60;
  const start = performance.now();

  const step = () => {
    const t = performance.now() - start;
    el.textContent = chars
      .map((ch, i) => (ch === " " || t >= settleAt[i] ? ch : randomGlyph()))
      .join("");

    if (t < total) {
      window.setTimeout(step, 40);
    } else {
      el.textContent = text;
      el.dataset.scrambling = "false";
    }
  };
  step();
}

// Deliberate interactions only — nothing scrambles just because it scrolled
// into view. That was the version that read as too much.
function initHoverScramble() {
  document.querySelectorAll("[data-scramble-hover]").forEach((el) => {
    el.addEventListener("pointerenter", () => scramble(el));
  });
}

/* ---------- Card build ---------- */

// Each card is constructed out of stone blocks that fall in along a diagonal
// front, land, stand as a complete wall for a beat, and then drop away leaving
// the finished card behind.
//
// The timing is entirely CSS: every block carries its position in the diagonal
// as --o, and the stylesheet turns that into an animation-delay. That replaced
// a hand-rolled requestAnimationFrame stepper, which had to run every frame,
// track a direction and an index per card, and unwind itself on reversal. A
// class toggle does the same job here, off the main thread, and it replays and
// reverses for free.
function initPixelate() {
  const cards = document.querySelectorAll("[data-pixelate]");
  if (!cards.length) return;

  // Nothing is hidden and no overlay is built, so the cards simply exist.
  if (prefersReducedMotion) return;

  // Fewer, larger blocks than before. At 176 they were too small to read as
  // blocks at all, which is most of why the effect looked like noise.
  const COLS = 14;
  const ROWS = 10;

  cards.forEach((card) => {
    const overlay = document.createElement("div");
    overlay.className = "pixel-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.setProperty("--cols", COLS);
    overlay.style.setProperty("--rows", ROWS);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = document.createElement("span");
        // Position in the diagonal front, and a stone shade off a fixed
        // lattice. Both are deterministic: the same block is the same shade
        // and lands at the same moment every time the card is scrolled past.
        cell.style.cssText = `--o:${col + row};--tone:${(col * 3 + row * 5) % 4}`;
        overlay.appendChild(cell);
      }
    }

    card.appendChild(overlay);
    // Only now is it safe to hide the card's real content: the overlay that
    // covers it during the build actually exists.
    card.classList.add("has-build");
  });

  if (typeof IntersectionObserver === "undefined") {
    cards.forEach((card) => card.classList.add("built"));
    return;
  }

  // No unobserve: scrolling away resets the card so it builds again on the way
  // back. The per-card offset lives in CSS, off --i, so there is no timer here.
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("built", entry.isIntersecting);
      });
    },
    { threshold: 0.25 }
  );
  cards.forEach((card) => io.observe(card));
}

/* ---------- Card tilt ---------- */

// Turns each project card to face the cursor and drags a torchlight highlight
// along with it. The card's transform reads --rx/--ry and the highlight reads
// --lx/--ly; all four default to neutral in CSS, so a card that never gets
// hovered simply sits flat.
function initCardTilt() {
  const cards = document.querySelectorAll(".project-card");
  if (!cards.length || prefersReducedMotion) return;

  // Touch devices fire pointermove only during a tap, which would leave the
  // card frozen at whatever angle the finger lifted at.
  if (!window.matchMedia("(hover: hover)").matches) return;

  const MAX_TILT = 7;

  cards.forEach((card) => {
    let frame = null;
    let px = 0;
    let py = 0;

    const apply = () => {
      frame = null;
      // Read the rect here rather than in the event: pointermove can fire
      // several times per displayed frame, and each rect read forces layout.
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const x = (px - rect.left) / rect.width - 0.5;
      const y = (py - rect.top) / rect.height - 0.5;

      // Tilting away from the cursor is what sells depth — the near edge is
      // the one under the pointer.
      card.style.setProperty("--rx", `${(-y * MAX_TILT).toFixed(2)}deg`);
      card.style.setProperty("--ry", `${(x * MAX_TILT).toFixed(2)}deg`);
      card.style.setProperty("--lx", `${(x * 100 + 50).toFixed(1)}%`);
      card.style.setProperty("--ly", `${(y * 100 + 50).toFixed(1)}%`);
    };

    card.addEventListener("pointermove", (e) => {
      px = e.clientX;
      py = e.clientY;
      if (frame === null) frame = requestAnimationFrame(apply);
    }, { passive: true });

    card.addEventListener("pointerleave", () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      // Only the angle resets. The highlight position is left where it was so
      // it fades out in place instead of sliding back to centre as it goes.
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  });
}

/* ---------- ASCII wave dividers ---------- */

const RAMP = " .:-=+*#%@";

function initWaves() {
  const waves = [...document.querySelectorAll("[data-wave]")];
  if (!waves.length) return;

  const pointer = { x: 0.5 };
  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX / window.innerWidth;
  }, { passive: true });

  const ROWS = 2;

  // Column counts are cached and only recomputed on resize. Reading
  // clientWidth inside the animation loop forces a synchronous relayout of the
  // whole document every frame, and with the ASCII grid in the DOM that alone
  // was enough to lock the main thread.
  const colsFor = new Map();
  const measure = () => {
    waves.forEach((el) => {
      // Courier at this size is close enough to 7.6px per cell; overshooting
      // slightly is safer than wrapping, which would break the wave.
      colsFor.set(el, Math.max(20, Math.floor(el.clientWidth / 7.6)));
    });
  };
  measure();
  window.addEventListener("resize", measure);

  const paint = (el, time) => {
    const cols = colsFor.get(el) || 20;
    const lines = [];

    for (let row = 0; row < ROWS; row++) {
      let line = "";
      for (let col = 0; col < cols; col++) {
        const t = col / cols;
        const crest =
          Math.sin(t * 9 + time * 1.4) * 0.5 +
          Math.sin(t * 21 - time * 0.9) * 0.3 +
          Math.sin((t - pointer.x) * 14) * 0.35;
        // Row 1 trails row 0 so the band reads as depth, not two copies.
        const depth = crest - row * 0.55;
        const idx = Math.round(((depth + 1) / 2) * (RAMP.length - 1));
        line += RAMP[Math.min(RAMP.length - 1, Math.max(0, idx))];
      }
      lines.push(line);
    }
    el.textContent = lines.join("\n");
  };

  if (prefersReducedMotion) {
    waves.forEach((el) => paint(el, 0));
    return;
  }

  const visible = new Set(waves);
  if (typeof IntersectionObserver !== "undefined") {
    visible.clear();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
    }, { rootMargin: "80px" });
    waves.forEach((el) => io.observe(el));
  }

  const start = performance.now();
  let last = 0;
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (now - last < 1000 / 30) return;
    last = now;
    const time = (now - start) / 1000;
    visible.forEach((el) => paint(el, time));
  };
  requestAnimationFrame(loop);
}

/* ---------- Scroll reveals ---------- */

function initReveals() {
  const targets = document.querySelectorAll("[data-reveal]");
  if (!targets.length) return;

  if (prefersReducedMotion || typeof IntersectionObserver === "undefined") {
    targets.forEach((el) => el.classList.add("in"));
    return;
  }

  // Toggled rather than one-shot, so scrolling back up plays each entrance in
  // reverse and scrolling down again replays it.
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("in", entry.isIntersecting);
      });
    },
    { threshold: 0.12 }
  );
  targets.forEach((el) => io.observe(el));
}

/* ---------- Hero name ---------- */

// Blocks falling into place, each one churning through glyphs on the way down
// before settling into its real character. The stagger itself is CSS (driven
// off --i); the churn is timed here to land on the same beat.
//
// Splitting into spans happens here rather than in the HTML so the plain name
// is what search engines and no-JS visitors get.
const LETTER_STAGGER = 55;

export function revealHeroName() {
  const el = document.getElementById("hero-name");
  if (!el || el.dataset.split === "true") return;

  const chars = [...el.textContent];
  el.dataset.split = "true";
  el.textContent = "";

  const spans = chars.map((ch, i) => {
    const span = document.createElement("span");
    span.className = "letter";
    span.textContent = ch === " " ? " " : ch;
    span.style.setProperty("--i", i);
    if (prefersReducedMotion) span.classList.add("settled");
    el.appendChild(span);
    return span;
  });

  if (prefersReducedMotion) return;

  // Started synchronously rather than inside requestAnimationFrame: a keyframe
  // animation runs from its own 0% regardless of when the class lands, and rAF
  // never fires in a background tab — which left the name stuck invisible.
  el.classList.add("dropping");

  chars.forEach((ch, i) => {
    const span = spans[i];
    if (ch === " ") {
      span.classList.add("settled");
      return;
    }
    window.setTimeout(() => {
      let ticks = 0;
      const id = window.setInterval(() => {
        span.textContent = randomGlyph();
        if (++ticks >= 5) {
          window.clearInterval(id);
          span.textContent = ch;
          span.classList.add("settled");
        }
      }, 45);
    }, i * LETTER_STAGGER);
  });
}

export function initKinetic() {
  initReveals();
  initPixelate();
  initCardTilt();
  initHoverScramble();
  initWaves();
}
