require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { initFirebase } = require('./services/firebase');
const pollsRouter = require('./routes/polls');
const votesRouter = require('./routes/votes');
const adminRouter = require('./routes/admin');
const registerRouter = require('./routes/register');
const geoRouter      = require('./routes/geo');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers – relax CSP so the admin page can load inline scripts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  })
);

// Parse JSON bodies (limit size to reduce DoS surface)
app.use(express.json({ limit: '16kb' }));

// Initialize Firebase before registering routes
initFirebase();

// Serve static admin page
app.get('/admin', (req, res) => res.redirect('/admin/admin.html'));
app.use('/admin', express.static(path.join(__dirname, '..', 'public')));

// Routes
app.use('/api/polls', pollsRouter);
app.use('/api/votes', votesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/register', registerRouter);
app.use('/api/geo', geoRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`DirectDemocracy backend running on port ${PORT}`);
});

module.exports = app;
