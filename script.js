// Entrance reveals and header state. Kept in its own block so a failure here
// can never stop the contact form from working, or the reverse.
(function motion() {
  // Signals the head failsafe that motion is in control.
  window.__vnMotion = true;

  const reveals = document.querySelectorAll(".reveal");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // No observer support, or the visitor asked for less motion: show everything.
  if (!("IntersectionObserver" in window) || reduceMotion) {
    reveals.forEach((el) => el.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );
    reveals.forEach((el) => observer.observe(el));
  }

  // Header tightens and gains a hairline once the page has moved.
  const header = document.querySelector("[data-header]");
  if (header) {
    const sync = () => header.classList.toggle("is-stuck", window.scrollY > 8);
    sync();
    window.addEventListener("scroll", sync, { passive: true });
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
