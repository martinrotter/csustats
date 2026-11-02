import { BASE, POPULATION, COLORS } from '../config.js';
import { esc, fold, fmt, mb, date, placeCount, yearCount } from '../core/format.js';

export function createContext() {
  const app = {};
  app.BASE = BASE;
  app.POPULATION = POPULATION;
  app.COLORS = COLORS;
  app.$ = (id) => document.getElementById(id);
  app.regionCatalog = JSON.parse(app.$('region-data').textContent);
  app.placeColor = (index) => app.COLORS[index % app.COLORS.length];
  app.esc = esc;
  app.fold = fold;
  app.fmt = fmt;
  app.mb = mb;
  app.date = date;
  app.placeCount = placeCount;
  app.yearCount = yearCount;
  app.state = {
    year: 2025,
    places: [],
    indicator: app.POPULATION,
    view: 'overview',
    from: 2021,
    to: 2025,
    mode: 'absolute',
    normalize: 'absolute',
  };
  app.latest = 2025;
  app.territories = new Map();
  app.indicators = new Map();
  app.topics = new Map();
  app.db = null;
  app.catalogReady = false;
  app.catalogPromise = null;
  app.cacheEntries = [];
  app.memoryCache = new Map();
  app.worker = null;
  app.workerYear = null;
  app.requestCounter = 0;
  app.workerPending = new Map();
  app.slices = new Map();
  app.activeSlice = null;
  app.historyYears = [];
  app.busy = false;
  app.operationController = null;
  app.overviewTable = null;
  app.compareTable = null;
  app.historyTable = null;
  app.overviewRows = [];
  app.compareRows = [];
  app.historyRows = [];
  app.compareChart = null;
  app.historyChart = null;
  app.toastTimer = undefined;
  app.taskIndex = 0;
  app.taskTotal = 1;
  app.storageWarningShown = false;
  app.renderVersion = 0;
  app.transferTasks = [];
  app.activeTransfer = null;
  app.selectedYears = new Set();
  app.startupPending = false;
  app.sliceRevision = 0;
  app.availabilityCache = new Map();
  app.visiblePlaceLimit = 12;
  app.bulkSelected = new Set();
  app.bulkGroups = new Map();
  app.displayPlaceNames = new Map();
  app.transferLabels = {
    queued: 'Čeká',
    cached: 'Již staženo',
    checking: 'Zjišťuji velikost',
    downloading: 'Stahuji',
    processing: 'Zpracovávám',
    saving: 'Ukládám',
    done: 'Připraveno',
    error: 'Chyba',
    canceled: 'Zrušeno',
  };
  return app;
}
