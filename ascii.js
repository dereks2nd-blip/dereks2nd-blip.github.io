// Shared Three.js -> ASCII plumbing.
//
// The scene is rendered with real lighting into a tiny offscreen WebGL buffer
// sized one pixel per character cell. Each pixel's brightness picks a glyph
// from the ramp, and the glyphs are painted to a 2D canvas — one fillText per
// row, not per character.
//
// This deliberately does not use three's AsciiEffect. That builds the grid as
// DOM text and rewrites its innerHTML every frame, which for a full-viewport
// scene means tens of thousands of layout-bearing text cells per frame: the
// cause of both the stutter and the vertical tearing. Painting to canvas costs
// one draw call per row instead, so the grid can be dense and fine-grained
// without touching layout at all.
//
// OrbitControls is likewise avoided — page scroll drives the camera, and orbit
// controls would fight it for the wheel.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js";

export const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Character ramps, darkest to lightest. The long one resolves ~70 brightness
// levels instead of 10, which is what lets a face, an edge and a shadowed
// corner land on visibly different glyphs — the difference between a blob and
// a readable object.
export const RAMP_FINE =
  " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

// Short and high-contrast, for small panels where fine gradation just reads as
// noise and the silhouette is what matters.
export const RAMP_BOLD = " .:-=+*#%@";

