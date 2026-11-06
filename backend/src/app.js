import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(helmet()); // safe default security headers
app.use(cors({ origin: env.corsOrigin, credentials: true })); // only your React app
app.use(requestLogger);
app.use(express.json({ limit: '100kb' })); // req.body is undefined without this in Express 5

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;