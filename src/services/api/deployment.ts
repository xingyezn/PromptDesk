// Workers environments have independent accounts and data, even under one account subdomain.
export const isPreviewDeployment =
  window.location.hostname === 'promptdesk-preview.openedutools.workers.dev';
export const productionUrl = 'https://promptdesk-worker.openedutools.workers.dev/';
