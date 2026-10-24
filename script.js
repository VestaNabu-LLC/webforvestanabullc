// Entrance reveals and header state. Kept in its own block so a failure here
// can never stop the contact form from working, or the reverse.
(function motion() {
  // Signals the head failsafe that motion is in control.
  window.__vnMotion = true;

  const reveals = document.querySelectorAll(".reveal");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const show = (el) => el.classList.add("is-visible");

  // Reveals still waiting for the observer. The scroll handler sweeps this as
  // a backstop, so content can never be stranded invisible if the observer
  // fails to deliver.
  let pending = [];
  let sweepReveals = () => {};

  // No observer support, or the visitor asked for less motion: show everything.
  if (!("IntersectionObserver" in window) || reduceMotion) {
    reveals.forEach(show);
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          show(entry.target);
          observer.unobserve(entry.target);
          pending = pending.filter((el) => el !== entry.target);
        });
      },
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );

    // Anything already within the first screen is revealed immediately. The
    // observer's bottom margin would otherwise leave content near the fold
    // waiting for a scroll that may never come - which once hid the hero CTA.
    reveals.forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) {
        show(el);
      } else {
        pending.push(el);
        observer.observe(el);
      }
    });

    sweepReveals = () => {
      if (!pending.length) return;
      pending = pending.filter((el) => {
        if (el.getBoundingClientRect().top >= window.innerHeight) return true;
        show(el);
        observer.unobserve(el);
        return false;
      });
    };
  }

  // One rAF-throttled scroll handler drives the header state and the progress
  // hairline, so scrolling never does layout work twice.
  const header = document.querySelector("[data-header]");
  const progress = document.querySelector("[data-progress]");
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      if (header) header.classList.toggle("is-stuck", y > 8);
      if (progress) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.setProperty("--p", max > 0 ? Math.min(y / max, 1).toFixed(4) : "0");
      }
      sweepReveals();
      ticking = false;
    });
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  // Navigation reflects the section currently being read. A narrow band across
  // the middle of the viewport decides which section is current.
  const sections = document.querySelectorAll("[data-section]");
  const navLinks = document.querySelectorAll(".site-nav a[data-spy]");

  if (sections.length && navLinks.length && "IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const current = entry.target.getAttribute("data-section");
          navLinks.forEach((link) => {
            link.classList.toggle("is-current", link.getAttribute("data-spy") === current);
          });
        });
      },
      { threshold: 0, rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((section) => spy.observe(section));
  }
})();

// Contact form: sends the form to the Worker and shows the result.
const WORKER_URL = "https://vestanabu-contact.sebastiancanevari.workers.dev";

const form = document.getElementById("inquiry");
const status = form.querySelector(".form-status");
const submitButton = form.querySelector("button[type='submit']");

function setStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const payload = {
    name: data.get("name"),
    email: data.get("email"),
    interest: data.get("interest"),
    message: data.get("message"),
    website: data.get("website"),
    turnstileToken: data.get("cf-turnstile-response"),
  };

  if (!payload.name || !payload.email || !payload.message) {
    setStatus("Please fill in your name, email and a message.", "error");
    return;
  }

  submitButton.disabled = true;
  setStatus("Sending...", "pending");

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (response.ok && result.ok) {
      form.reset();
      window.turnstile?.reset();
      setStatus("Thanks! We'll be in touch soon.", "success");
    } else {
      setStatus(result.error || "Something went wrong. Please try again.", "error");
    }
  } catch {
    setStatus("Couldn't reach the server. Please email info@vestanabullc.com.", "error");
  } finally {
    submitButton.disabled = false;
  }
});
