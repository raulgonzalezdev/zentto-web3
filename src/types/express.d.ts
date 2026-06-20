// Augmenta el Request de Express con el usuario autenticado que adjunta el guard JWT.
declare namespace Express {
  interface Request {
    user?: { sub: string; email: string };
  }
}
