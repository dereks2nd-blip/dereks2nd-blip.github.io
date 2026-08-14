// Baseline behaviour that must work even if the ASCII modules fail to load:
// the intro curtain, the hero reveal, and nav highlighting.

const sections = document.querySelectorAll("main section[id]");
const navLinks = document.querySelectorAll(".hotbar nav a");

const setActiveLink = () => {
  let currentId = "";

  sections.forEach((section) => {
    const rect = section.getBoundingClientRect();
    if (rect.top <= 120 && rect.bottom > 120) {
      currentId = section.id;
    }
  });

  navLinks.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${currentId}`);
  });
};

window.addEventListener("scroll", setActiveLink, { passive: true });
setActiveLink();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const worldGen = document.getElementById("world-gen");
const worldGenFill = document.getElementById("world-gen-fill");
const heroContent = document.querySelector(".hero-content");

const revealHero = () => {
  if (worldGen) worldGen.classList.add("done");
  if (heroContent) heroContent.classList.add("revealed");
  // kinetic.js animates the name from here; if that module never loads the
  // name is already sitting in the HTML, plain and readable.
  window.dispatchEvent(new Event("hero:reveal"));
};

if (prefersReducedMotion || !worldGen || !worldGenFill) {
  revealHero();
} else {
  requestAnimationFrame(() => {
    worldGenFill.style.width = "100%";
  });
  worldGen.addEventListener("transitionend", () => {
    worldGen.style.display = "none";
  });
  window.setTimeout(revealHero, 1300);
}

console.log("%cAchievement Get!", "font-family: monospace; font-weight: bold; color: #ffb347;");
console.log("%c[Opened DevTools]", "font-family: monospace; color: #6fd8e0;");
