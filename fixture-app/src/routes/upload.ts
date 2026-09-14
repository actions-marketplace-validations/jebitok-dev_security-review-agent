import { Router, Request, Response } from 'express';
import { upload } from '../middleware/uploadValidator';

const router = Router();

function uploadHandler(req: Request, res: Response): void {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  res.json({
    message: 'File accepted',
    filename: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
}

router.post('/upload', upload.single('document'), uploadHandler);

export default router;
