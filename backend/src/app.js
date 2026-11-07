import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { originCheck } from './middleware/originCheck.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(requestLogger);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(originCheck);

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;