// Contact form: sends the form to the Worker and shows the result.
// Replace WORKER_URL with the URL Wrangler prints after deploying worker/.
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
