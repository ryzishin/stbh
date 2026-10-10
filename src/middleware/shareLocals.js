// src/middleware/shareLocals.js
// Inject commonly-needed template variables into res.locals so every EJS view has them.
export function shareLocals(req, res, next) {
  res.locals.user = req.user || null;
  res.locals.role = req.role || null;
  res.locals.path = req.path;
  res.locals.flash = req.session?.flash || null;
  // one-shot flash — clear after read
  if (req.session?.flash) {
    req.session.flash = null;
  }
  next();
}
