/**
 * DI token for the `NotificationChannel[]` array `NotificationService` fans
 * out over. Kept as its own file so a future `WhatsAppChannel` provider can
 * import just the token without pulling in the service.
 */
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');