export function createAsciiScene(options) {
  const {
    container,
    charSet = RAMP_BOLD,
    // Character cell height in CSS pixels. Smaller means a finer, denser grid;
    // cost scales with rows, not with total characters.
    fontSize = 10,
    color = "#ffb347",
    fov = 55,
    autoRotate = false,
    autoRotateSpeed = 0.5,
    drag = false,
    fps = 0,
    build,
    onFrame,
  } = options;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 400);
  camera.position.set(0, 4, 14);
  camera.lookAt(0, 0, 0);

  // Three lights, not one: ASCII only reads as a shape if the brightness ramp
  // has real range, so a key/rim pair plus a deliberately weak fill keeps every
  // face on a different character instead of flattening onto one glyph. The
  // ambient term is kept low on purpose — lifting it washes the ramp out and
  // the geometry stops being legible.
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(6, 10, 4);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-8, 3, -7);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.16));

  // A swappable subject hangs off its own pivot so changing it never disturbs
  // the camera, the lights, or anything else parented to the scene.
  const pivot = new THREE.Group();
  scene.add(pivot);

  // preserveDrawingBuffer so readPixels is valid after render within the frame.
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  const gl = renderer.getContext();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  container.innerHTML = "";
  container.appendChild(canvas);

  let ink = color;
  const setColor = (next) => { ink = next; };

  let cols = 0;
  let rows = 0;
  let charW = 0;
  let charH = 0;
  let cssW = 0;
  let cssH = 0;
  let pixels = null;

  let current = null;
  const setSubject = (builder) => {
    if (current) {
      pivot.remove(current);
      disposeTree(current);
    }
    current = builder();
    pivot.add(current);
    return current;
  };
  if (build) setSubject(build);

  const FONT = (size) => `${size}px "Courier New", ui-monospace, monospace`;

  const fit = () => {
    cssW = container.clientWidth;
    cssH = container.clientHeight;
    if (!cssW || !cssH) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = FONT(fontSize);
    ctx.textBaseline = "top";

    // Measured, not assumed: the advance width decides how many columns fit,
    // and a row is drawn as one string so it must match the font exactly.
    charW = ctx.measureText("M").width || fontSize * 0.6;
    charH = fontSize;

    cols = Math.max(8, Math.floor(cssW / charW));
    rows = Math.max(8, Math.floor(cssH / charH));

    renderer.setSize(cols, rows, false);
    // Aspect follows the cells' display footprint, not the pixel buffer, since
    // character cells are taller than they are wide.
    camera.aspect = (cols * charW) / (rows * charH);
    camera.updateProjectionMatrix();
    pixels = new Uint8Array(cols * rows * 4);
  };
  fit();

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(container);
  else window.addEventListener("resize", fit);

  // Drag accumulates into state rather than moving the camera directly, so
  // scroll-driven positioning and pointer input can both feed one final pose.
  const state = { dragYaw: 0, dragPitch: 0 };
  if (drag && !prefersReducedMotion) {
    let active = false;
    let lastX = 0;
    let lastY = 0;

    container.addEventListener("pointerdown", (e) => {
      active = true;
      lastX = e.clientX;
      lastY = e.clientY;
      container.setPointerCapture(e.pointerId);
      container.classList.add("grabbing");
    });
    container.addEventListener("pointermove", (e) => {
      if (!active) return;
      state.dragYaw += (e.clientX - lastX) * 0.006;
      state.dragPitch = clamp(state.dragPitch + (e.clientY - lastY) * 0.003, -0.6, 0.6);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const release = (e) => {
      active = false;
      container.classList.remove("grabbing");
      if (e.pointerId !== undefined && container.hasPointerCapture?.(e.pointerId)) {
        container.releasePointerCapture(e.pointerId);
      }
    };
    container.addEventListener("pointerup", release);
    container.addEventListener("pointercancel", release);
  }

  // Offscreen scenes keep their context but stop doing work — several of these
  // run on one page at once.
  let visible = true;
  if (typeof IntersectionObserver !== "undefined") {
    new IntersectionObserver(
      (entries) => { visible = entries[0].isIntersecting; },
      { rootMargin: "150px" }
    ).observe(container);
  }

  const lastIndex = charSet.length - 1;

  const paint = () => {
    if (!pixels || !cols || !rows) return;

    renderer.render(scene, camera);
    gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.font = FONT(fontSize);
    ctx.textBaseline = "top";
    ctx.fillStyle = ink;

    for (let y = 0; y < rows; y++) {
      // readPixels returns bottom-up, so walk the buffer in reverse.
      const src = (rows - 1 - y) * cols;
      let line = "";
      for (let x = 0; x < cols; x++) {
        const i = (src + x) * 4;
        const lum = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
        let idx = Math.round(lum * lastIndex);
        if (idx < 0) idx = 0;
        else if (idx > lastIndex) idx = lastIndex;
        line += charSet[idx];
      }
      // One draw call per row rather than per character — this is what makes a
      // dense grid affordable.
      ctx.fillText(line, 0, y * charH);
    }
  };

  const frameInterval = fps > 0 ? 1000 / fps : 0;
  let lastFrame = 0;

  const clock = new THREE.Clock();
  const tick = (now = 0) => {
    requestAnimationFrame(tick);
    if (!visible) return;
    if (frameInterval && now - lastFrame < frameInterval) return;
    lastFrame = now;

    const delta = clock.getDelta();

    if (autoRotate && !prefersReducedMotion) {
      pivot.rotation.y += delta * autoRotateSpeed;
    }

    if (onFrame) onFrame({ camera, pivot, setColor, state, delta, elapsed: clock.elapsedTime });

    paint();
  };
  requestAnimationFrame(tick);

  return { setSubject, scene, camera, pivot, state, setColor };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// Blend two hex colors so the world's ink can shift from daylight to torchlight
// as the camera descends.
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}

function disposeTree(root) {
  root.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

/* ---------- Subjects ---------- */

const CUBE = new THREE.BoxGeometry(1, 1, 1);
const lambert = (color) => new THREE.MeshLambertMaterial({ color });

// A floating voxel chunk: grass cap, dirt body, stone underside, with a jagged
// edge and per-load variation so the "generating world" intro isn't a lie.
export function buildIsland() {
  const group = new THREE.Group();
  const size = 9;
  const center = (size - 1) / 2;
  const seed = Math.random() * 1000;

  const columns = [];
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const dx = x - center;
      const dz = z - center;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const noise = Math.sin(x * 1.3 + seed) + Math.cos(z * 1.7 + seed);
      const radius = center * 0.85 + noise * 0.7;
      if (dist > radius) continue;
      if (dist > radius - 0.6 && Math.random() < 0.35) continue;

      const heightNoise = (Math.sin(x * 0.9 + seed * 0.5) + Math.cos(z * 0.9 + seed * 0.5)) * 0.5;
      const h = Math.max(2, Math.round(4 - dist * 0.45 + heightNoise));
      columns.push({ x: dx, z: dz, h });
    }
  }

  const counts = { grass: 0, dirt: 0, stone: 0 };
  columns.forEach((c) => {
    counts.grass += 1;
    counts.dirt += Math.min(2, c.h - 1);
    counts.stone += Math.max(0, c.h - 3);
  });

  const grass = new THREE.InstancedMesh(CUBE, lambert(0x6aa84f), Math.max(1, counts.grass));
  const dirt = new THREE.InstancedMesh(CUBE, lambert(0x8b5a2b), Math.max(1, counts.dirt));
  const stone = new THREE.InstancedMesh(CUBE, lambert(0x6b6b6b), Math.max(1, counts.stone));

  const dummy = new THREE.Object3D();
  let gi = 0, di = 0, si = 0;

  columns.forEach(({ x, z, h }) => {
    for (let k = 0; k < h; k++) {
      dummy.position.set(x, -k, z);
      dummy.updateMatrix();
      if (k === 0) grass.setMatrixAt(gi++, dummy.matrix);
      else if (k <= 2) dirt.setMatrixAt(di++, dummy.matrix);
      else stone.setMatrixAt(si++, dummy.matrix);
    }
  });

  grass.count = gi;
  dirt.count = di;
  stone.count = si;
  [grass, dirt, stone].forEach((m) => { m.instanceMatrix.needsUpdate = true; });

  group.add(grass, dirt, stone);
  return group;
}

