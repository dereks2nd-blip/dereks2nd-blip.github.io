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

/* ---------- Card materialize ---------- */

// Cards start buried under a grid of stone cells that dissolve away in random
// order, so they resolve out of the rock instead of sliding in. The overlay is
// built immediately rather than on intersection — otherwise the card would sit
// fully visible until it was scrolled to.
function initPixelate() {
  const cards = document.querySelectorAll("[data-pixelate]");
  if (!cards.length) return;

  if (prefersReducedMotion) {
    cards.forEach((card) => card.classList.add("materialized"));
    return;
  }

  const COLS = 16;
  const ROWS = 11;

  // Each card keeps its overlay for the life of the page. `idx` is how many
  // cells are currently cleared, so a reversal just walks that number back
  // down from wherever it got to instead of restarting.
  const states = new Map();

  cards.forEach((card) => {
    const overlay = document.createElement("div");
    overlay.className = "pixel-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.setProperty("--cols", COLS);
    overlay.style.setProperty("--rows", ROWS);

    const cells = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const cell = document.createElement("span");
      // Per-cell scatter direction, spin and duration. Written as one cssText
      // assignment rather than five setProperty calls because this runs 176
      // times per card at load. The CSS reads these as unitless multipliers.
      const rnd = () => (Math.random() * 2 - 1).toFixed(2);
      cell.style.cssText =
        `--dx:${rnd()};--dy:${rnd()};--rx:${rnd()};--rz:${rnd()};` +
        `--dur:${Math.random().toFixed(2)}`;
      overlay.appendChild(cell);
      cells.push(cell);
    }

    // Fisher-Yates, so the dissolve order is genuinely scattered rather than
    // sweeping in one direction.
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    // Delegated rather than one listener per cell: 176 cells per card, and only
    // ever one of them finishing at a time. Marking a cell spent retires it
    // from rendering once it has finished travelling.
    overlay.addEventListener("transitionend", (e) => {
      if (e.propertyName !== "opacity") return;
      if (e.target.classList.contains("gone")) e.target.classList.add("spent");
    });

    card.appendChild(overlay);
    states.set(card, { cells, idx: 0, dir: null, raf: null, timer: null });
  });

  // Spread across ~55 frames so it reads as a slow build, not a flicker.
  const run = (card, dir) => {
    const s = states.get(card);
    if (!s || s.dir === dir) return;

    s.dir = dir;
    if (s.raf) cancelAnimationFrame(s.raf);

    const perFrame = Math.ceil(s.cells.length / 55);

    const step = () => {
      for (let k = 0; k < perFrame; k++) {
        if (dir === "clear") {
          if (s.idx >= s.cells.length) break;
          s.cells[s.idx].classList.add("gone");
          s.idx++;
        } else {
          if (s.idx <= 0) break;
          s.idx--;
          // "spent" has to come off in the same write as "gone", or the cell
          // stays visibility:hidden and never plays its way back in.
          s.cells[s.idx].classList.remove("gone", "spent");
        }
      }

      const done = dir === "clear" ? s.idx >= s.cells.length : s.idx <= 0;
      if (!done) {
        s.raf = requestAnimationFrame(step);
        return;
      }
      s.raf = null;
      // The ring only fires once the last cell is actually gone.
      if (dir === "clear") card.classList.add("materialized");
    };

    if (dir === "cover") card.classList.remove("materialized");
    s.raf = requestAnimationFrame(step);
  };

  if (typeof IntersectionObserver === "undefined") {
    cards.forEach((card) => run(card, "clear"));
    return;
  }

  // No unobserve: scrolling away re-buries the card so it can resolve again on
  // the way back.
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const card = entry.target;
        const s = states.get(card);
        if (s?.timer) window.clearTimeout(s.timer);

        if (!entry.isIntersecting) {
          run(card, "cover");
          return;
        }
        // Stagger so the two cards don't resolve in lockstep.
        const delay = Number(card.style.getPropertyValue("--i") || 0) * 240;
        if (s) s.timer = window.setTimeout(() => run(card, "clear"), delay);
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
