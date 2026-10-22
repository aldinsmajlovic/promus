import { version } from '../../../../../package.json';

// a fork changes this one line
const REPO = 'https://github.com/aldinsmajlovic/promus';

/** The self-hosting guide as tagged for this version, so its steps match the running app. */
export const HTTPS_GUIDE_URL = `${REPO}/blob/v${version}/docs/self-hosting.md#put-https-in-front`;
