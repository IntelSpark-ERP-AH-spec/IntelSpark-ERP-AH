function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .slice(0, 2000);
}

function sanitizeObject(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = { ...obj };
  for (const key of Object.keys(clean)) {
    if (typeof clean[key] === 'string') {
      clean[key] = sanitize(clean[key]);
    }
    if (fields && fields.includes(key) && typeof clean[key] === 'string' && clean[key].length > (obj.maxLen || 200)) {
      clean[key] = clean[key].slice(0, obj.maxLen || 200);
    }
  }
  return clean;
}

function validateEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateICE(ice) {
  if (typeof ice !== 'string') return false;
  return /^\d{15}$/.test(ice);
}

function validatePhone(phone) {
  if (typeof phone !== 'string') return true;
  return phone.length === 0 || /^[\d\s\+\-\.\/\(\)]{6,20}$/.test(phone);
}

function validatePrice(price) {
  return typeof price === 'number' && price >= 0 && price <= 999999999;
}

function validateQty(qty) {
  return typeof qty === 'number' && qty >= 0 && qty <= 999999;
}

function validateString(str, maxLen = 200) {
  return typeof str === 'string' && str.trim().length <= maxLen;
}

module.exports = { sanitize, sanitizeObject, validateEmail, validateICE, validatePhone, validatePrice, validateQty, validateString };
