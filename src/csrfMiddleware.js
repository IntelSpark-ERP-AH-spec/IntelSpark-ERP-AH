function csrfMiddleware(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (req.path === '/login') return next();
    const csrfCookie = req.cookies?.['XSRF-TOKEN'];
    const csrfHeader = req.headers['x-csrf-token'];
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ error: 'Jeton CSRF invalide' });
    }
  }
  next();
}

module.exports = csrfMiddleware;
