import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

function adminDashboardHandler(req: Request, res: Response): void {
  res.json({ message: 'Admin dashboard', userId: req.headers['x-user-id'] });
}

function adminUsersHandler(_req: Request, res: Response): void {
  res.json({ users: [] });
}

router.get('/dashboard', requireAuth, adminDashboardHandler);
router.get('/users', requireAuth, adminUsersHandler);

export default router;
