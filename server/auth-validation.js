export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateSignup(body) {
  const fullName = String(body.fullName || "").trim().slice(0, 100);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (fullName.length < 2) return { error: "Enter your name (at least 2 characters)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 10 || password.length > 200) return { error: "Use a password between 10 and 200 characters." };
  return { value: { fullName, email, password } };
}
