import { createContext } from './context.js';
import { createFeedback } from '../features/feedback.js';
import { createTransfers } from '../features/transfers.js';
import { createStorage } from '../features/storage.js';
import { createDownloads } from '../features/downloads.js';
import { createData } from '../features/data.js';
import { createIndicators } from '../features/indicators.js';
import { createPlaces } from '../features/places.js';
import { createOverview } from '../features/overview.js';
import { createCharts } from '../features/charts.js';
import { createNavigation } from '../features/navigation.js';
import { createExports } from '../features/exports.js';
import { createYears } from '../features/years.js';
import { createEvents } from '../features/events.js';

export function createApp() {
  const app = createContext();
  for (const feature of [
    createFeedback,
    createTransfers,
    createStorage,
    createDownloads,
    createData,
    createIndicators,
    createPlaces,
    createOverview,
    createCharts,
    createNavigation,
    createExports,
    createYears,
    createEvents,
  ])
    Object.assign(app, feature(app));
  return {
    start() {
      app.readHash();
      app.populateYears();
      app.bindEvents();
      app.updateView();
      return app.initializeCatalog();
    },
  };
}
