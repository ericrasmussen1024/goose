// Build-time switches for this desktop distribution. Keep disabled features in source.
export const UPDATES_ENABLED = false;
export const COST_TRACKING_ENABLED = false;
export const HELP_AND_FEEDBACK_ENABLED = false;
export const AUTH_SETTINGS_ENABLED = false;
export const LOCAL_INFERENCE_ENABLED = false;
export const PROVIDER_RESET_ENABLED = false;
export const ANNOUNCEMENTS_ENABLED = false;
export const CONFIGURATION_ENABLED = true;
export const TELEMETRY_ENABLED = false;
export const TELEMETRY_UI_ENABLED = TELEMETRY_ENABLED;
export const DICTATION_ALLOWED_PROVIDERS: string[] | null = null;
