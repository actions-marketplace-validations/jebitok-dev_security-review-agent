import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.API_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
