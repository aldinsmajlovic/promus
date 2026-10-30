import { repository, version } from '../../../../../package.json';

// a fork changes `repository` in package.json
const REPO = repository.url;

/** The self-hosting guide as tagged for this version, so its steps match the running app. */
export const HTTPS_GUIDE_URL = `${REPO}/blob/v${version}/docs/self-hosting.md#put-https-in-front`;

/** How to update, as tagged for the release being updated to. */
export const updateGuideUrl = (to: string): string => `${REPO}/blob/v${to}/docs/self-hosting.md#updating`;
