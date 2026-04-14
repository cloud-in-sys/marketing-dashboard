import { Hono } from 'hono';

const app = new Hono();

app.get('/', c => {
  const user = c.get('user');
  return c.json({ user });
});

export default app;