// The shaft the camera falls down. Ragged rings of stone with ore pockets, so
// descending reads as passing through rock rather than drifting in the dark.
export function buildShaft({ top = -6, bottom = -46 } = {}) {
  const group = new THREE.Group();
  const seed = Math.random() * 100;

  const stoneCells = [];
  const oreCells = [];

  for (let y = top; y >= bottom; y--) {
    const wobble = Math.sin(y * 0.35 + seed) * 1.6;
    const radius = 8.5 + wobble;
    const ringCount = 26;

    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      // Carve openings so the wall breathes and light gets through.
      if (Math.sin(angle * 3 + y * 0.4 + seed) > 0.72) continue;

      const jitter = Math.sin(angle * 5 + y) * 0.9;
      const r = radius + jitter;
      const x = Math.round(Math.cos(angle) * r);
      const z = Math.round(Math.sin(angle) * r);

      if (Math.random() < 0.045) oreCells.push([x, y, z]);
      else stoneCells.push([x, y, z]);

      // A second, thicker layer on some rows gives the wall depth in ASCII.
      if (Math.random() < 0.35) {
        stoneCells.push([
          Math.round(Math.cos(angle) * (r + 1)),
          y,
          Math.round(Math.sin(angle) * (r + 1)),
        ]);
      }
    }
  }

  const stone = new THREE.InstancedMesh(CUBE, lambert(0x5f5f5f), Math.max(1, stoneCells.length));
  const ore = new THREE.InstancedMesh(CUBE, lambert(0x6fd8e0), Math.max(1, oreCells.length));
  const dummy = new THREE.Object3D();

  stoneCells.forEach(([x, y, z], i) => {
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    stone.setMatrixAt(i, dummy.matrix);
  });
  oreCells.forEach(([x, y, z], i) => {
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    ore.setMatrixAt(i, dummy.matrix);
  });

  stone.instanceMatrix.needsUpdate = true;
  ore.instanceMatrix.needsUpdate = true;
  group.add(stone, ore);
  return group;
}

export function buildCreeper() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), lambert(0x6aa84f)));

  // Face cells on an 8x8 grid, mapped onto the front face at z = +2.
  const cells = [
    [1, 2], [2, 2], [1, 3], [2, 3],
    [5, 2], [6, 2], [5, 3], [6, 3],
    [3, 4], [4, 4], [3, 5], [4, 5],
    [2, 5], [5, 5], [2, 6], [5, 6],
    [3, 6], [4, 6],
  ];
  const faceGeo = new THREE.BoxGeometry(0.5, 0.5, 0.12);
  const faceMat = lambert(0x1b1b1b);
  cells.forEach(([cx, cy]) => {
    const cell = new THREE.Mesh(faceGeo, faceMat);
    cell.position.set((cx - 3.5) * 0.5, (3.5 - cy) * 0.5, 2.02);
    group.add(cell);
  });
  return group;
}

export function buildDiamond() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.OctahedronGeometry(3.4, 0), lambert(0x6fd8e0)));
  group.add(new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), lambert(0xffffff)));
  return group;
}

export function buildKnot() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.TorusKnotGeometry(2.4, 0.8, 160, 24), lambert(0xffb347)));
  return group;
}

export function buildCabbage() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 1), lambert(0x8bc34a)));
  return group;
}

export function buildTorus() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.9, 20, 40), lambert(0x6fd8e0)));
  return group;
}

export const SUBJECTS = {
  island: buildIsland,
  creeper: buildCreeper,
  diamond: buildDiamond,
  knot: buildKnot,
};
