import { Workbench } from './app/workbench.js';

const application = new Workbench();
application.start().catch((error) => application.message(error.message, true));
