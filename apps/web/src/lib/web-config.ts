// Web values from config/app.json, safe for browser bundles (no server imports). Server code uses ./config.
import app from "../../../../config/app.json";

export type WebConfig = typeof app.web;

export const webConfig: WebConfig = app.web;
