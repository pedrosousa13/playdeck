/**
 * The two Storybook origins this harness drives. In one module because five
 * places need them and they have to agree: `playwright.parity.config.ts`
 * spawns each server on one of these ports and waits on its `/index.json`,
 * and the three `*.check.ts` files navigate to them absolutely. There is no
 * `baseURL` to fall back on — this config drives two origins, so a relative
 * URL could not say which side it meant.
 *
 * `127.0.0.1` rather than `localhost`, and 4173 for Reely, both copied from
 * `playwright.config.ts`'s own `webServer`: the parity run reuses the very
 * server that config spawns (`reuseExistingServer`), which it can only do if
 * the URL matches exactly. 6007 for Backpack is the port the plan's "Facts
 * verified before this plan was written" section booted its Storybook on.
 */
export const HOST = '127.0.0.1';
export const REELY_PORT = 4173;
export const BACKPACK_PORT = 6007;

export const REELY_ORIGIN = `http://${HOST}:${REELY_PORT}`;
export const BACKPACK_ORIGIN = `http://${HOST}:${BACKPACK_PORT}`;
