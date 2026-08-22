const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");
const navGroupButtons = document.querySelectorAll(".nav-group > button");
const navAnchors = document.querySelectorAll(".nav-links a[href^='#']");
const tabButtons = document.querySelectorAll(".tab");
const faqPanels = document.querySelectorAll(".faq-list[data-panel]");

if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    navLinks.classList.toggle("open", !expanded);
  });
}

navGroupButtons.forEach((button) => {
  button.addEventListener("click", () => {
    button.parentElement.classList.toggle("open");
  });
});

navAnchors.forEach((anchor) => {
  anchor.addEventListener("click", () => {
    navToggle?.setAttribute("aria-expanded", "false");
    navLinks?.classList.remove("open");
    document.querySelectorAll(".nav-group.open").forEach((group) => group.classList.remove("open"));
  });
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.tab;
    tabButtons.forEach((tab) => tab.classList.toggle("active", tab === button));
    faqPanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== target));
  });
});

const sections = [...document.querySelectorAll("main section[id]")];

if ("IntersectionObserver" in window && sections.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;

      navAnchors.forEach((anchor) => {
        anchor.classList.toggle("active", anchor.getAttribute("href") === `#${visible.target.id}`);
      });
    },
    { rootMargin: "-30% 0px -60% 0px", threshold: [0.05, 0.25, 0.5] }
  );

  sections.forEach((section) => observer.observe(section));
}
