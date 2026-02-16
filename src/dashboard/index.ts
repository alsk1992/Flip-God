/**
 * Dashboard Module
 *
 * Mounts the dashboard API router and serves the static HTML dashboard.
 */

import { resolve } from 'path';
import express from 'express';
import type { Express } from 'express';
import { createLogger } from '../utils/logger';
import { createDashboardRouter } from './api';
import type { Database } from '../db';

const logger = createLogger('dashboard');

/**
 * Mount the dashboard on an Express app.
 *
 * - API routes at /api/dashboard/*
 * - Static HTML/JS/CSS at /dashboard/*
 *
 * @param app  Express application instance
 * @param db   Database wrapper (set on app.locals.db if not already present)
 */
export function mountDashboard(app: Express, db: Database): void {
  // Ensure db is available via app.locals for the API routes
  if (!app.locals.db) {
    app.locals.db = db;
  }

  // Mount API router
  const apiRouter = createDashboardRouter();
  app.use('/api/dashboard', apiRouter);
  logger.info('Dashboard API routes mounted at /api/dashboard');

  // Serve static files (index.html, etc.)
  // At runtime __dirname is dist/dashboard/ (compiled) or src/dashboard/ (ts-node).
  // The static/ subfolder must exist alongside the compiled JS.
  const staticDir = resolve(__dirname, 'static');
  app.use('/dashboard', express.static(staticDir));

  // Fallback: serve index.html for /dashboard (without trailing slash)
  app.get('/dashboard', (_req, res) => {
    res.sendFile(resolve(staticDir, 'index.html'));
  });

  logger.info('Dashboard static files served at /dashboard');
}
