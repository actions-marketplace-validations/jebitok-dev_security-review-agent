import { Router, Request, Response } from 'express';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();

function dataHandler(req: Request, res: Response): void {
  res.json({ received: req.body });
}

router.post('/data', rateLimiter, dataHandler);

export default router;
