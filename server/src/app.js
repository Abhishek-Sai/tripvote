const cors = require('cors');
const express = require('express');
const healthRouter = require('./routes/health');

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/health', healthRouter);

module.exports = app;
