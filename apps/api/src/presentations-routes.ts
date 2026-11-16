import type { FastifyInstance } from 'fastify';
import { presentationInput } from '@classflow/shared/presentations';
import { openPresentations } from './presentations-store.js';

export function presentationRoutes(app: FastifyInstance, directory: string) {
  const store = openPresentations(directory);
  app.addHook('onClose', async () => store.close());
  app.get('/api/presentations', () => store.list());
  app.post('/api/presentations', (req, res) => res.code(201).send(store.save(presentationInput.parse(req.body))));
  app.put<{ Params: { id: string } }>('/api/presentations/:id', (req) =>
    store.save(presentationInput.parse(req.body), req.params.id));
  app.delete<{ Params: { id: string } }>('/api/presentations/:id', (req, res) => {
    store.remove(req.params.id);
    return res.code(204).send();
  });
  app.get<{ Params: { id: string } }>('/api/presentations/:id/content', (req, res) => {
    const item = store.get(req.params.id);
    // Even direct navigation receives an opaque origin. Never grant allow-same-origin.
    return res.type('text/html; charset=utf-8')
      .header('X-Frame-Options', 'SAMEORIGIN')
      .header('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
      .send(item.html);
  });
  app.get<{ Params: { id: string } }>('/api/presentations/:id/download', (req, res) => {
    const item = store.get(req.params.id);
    return res.type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename="presentation.html"; filename*=UTF-8''${encodeURIComponent(item.filename)}`)
      .send(item.html);
  });
}
