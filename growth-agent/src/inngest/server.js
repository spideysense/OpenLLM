import express from 'express';
import { serve } from 'inngest/express';
import { inngest } from './client.js';
import { functions } from './functions.js';

const app = express();
app.use('/api/inngest', serve({ client: inngest, functions }));
app.get('/health', (_, res) => res.send('ok'));
const port = process.env.PORT || 3030;
app.listen(port, () => console.log(`aspen-growth-agent inngest on :${port}/api/inngest`));
