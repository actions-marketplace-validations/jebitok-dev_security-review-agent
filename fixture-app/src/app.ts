import express from 'express';
import adminRouter from './routes/admin';
import apiRouter from './routes/api';
import uploadRouter from './routes/upload';

const app = express();
app.use(express.json());

app.use('/admin', adminRouter);
app.use('/api', apiRouter);
app.use('/', uploadRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/', (_req, res) => {
  res.json({
    app: 'security-review-agent fixture app',
    routes: [
      { method: 'GET',  path: '/health',           auth: false,  note: 'health check' },
      { method: 'GET',  path: '/admin/dashboard',  auth: true,   note: 'requires Authorization: Bearer <API_SECRET>' },
      { method: 'GET',  path: '/admin/users',      auth: true,   note: 'requires Authorization: Bearer <API_SECRET>' },
      { method: 'POST', path: '/api/data',         auth: false,  note: 'rate-limited — body: any JSON' },
      { method: 'POST', path: '/upload',           auth: false,  note: 'multipart/form-data, field: document (jpeg/png/pdf, max 5MB)' },
    ],
  });
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Fixture app listening on port ${PORT}`);
  });
}

export default app;
