/** Password rules aligned with backend/auth.js validatePassword. */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return 'Le mot de passe doit contenir entre 12 et 128 caractères.';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Le mot de passe doit contenir une minuscule, une majuscule, un chiffre et un caractère spécial.';
  }
  return null;
}
